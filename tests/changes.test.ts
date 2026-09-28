import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  failConfig: CommandError | null;
}

let journal: FakeJournal;
const tailCalls: { since: number; limit: number | null }[] = [];
const configCalls: string[] = [];
let tailGate: Promise<void> | null = null;
let readsInFlight = 0;
let maxReadsInFlight = 0;

function record(seq: number, issueId = `bd-${seq}`, ts = `2026-09-28T00:00:${String(seq % 60).padStart(2, "0")}Z`): JournalMark {
  return { seq, ts, op: "update", issueId };
}

function head(): number {
  return journal.records.at(-1)?.seq ?? 0;
}

function write(): void {
  journal.records.push(record(head() + 1));
}

vi.mock("../server/journal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/journal")>();
  return {
    ...actual,
    readJournalEnabled: async (route: TrackerRoute): Promise<CommandResult<boolean>> => {
      configCalls.push(route.database);
      if (journal.failConfig !== null) return { ok: false, error: journal.failConfig };
      return { ok: true, value: journal.enabled };
    },
    tailJournal: async (_route: TrackerRoute, _cwd: string, since: number, limit: number | null): Promise<TailOutcome> => {
      tailCalls.push({ since, limit });
      readsInFlight += 1;
      maxReadsInFlight = Math.max(maxReadsInFlight, readsInFlight);
      try {
        if (tailGate !== null) await tailGate;
        if (journal.throwTail) throw new Error("spawn exploded");
        if (journal.failTail !== null) return { kind: "failed", error: journal.failTail };
        if (journal.off) return { kind: "off" };
        if (since < journal.floor - 1) return { kind: "truncated", head: head() };
        const after = journal.records.filter((entry) => entry.seq > since).slice(0, limit ?? undefined);
        return { kind: "records", first: after[0] ?? null, last: after.at(-1) ?? null };
      } finally {
        readsInFlight -= 1;
      }
    },
  };
});

const { changesAfterRead, changesBeforeRead, clearChangeState, getChanges } = await import("../server/changes");

const DIRECTORY = await mkdtemp(join(tmpdir(), "paseo-beads-changes-"));
const BD_ROUTE: TrackerRoute = { kind: "bd", beadsDirectory: join(DIRECTORY, ".beads"), database: join(DIRECTORY, ".beads") };
const OTHER_CLONE: TrackerRoute = { kind: "bd", beadsDirectory: "/elsewhere/.beads", database: "/elsewhere/.beads" };
const BR_ROUTE: TrackerRoute = { kind: "br", beadsDirectory: join(DIRECTORY, ".beads"), database: join(DIRECTORY, ".beads", "beads.db") };
const BUSY: CommandError = { code: "timeout", message: "bd events tail timed out.", exitCode: null };
const LOCKED: CommandError = { code: "exit", message: "bd events tail failed: database is locked", exitCode: 1 };

const context = {
  paseo: {
    workspaces: {
      ref: () => ({ refresh: async () => ({ workspaceDirectory: DIRECTORY, name: "repo", title: null }) }),
    },
  },
} as unknown as PluginHandlerContext;

/**
 * What a dashboard load does: read a position before bv, let bv read the
 * project (`duringBv` stands in for anything that happens meanwhile), then
 * settle once bv named the route. Returns the snapshot's token state and the
 * journal head bv's data reflects.
 */
async function load(route: TrackerRoute | null = BD_ROUTE, duringBv: () => Promise<void> | void = () => {}) {
  const before = await changesBeforeRead("ws", DIRECTORY);
  const dataHead = head();
  await duringBv();
  const state = await changesAfterRead("ws", DIRECTORY, route, before);
  return { state, dataHead };
}

async function poll() {
  return await getChanges({ workspaceId: "ws" }, context);
}

/** First load, the one reload its pending token forces, and the snapshot that reload shows. */
async function warm() {
  const first = await load();
  expect(first.state.live).toBe(true);
  expect((await poll()).token).not.toBe(first.state.token);
  const second = await load();
  expect(await poll()).toEqual(second.state);
  return second.state;
}

beforeEach(() => {
  clearChangeState();
  tailCalls.length = 0;
  configCalls.length = 0;
  tailGate = null;
  readsInFlight = 0;
  maxReadsInFlight = 0;
  journal = {
    enabled: true,
    off: false,
    records: [record(1), record(2), record(3)],
    floor: 1,
    failTail: null,
    throwTail: false,
    failConfig: null,
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("which workspaces are live", () => {
  it("is not live, with the journal-off reason, when the workspace has the journal off", async () => {
    journal.enabled = false;
    expect((await load()).state).toEqual({ live: false, reason: "journal-off", token: null });
    // Nothing reads the journal when it is off, and a poll costs no subprocess.
    expect(tailCalls).toHaveLength(0);
    expect(await poll()).toEqual({ live: false, reason: "journal-off", token: null });
    expect(tailCalls).toHaveLength(0);
  });

  it("notices the journal was turned on at the next dashboard load, reading the head before bv", async () => {
    journal.enabled = false;
    await load();
    journal.enabled = true;
    const next = await load();
    expect(next.state.live).toBe(true);
    // Baselined before bv, so the snapshot carries a real position: the next poll agrees.
    expect(await poll()).toEqual(next.state);
  });

  it("is never live for br and reads nothing", async () => {
    expect((await load(BR_ROUTE)).state).toEqual({ live: false, reason: "not-bd", token: null });
    expect(configCalls).toHaveLength(0);
    expect(tailCalls).toHaveLength(0);
    expect((await poll()).live).toBe(false);
    expect(tailCalls).toHaveLength(0);
  });

  it("is not live without an established tracker route", async () => {
    expect((await load(null)).state).toEqual({ live: false, reason: "unavailable", token: null });
  });

  it("is not live for a workspace no dashboard has loaded", async () => {
    expect(await poll()).toEqual({ live: false, reason: "unavailable", token: null });
    expect(tailCalls).toHaveLength(0);
  });

  it("forgets every checkpoint on plugin cleanup", async () => {
    await warm();
    clearChangeState();
    expect((await poll()).live).toBe(false);
  });
});

describe("tokens never run ahead of the data they tag", () => {
  it("tags a first load pending, so the next poll forces exactly one reload", async () => {
    const first = await load();
    // bd has no position before bv on a first load; the journal is baselined after it.
    expect(tailCalls).toEqual([{ since: 0, limit: null }]);
    const polled = await poll();
    expect(polled.live).toBe(true);
    expect(polled.token).not.toBe(first.state.token);
    const reload = await load();
    expect(reload.state).toEqual(polled);
    expect(await poll()).toEqual(reload.state);
  });

  it("keeps the token while nothing changes and moves it on a change", async () => {
    const shown = await warm();
    tailCalls.length = 0;
    expect(await poll()).toEqual(shown);
    expect(await poll()).toEqual(shown);
    // Each idle poll is one read, starting at the checkpoint record itself.
    expect(tailCalls).toEqual([
      { since: 2, limit: null },
      { since: 2, limit: null },
    ]);
    write();
    write();
    const changed = await poll();
    expect(changed.token).not.toBe(shown.token);
    expect(await poll()).toEqual(changed);
    expect(tailCalls.at(-1)).toEqual({ since: 4, limit: null });
  });

  it("R1a: a write after bv's read plus a poll during the load still reaches the panel", async () => {
    await warm();
    const reload = await load(BD_ROUTE, async () => {
      write();
      // The panel's own poll during the load: it moves the server's checkpoint.
      await poll();
    });
    expect(reload.dataHead).toBe(3);
    const next = await poll();
    // The snapshot is tagged with the position before bv (seq 3), so the next poll differs and reloads.
    expect(next.token).not.toBe(reload.state.token);
    const after = await load();
    expect(after.dataHead).toBe(4);
    expect(await poll()).toEqual(after.state);
  });

  it("R1a: a second concurrent load cannot hand the first a newer token", async () => {
    await warm();
    const before = await changesBeforeRead("ws", DIRECTORY);
    write();
    const other = await load();
    expect(other.dataHead).toBe(4);
    const settled = await changesAfterRead("ws", DIRECTORY, BD_ROUTE, before);
    expect(settled.token).not.toBe(other.state.token);
    expect((await poll()).token).not.toBe(settled.token);
  });

  it("R1b: a write during a first load is shown by the reload the next poll forces", async () => {
    const first = await load(BD_ROUTE, write);
    expect(first.dataHead).toBe(3);
    const next = await poll();
    expect(next.token).not.toBe(first.state.token);
    const reload = await load();
    expect(reload.dataHead).toBe(4);
    expect(await poll()).toEqual(reload.state);
  });

  it("R1b: a write during a re-baselining load moves the next poll's token", async () => {
    await warm();
    journal.records = [record(1, "x-1"), record(2, "x-2")]; // clone switch
    await poll();
    const reload = await load(BD_ROUTE, write);
    expect(reload.state.live).toBe(true);
    expect(reload.dataHead).toBe(2);
    expect((await poll()).token).not.toBe(reload.state.token);
  });

  it("re-baselines in the same load when the check before bv finds the checkpoint stale", async () => {
    await warm();
    journal.records = [record(1, "x-1")];
    const reload = await load();
    expect(reload.state.live).toBe(true);
    // No stall: the snapshot's token is a real position the polls agree with, and news still moves it.
    expect(await poll()).toEqual(reload.state);
    write();
    expect((await poll()).token).not.toBe(reload.state.token);
  });
});

describe("stall guard", () => {
  it("re-baselines after truncation and counts it as a change", async () => {
    const shown = await warm();
    // Retention pruned everything up to and including the checkpoint record.
    journal.records = [record(4), record(5), record(6)];
    journal.floor = 4;
    const truncated = await poll();
    expect(truncated.live).toBe(true);
    expect(truncated.token).not.toBe(shown.token);

    // Until the reload re-reads the head, polls hold the moved token without reading.
    tailCalls.length = 0;
    expect(await poll()).toEqual(truncated);
    expect(tailCalls).toHaveLength(0);

    const reload = await load();
    expect(reload.state.live).toBe(true);
    expect(reload.state.token).not.toBe(truncated.token);
    // Reading from zero hits the truncated error, which names head 6; the record there is fetched.
    expect(tailCalls).toEqual([
      { since: 0, limit: null },
      { since: 5, limit: 1 },
    ]);
    expect(await poll()).toEqual(reload.state);
    write();
    expect((await poll()).token).not.toBe(reload.state.token);
  });

  it("detects a clone switch whose head is below the checkpoint and re-baselines", async () => {
    journal.records = Array.from({ length: 40 }, (_, index) => record(index + 1));
    const shown = await warm();
    // Another clone: its own seq space, only 5 records. Reading after seq 39 there is empty forever.
    journal.records = Array.from({ length: 5 }, (_, index) => record(index + 1, `other-${index + 1}`));
    const switched = await poll();
    expect(switched.live).toBe(true);
    expect(switched.token).not.toBe(shown.token);

    const reload = await load();
    expect(reload.state.token).not.toBe(switched.token);
    expect(await poll()).toEqual(reload.state);
    journal.records.push(record(6, "other-6"));
    expect((await poll()).token).not.toBe(reload.state.token);
  });

  it("detects a clone switch whose record at the checkpoint seq is a different record", async () => {
    const shown = await warm();
    journal.records = [record(1, "x-1"), record(2, "x-2"), record(3, "x-3"), record(4, "x-4")];
    expect((await poll()).token).not.toBe(shown.token);
    tailCalls.length = 0;
    await load();
    // Stale checkpoint: no poll-style read, straight to a fresh baseline before bv.
    expect(tailCalls[0]).toEqual({ since: 0, limit: null });
  });

  it("tags the snapshot pending when bv names a different database", async () => {
    const shown = await warm();
    const moved = await load(OTHER_CLONE);
    expect(moved.state.live).toBe(true);
    expect(moved.state.token).not.toBe(shown.token);
    expect((await poll()).token).not.toBe(moved.state.token);
  });

  it("treats a poll over the output limit as a bulk change", async () => {
    const shown = await warm();
    journal.failTail = { code: "output_limit", message: "too much", exitCode: null };
    const bulk = await poll();
    expect(bulk.live).toBe(true);
    expect(bulk.token).not.toBe(shown.token);
  });

  it("reports journal-off when bd says so mid-session", async () => {
    await warm();
    journal.off = true;
    expect(await poll()).toEqual({ live: false, reason: "journal-off", token: null });
  });
});

describe("failures", () => {
  it("keeps the workspace live through a failed or timed-out poll and retries with backoff", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(0);
    const shown = await warm();
    tailCalls.length = 0;
    journal.failTail = LOCKED;
    expect(await poll()).toEqual(shown);
    // Within the 5 s backoff no read is attempted.
    expect(await poll()).toEqual(shown);
    expect(tailCalls).toHaveLength(1);

    vi.setSystemTime(5_000);
    journal.failTail = BUSY;
    expect(await poll()).toEqual(shown);
    expect(tailCalls).toHaveLength(2);
    // The second failure doubles the wait.
    vi.setSystemTime(14_000);
    await poll();
    expect(tailCalls).toHaveLength(2);

    vi.setSystemTime(15_000);
    journal.failTail = null;
    write();
    const changed = await poll();
    expect(changed.live).toBe(true);
    expect(changed.token).not.toBe(shown.token);
    expect(tailCalls).toHaveLength(3);
  });

  it("keeps the workspace live when spawning bd throws once", async () => {
    const shown = await warm();
    journal.throwTail = true;
    await expect(poll()).resolves.toEqual(shown);
  });

  it("ends live refresh only when reads keep failing for minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(0);
    await warm();
    journal.failTail = LOCKED;
    let now = 0;
    let state = await poll();
    let polls = 1;
    while (state.live && now < 20 * 60_000) {
      now += 5_000;
      vi.setSystemTime(now);
      state = await poll();
      polls += 1;
    }
    expect(state).toEqual({ live: false, reason: "unavailable", token: null });
    expect(now).toBeGreaterThanOrEqual(5 * 60_000);
    // Backoff capped at a minute: a handful of reads over those minutes, not one per poll.
    expect(tailCalls.length).toBeLessThan(15);
    expect(polls).toBeGreaterThan(tailCalls.length);
  });

  it("is not live when the config read fails, and does not retry the baseline on every load", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(0);
    journal.failConfig = { code: "exit", message: "unknown command", exitCode: 1 };
    expect((await load()).state).toEqual({ live: false, reason: "unavailable", token: null });
    expect(configCalls).toHaveLength(1);
    await load();
    await load();
    expect(configCalls).toHaveLength(1);
    // After a while it tries again, before bv.
    journal.failConfig = null;
    vi.setSystemTime(10 * 60_000);
    const later = await load();
    expect(configCalls).toHaveLength(2);
    expect(later.state.live).toBe(true);
    expect(await poll()).toEqual(later.state);
  });

  it("remembers a baseline that could not read the journal, as over the read cap", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(0);
    journal.failTail = { code: "output_limit", message: "too much", exitCode: null };
    expect((await load()).state).toEqual({ live: false, reason: "unavailable", token: null });
    await load();
    expect(tailCalls).toHaveLength(1);
  });

  it("retries a baseline that only timed out after a minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(0);
    journal.failTail = BUSY;
    expect((await load()).state.live).toBe(false);
    await load();
    expect(tailCalls).toHaveLength(1);
    journal.failTail = null;
    vi.setSystemTime(60_000);
    expect((await load()).state.live).toBe(true);
    expect(tailCalls).toHaveLength(2);
  });
});

describe("one read per database", () => {
  it("shares one journal read among concurrent polls", async () => {
    await warm();
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

  it("never starts a second read while a slow one runs, and a load uses the last known position", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const shown = await warm();
    tailCalls.length = 0;
    let open: () => void = () => {};
    tailGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const slowPoll = poll();
    const loading = load();
    await vi.advanceTimersByTimeAsync(5_000);
    const loaded = await loading;
    // bd is busy: the load did not wait on it and took the position known before bv.
    expect(loaded.state).toEqual(shown);
    const laterPoll = poll();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(tailCalls).toHaveLength(1);
    expect(maxReadsInFlight).toBe(1);
    open();
    await slowPoll;
    await laterPoll;
    expect(maxReadsInFlight).toBe(1);
  });

  it("queues a baseline behind a running poll on the same database rather than running both", async () => {
    await warm();
    tailCalls.length = 0;
    let open: () => void = () => {};
    tailGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const slowPoll = poll();
    await new Promise((resolve) => setTimeout(resolve, 5));
    // A second workspace over the same database loads for the first time and baselines it.
    const other = (async () => {
      const before = await changesBeforeRead("ws-2", DIRECTORY);
      return await changesAfterRead("ws-2", DIRECTORY, BD_ROUTE, before);
    })();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(tailCalls).toHaveLength(1);
    open();
    await Promise.all([slowPoll, other]);
    expect(tailCalls).toHaveLength(2);
    expect(maxReadsInFlight).toBe(1);
  });
});
