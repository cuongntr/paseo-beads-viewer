import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { CommandError } from "../shared/beads";
import type { CommandResult } from "../server/command";
import type { JournalMark, TailOutcome } from "../server/journal";
import type { TrackerRoute } from "../server/tracker";

/**
 * A fake bd journal: an ordered list of records, a retained floor, and switches
 * for "off" and failures. It answers `tail --since N [--limit L]` the way bd
 * 1.3 does, including the truncated error that names the head.
 */
interface FakeJournal {
  enabled: boolean;
  off: boolean;
  records: JournalMark[];
  floor: number;
  failTail: CommandError | null;
  throwTail: boolean;
  failConfig: boolean;
}

let journal: FakeJournal;
const tailCalls: { since: number; limit: number | null }[] = [];
const configCalls: string[] = [];
let tailGate: Promise<void> | null = null;

function record(seq: number, issueId = `bd-${seq}`, ts = `2026-09-28T00:00:${String(seq % 60).padStart(2, "0")}Z`): JournalMark {
  return { seq, ts, op: "update", issueId };
}

function head(): number {
  return journal.records.at(-1)?.seq ?? 0;
}

vi.mock("../server/journal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/journal")>();
  return {
    ...actual,
    readJournalEnabled: async (route: TrackerRoute): Promise<CommandResult<boolean>> => {
      configCalls.push(route.database);
      if (journal.failConfig) {
        return { ok: false, error: { code: "exit", message: "unknown command", exitCode: 1 } };
      }
      return { ok: true, value: journal.enabled };
    },
    tailJournal: async (_route: TrackerRoute, _cwd: string, since: number, limit: number | null): Promise<TailOutcome> => {
      tailCalls.push({ since, limit });
      if (tailGate !== null) await tailGate;
      if (journal.throwTail) throw new Error("spawn exploded");
      if (journal.failTail !== null) return { kind: "failed", error: journal.failTail };
      if (journal.off) return { kind: "off" };
      if (since < journal.floor - 1) return { kind: "truncated", head: head() };
      const after = journal.records.filter((entry) => entry.seq > since).slice(0, limit ?? undefined);
      return { kind: "records", first: after[0] ?? null, last: after.at(-1) ?? null };
    },
  };
});

const { changesAfterRead, changesBeforeRead, clearChangeState, getChanges } = await import("../server/changes");

const DIRECTORY = await mkdtemp(join(tmpdir(), "paseo-beads-changes-"));
const BD_ROUTE: TrackerRoute = { kind: "bd", beadsDirectory: join(DIRECTORY, ".beads"), database: join(DIRECTORY, ".beads") };
const OTHER_CLONE: TrackerRoute = { kind: "bd", beadsDirectory: "/elsewhere/.beads", database: "/elsewhere/.beads" };
const BR_ROUTE: TrackerRoute = { kind: "br", beadsDirectory: join(DIRECTORY, ".beads"), database: join(DIRECTORY, ".beads", "beads.db") };

const context = {
  paseo: {
    workspaces: {
      ref: () => ({ refresh: async () => ({ workspaceDirectory: DIRECTORY, name: "repo", title: null }) }),
    },
  },
} as unknown as PluginHandlerContext;

/** What a dashboard load does: read before bv, then settle once the route is known. */
async function dashboardLoad(route: TrackerRoute | null = BD_ROUTE) {
  const before = await changesBeforeRead("ws", DIRECTORY);
  return await changesAfterRead("ws", DIRECTORY, route, before);
}

async function poll() {
  return await getChanges({ workspaceId: "ws" }, context);
}

beforeEach(() => {
  clearChangeState();
  tailCalls.length = 0;
  configCalls.length = 0;
  tailGate = null;
  journal = {
    enabled: true,
    off: false,
    records: [record(1), record(2), record(3)],
    floor: 1,
    failTail: null,
    throwTail: false,
    failConfig: false,
  };
});

describe("live change detection", () => {
  it("is not live, with the journal-off reason, when the workspace has the journal off", async () => {
    journal.enabled = false;
    const state = await dashboardLoad();
    expect(state).toEqual({ live: false, reason: "journal-off", token: null });
    // Nothing reads the journal when it is off, and a poll costs no subprocess.
    expect(tailCalls).toHaveLength(0);
    expect(await poll()).toEqual({ live: false, reason: "journal-off", token: null });
    expect(tailCalls).toHaveLength(0);
  });

  it("notices the journal was turned on at the next dashboard load", async () => {
    journal.enabled = false;
    await dashboardLoad();
    journal.enabled = true;
    expect((await dashboardLoad()).live).toBe(true);
  });

  it("is never live for br and reads nothing", async () => {
    const state = await dashboardLoad(BR_ROUTE);
    expect(state).toEqual({ live: false, reason: "not-bd", token: null });
    expect(configCalls).toHaveLength(0);
    expect(tailCalls).toHaveLength(0);
    expect((await poll()).live).toBe(false);
    expect(tailCalls).toHaveLength(0);
  });

  it("is not live without an established tracker route", async () => {
    expect(await dashboardLoad(null)).toEqual({ live: false, reason: "unavailable", token: null });
  });

  it("baselines at the head, keeps the token while nothing changes, and moves it on a change", async () => {
    const baseline = await dashboardLoad();
    expect(baseline.live).toBe(true);
    expect(baseline.token).not.toBeNull();
    // The baseline read the whole journal once, from the start.
    expect(tailCalls).toEqual([{ since: 0, limit: null }]);

    tailCalls.length = 0;
    const idle = await poll();
    const idleAgain = await poll();
    expect(idle).toEqual(baseline);
    expect(idleAgain).toEqual(baseline);
    // Each idle poll is one read, starting at the checkpoint record itself.
    expect(tailCalls).toEqual([
      { since: 2, limit: null },
      { since: 2, limit: null },
    ]);

    journal.records.push(record(4), record(5));
    const changed = await poll();
    expect(changed.live).toBe(true);
    expect(changed.token).not.toBe(baseline.token);
    // The checkpoint moved to the new head, so the next poll is idle again.
    expect(await poll()).toEqual(changed);
    expect(tailCalls.at(-1)).toEqual({ since: 4, limit: null });
  });

  it("keeps the early reading on a later dashboard load rather than re-baselining", async () => {
    await dashboardLoad();
    tailCalls.length = 0;
    configCalls.length = 0;
    journal.records.push(record(4));
    const reload = await dashboardLoad();
    expect(reload.live).toBe(true);
    expect(configCalls).toHaveLength(0);
    expect(tailCalls).toEqual([{ since: 2, limit: null }]);
    expect(await poll()).toEqual(reload);
  });

  it("follows an empty journal from zero", async () => {
    journal.records = [];
    const baseline = await dashboardLoad();
    expect(baseline.live).toBe(true);
    expect(await poll()).toEqual(baseline);
    journal.records.push(record(1));
    expect((await poll()).token).not.toBe(baseline.token);
  });

  it("re-baselines after truncation and counts it as a change", async () => {
    const baseline = await dashboardLoad();
    // Retention pruned everything up to and including the checkpoint record.
    journal.records = [record(4), record(5), record(6)];
    journal.floor = 4;
    const truncated = await poll();
    expect(truncated.live).toBe(true);
    expect(truncated.token).not.toBe(baseline.token);

    // Until the reload re-reads the head, polls hold the moved token without reading.
    tailCalls.length = 0;
    expect(await poll()).toEqual(truncated);
    expect(tailCalls).toHaveLength(0);

    const reload = await dashboardLoad();
    expect(reload.live).toBe(true);
    expect(reload.token).not.toBe(truncated.token);
    // Reading from zero hits the truncated error, which names head 6; the record there is fetched.
    expect(tailCalls).toEqual([
      { since: 0, limit: null },
      { since: 5, limit: 1 },
    ]);
    expect(await poll()).toEqual(reload);
    journal.records.push(record(7));
    expect((await poll()).token).not.toBe(reload.token);
  });

  it("detects a clone switch whose head is below the checkpoint and re-baselines", async () => {
    journal.records = Array.from({ length: 40 }, (_, index) => record(index + 1));
    const baseline = await dashboardLoad();
    // Another clone: its own seq space, only 5 records. Reading after seq 39 there is empty forever.
    journal.records = Array.from({ length: 5 }, (_, index) => record(index + 1, `other-${index + 1}`));
    const switched = await poll();
    expect(switched.live).toBe(true);
    expect(switched.token).not.toBe(baseline.token);

    const reload = await dashboardLoad();
    expect(reload.live).toBe(true);
    expect(reload.token).not.toBe(switched.token);
    // The new checkpoint is this clone's head, so its next change is seen.
    expect(await poll()).toEqual(reload);
    journal.records.push(record(6, "other-6"));
    expect((await poll()).token).not.toBe(reload.token);
  });

  it("detects a clone switch whose record at the checkpoint seq is a different record", async () => {
    const baseline = await dashboardLoad();
    journal.records = [record(1, "x-1"), record(2, "x-2"), record(3, "x-3"), record(4, "x-4")];
    const switched = await poll();
    expect(switched.token).not.toBe(baseline.token);
    tailCalls.length = 0;
    await dashboardLoad();
    // Stale checkpoint: no early read, straight to a fresh baseline.
    expect(tailCalls[0]).toEqual({ since: 0, limit: null });
  });

  it("re-baselines when the tracker route points at a different database", async () => {
    const baseline = await dashboardLoad();
    tailCalls.length = 0;
    const moved = await dashboardLoad(OTHER_CLONE);
    expect(moved.live).toBe(true);
    expect(moved.token).not.toBe(baseline.token);
    expect(tailCalls.at(-1)).toEqual({ since: 0, limit: null });
  });

  it("goes not live, without throwing, when the journal read fails", async () => {
    await dashboardLoad();
    journal.failTail = { code: "timeout", message: "bd events tail timed out.", exitCode: null };
    expect(await poll()).toEqual({ live: false, reason: "unavailable", token: null });
    // And stays that way without reading again until the next dashboard load.
    tailCalls.length = 0;
    expect((await poll()).live).toBe(false);
    expect(tailCalls).toHaveLength(0);
    journal.failTail = null;
    expect((await dashboardLoad()).live).toBe(true);
  });

  it("goes not live when spawning bd throws", async () => {
    await dashboardLoad();
    journal.throwTail = true;
    await expect(poll()).resolves.toEqual({ live: false, reason: "unavailable", token: null });
  });

  it("is not live when the config read fails, as on a bd without the journal", async () => {
    journal.failConfig = true;
    expect(await dashboardLoad()).toEqual({ live: false, reason: "unavailable", token: null });
  });

  it("is not live when the baseline read fails", async () => {
    journal.failTail = { code: "exit", message: "unknown command \"events\"", exitCode: 1 };
    expect(await dashboardLoad()).toEqual({ live: false, reason: "unavailable", token: null });
  });

  it("reports journal-off when bd says so mid-session", async () => {
    await dashboardLoad();
    journal.off = true;
    expect(await poll()).toEqual({ live: false, reason: "journal-off", token: null });
  });

  it("treats a poll over the output limit as a bulk change", async () => {
    const baseline = await dashboardLoad();
    journal.failTail = { code: "output_limit", message: "too much", exitCode: null };
    const bulk = await poll();
    expect(bulk.live).toBe(true);
    expect(bulk.token).not.toBe(baseline.token);
  });

  it("shares one journal read among concurrent polls", async () => {
    await dashboardLoad();
    tailCalls.length = 0;
    let open: () => void = () => {};
    tailGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const polls = Promise.all([poll(), poll(), poll()]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    open();
    const [first, second, third] = await polls;
    expect(tailCalls).toHaveLength(1);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it("is not live for a workspace no dashboard has loaded", async () => {
    expect(await poll()).toEqual({ live: false, reason: "unavailable", token: null });
    expect(tailCalls).toHaveLength(0);
  });

  it("forgets every checkpoint on plugin cleanup", async () => {
    await dashboardLoad();
    clearChangeState();
    expect((await poll()).live).toBe(false);
  });
});
