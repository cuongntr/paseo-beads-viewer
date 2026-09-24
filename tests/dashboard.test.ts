import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { CommandResult } from "../server/command";
import {
  alertsPayload,
  facetsCsv,
  graphPayload,
  missingProjectPayload,
  planPayload,
  triagePayload,
} from "./fixtures";

/**
 * The dashboard handler is exercised without a Beads repository: `bv` is mocked
 * at the command boundary and the workspace comes from a fake Paseo API.
 */
const runBvVersion = vi.fn<(cwd: string) => Promise<CommandResult<string>>>();
const runBvJson = vi.fn();
const runTrackerFacets = vi.fn<() => Promise<CommandResult<string>>>();

vi.mock("../server/bv", () => ({
  runBvVersion: (cwd: string) => runBvVersion(cwd),
  runBvJson: (command: string, cwd: string, parse: (payload: unknown) => unknown) =>
    runBvJson(command, cwd, parse),
  runTrackerFacets: () => runTrackerFacets(),
}));

// The tracker CLI lookup must not depend on what is installed on this machine.
vi.mock("../server/command", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/command")>();
  return { ...actual, resolveExecutable: async (name: string) => (name === "bd" ? "/usr/bin/bd" : null) };
});

const { getDashboard } = await import("../server/dashboard");
const { clearDashboardCache } = await import("../server/dashboard");

// A real empty directory: the handler verifies its cwd exists before spawning,
// but nothing in the test writes or reads Beads state inside it.
const WORKSPACE_DIR = await mkdtemp(join(tmpdir(), "paseo-beads-test-"));
await mkdir(join(WORKSPACE_DIR, ".beads"));
await writeFile(join(WORKSPACE_DIR, ".beads", "metadata.json"), JSON.stringify({ backend: "dolt" }));
const routedTriagePayload = { ...triagePayload, source_path: join(WORKSPACE_DIR, ".beads", "issues.jsonl") };

function context(directory: string | null): PluginHandlerContext {
  return {
    paseo: {
      workspaces: {
        ref: () => ({
          refresh: async () =>
            directory === null ? null : { workspaceDirectory: directory, name: "repo", title: null },
        }),
      },
    },
  } as unknown as PluginHandlerContext;
}

function ok<Value>(value: Value): CommandResult<Value> {
  return { ok: true, value };
}

function err(code: "unavailable" | "timeout" | "exit", message: string, exitCode: number | null = null) {
  return { ok: false as const, error: { code, message, exitCode } };
}

/** `runBvJson` receives the caller's parser, so mocks must run it like the real one. */
function respond(map: Record<string, CommandResult<unknown>>) {
  runBvJson.mockImplementation(async (command: string, _cwd: string, parse: (payload: unknown) => unknown) => {
    const result = map[command];
    if (result === undefined) throw new Error(`unexpected bv command ${command}`);
    if (!result.ok) return result;
    const value = command === "triage" && result.value === triagePayload ? routedTriagePayload : result.value;
    return ok(parse(value));
  });
}

beforeEach(() => {
  clearDashboardCache();
  runBvVersion.mockReset();
  runBvJson.mockReset();
  runTrackerFacets.mockReset();
  runBvVersion.mockResolvedValue(ok("bv v0.25.0"));
  runTrackerFacets.mockResolvedValue(ok(facetsCsv));
});

describe("dashboard assembly", () => {
  it("reports every section as ok for a healthy project and names the tracker bv declared", async () => {
    respond({ triage: ok(triagePayload), plan: ok(planPayload), alerts: ok(alertsPayload), graph: ok(graphPayload) });
    const result = await getDashboard({ workspaceId: "ws-1" }, context(WORKSPACE_DIR));

    expect(result.projectState).toBe("ready");
    expect(result.directory).toBe(WORKSPACE_DIR);
    expect(result.tool).toEqual({ available: true, version: "bv v0.25.0", error: null });
    expect(result.tracker).toEqual({ kind: "bd", available: true, detail: null });
    expect(result.sections.triage.status).toBe("ok");
    expect(result.sections.plan.status).toBe("ok");
    expect(result.sections.alerts.status).toBe("ok");
    expect(result.counts?.total).toBe(49);
    expect(result.tracks).toHaveLength(1);
    expect(result.alerts).toHaveLength(3);
    expect(result.cached).toBe(false);
    // Triage, plan, alerts, and the graph are read in parallel.
    expect(runBvJson).toHaveBeenCalledTimes(4);
  });

  it("carries the whole issue graph onto the board, closed issues included", async () => {
    respond({ triage: ok(triagePayload), plan: ok(planPayload), alerts: ok(alertsPayload), graph: ok(graphPayload) });
    const result = await getDashboard({ workspaceId: "ws-1" }, context(WORKSPACE_DIR));

    expect(result.sections.graph.status).toBe("ok");
    expect(result.board.total).toBe(5);
    expect(result.board.truncated).toBe(false);
    // The board must carry issues triage never surfaced, in every status.
    expect(result.board.issues.map((entry) => entry.status).sort()).toEqual([
      "blocked",
      "closed",
      "closed",
      "in_progress",
      "open",
    ]);
    // Wiring check: these counts can only come from the graph's own edges.
    const byId = new Map(result.board.issues.map((entry) => [entry.id, entry]));
    expect(byId.get("pib-x1q9")?.unblocksCount).toBe(2);
    expect(byId.get("pib-blk1")?.blockedBy).toEqual(["pib-x1q9"]);
    // …and these two can only come from the tracker overlay.
    expect(result.board.typed).toBe(true);
    expect(byId.get("pib-x1q9")?.type).toBe("epic");
    expect(byId.get("pib-cyhm")?.assignee).toBe("ada");
  });

  it("keeps the board usable but untyped when the tracker rejects the facet read", async () => {
    respond({ triage: ok(triagePayload), plan: ok(planPayload), alerts: ok(alertsPayload), graph: ok(graphPayload) });
    runTrackerFacets.mockResolvedValue(err("exit", "br list failed: unknown flag --fields", 2));
    const result = await getDashboard({ workspaceId: "ws-1" }, context(WORKSPACE_DIR));

    // Losing the overlay costs the epic and type axes, nothing else.
    expect(result.sections.graph.status).toBe("ok");
    expect(result.board.total).toBe(5);
    expect(result.board.typed).toBe(false);
    expect(result.board.issues.every((entry) => entry.type === null)).toBe(true);
  });

  it("empties the board and marks the graph section when only the graph read fails", async () => {
    respond({
      triage: ok(triagePayload),
      plan: ok(planPayload),
      alerts: ok(alertsPayload),
      graph: err("timeout", "bv --robot-graph timed out."),
    });
    const result = await getDashboard({ workspaceId: "ws-1" }, context(WORKSPACE_DIR));

    // Every other section stays usable; only the board loses its source.
    expect(result.projectState).toBe("ready");
    expect(result.sections.triage.status).toBe("ok");
    expect(result.sections.graph).toEqual({
      status: "unavailable",
      error: { code: "timeout", message: "bv --robot-graph timed out.", exitCode: null },
    });
    expect(result.board).toEqual({ issues: [], typed: false, total: 0, truncated: false });
  });

  it("keeps triage usable when plan and alerts are unavailable", async () => {
    respond({
      triage: ok(triagePayload),
      plan: err("timeout", "bv --robot-plan timed out."),
      alerts: err("exit", "bv --robot-alerts failed: boom", 2),
      graph: ok(graphPayload),
    });
    const result = await getDashboard({ workspaceId: "ws-1" }, context(WORKSPACE_DIR));

    expect(result.projectState).toBe("ready");
    expect(result.sections.triage.status).toBe("ok");
    expect(result.recommendations).toHaveLength(2);
    expect(result.sections.plan).toEqual({
      status: "unavailable",
      error: { code: "timeout", message: "bv --robot-plan timed out.", exitCode: null },
    });
    expect(result.sections.alerts.error?.code).toBe("exit");
    expect(result.tracks).toEqual([]);
    expect(result.planSummary).toBeNull();
    expect(result.alerts).toEqual([]);
    expect(result.alertSummary).toBeNull();
  });

  it("still reports provenance when only alerts succeeded", async () => {
    respond({
      triage: err("timeout", "bv --robot-triage timed out."),
      plan: err("timeout", "bv --robot-plan timed out."),
      alerts: ok(alertsPayload),
      graph: err("timeout", "bv --robot-graph timed out."),
    });
    const result = await getDashboard({ workspaceId: "ws-1" }, context(WORKSPACE_DIR));

    expect(result.projectState).toBe("error");
    expect(result.source?.toolVersion).toBe("v0.25.0");
    expect(result.alerts).toHaveLength(3);
    expect(result.tracker.kind).toBeNull();
  });

  it("reports a workspace with no Beads source as missing, not as an error", async () => {
    respond({
      triage: ok(missingProjectPayload),
      plan: ok(missingProjectPayload),
      alerts: ok(missingProjectPayload),
      graph: ok(missingProjectPayload),
    });
    const result = await getDashboard({ workspaceId: "ws-1" }, context(WORKSPACE_DIR));

    expect(result.projectState).toBe("missing");
    expect(result.tool.available).toBe(true);
    expect(result.tracker.kind).toBeNull();
    expect(result.counts).toBeNull();
    expect(result.sections.triage.error?.message).toMatch(/failed to read beads directory/);
    expect(result.sections.plan.status).toBe("unavailable");
    expect(result.sections.alerts.status).toBe("unavailable");
  });

  it("reports bv as unavailable without running any analysis", async () => {
    runBvVersion.mockResolvedValue(err("unavailable", "bv was not found on the daemon PATH."));
    const result = await getDashboard({ workspaceId: "ws-1" }, context(WORKSPACE_DIR));

    expect(result.tool.available).toBe(false);
    expect(result.tool.error?.code).toBe("unavailable");
    expect(result.projectState).toBe("error");
    expect(runBvJson).not.toHaveBeenCalled();
  });

  it("reports an unresolvable workspace without spawning anything", async () => {
    const result = await getDashboard({ workspaceId: "ws-missing" }, context(null));

    expect(result.directory).toBeNull();
    expect(result.tool.error?.code).toBe("workspace_unresolved");
    expect(runBvVersion).not.toHaveBeenCalled();
    expect(runBvJson).not.toHaveBeenCalled();
  });

  it("serves a healthy result from the short-lived cache and marks it cached", async () => {
    respond({ triage: ok(triagePayload), plan: ok(planPayload), alerts: ok(alertsPayload), graph: ok(graphPayload) });
    const first = await getDashboard({ workspaceId: "ws-1" }, context(WORKSPACE_DIR));
    const second = await getDashboard({ workspaceId: "ws-1" }, context(WORKSPACE_DIR));

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(runBvJson).toHaveBeenCalledTimes(4);
  });

  it("bypasses the cache for an explicit refresh", async () => {
    respond({ triage: ok(triagePayload), plan: ok(planPayload), alerts: ok(alertsPayload), graph: ok(graphPayload) });
    await getDashboard({ workspaceId: "ws-1" }, context(WORKSPACE_DIR));
    const refreshed = await getDashboard({ workspaceId: "ws-1", refresh: true }, context(WORKSPACE_DIR));

    expect(refreshed.cached).toBe(false);
    expect(runBvJson).toHaveBeenCalledTimes(8);
  });

  it("does not let an older request overwrite a completed refresh", async () => {
    let releaseOld: () => void = () => {};
    let markOldStarted: () => void = () => {};
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    const oldStarted = new Promise<void>((resolve) => {
      markOldStarted = resolve;
    });
    let triageCalls = 0;
    runBvJson.mockImplementation(async (command: string, _cwd: string, parse: (payload: unknown) => unknown) => {
      if (command === "triage") {
        triageCalls += 1;
        const current = triageCalls;
        if (current === 1) {
          markOldStarted();
          await oldGate;
        }
        return ok(parse({ ...routedTriagePayload, data_hash: current === 1 ? "old" : "fresh" }));
      }
      return ok(parse(command === "plan" ? planPayload : alertsPayload));
    });

    const older = getDashboard({ workspaceId: "ws-1" }, context(WORKSPACE_DIR));
    await oldStarted;
    await getDashboard({ workspaceId: "ws-1", refresh: true }, context(WORKSPACE_DIR));
    releaseOld();
    await older;

    const cached = await getDashboard({ workspaceId: "ws-1" }, context(WORKSPACE_DIR));
    expect(cached.cached).toBe(true);
    expect(cached.source?.dataHash).toBe("fresh");
  });

  it("never caches a degraded triage read", async () => {
    respond({
      triage: err("timeout", "bv --robot-triage timed out."),
      plan: ok(planPayload),
      alerts: ok(alertsPayload),
      graph: ok(graphPayload),
    });
    await getDashboard({ workspaceId: "ws-1" }, context(WORKSPACE_DIR));
    const second = await getDashboard({ workspaceId: "ws-1" }, context(WORKSPACE_DIR));

    expect(second.cached).toBe(false);
    expect(runBvJson).toHaveBeenCalledTimes(8);
  });
});
