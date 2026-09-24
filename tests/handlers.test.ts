import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { CommandResult } from "../server/command";
import { attachmentSearchRpc, issueRpc, searchRpc } from "../shared/rpc";
import { brShowPayload, searchPayload, triagePayload } from "./fixtures";

const runBvJson = vi.fn();
const runTrackerShow = vi.fn();

vi.mock("../server/bv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/bv")>();
  return {
    ...actual,
    runBvJson: (command: string, cwd: string, parse: (payload: unknown) => unknown, params?: unknown) =>
      runBvJson(command, cwd, parse, params),
    runTrackerShow: (route: unknown, cwd: string, issueId: string, parse: (payload: unknown) => unknown) =>
      runTrackerShow(route, cwd, issueId, parse),
  };
});

vi.mock("../server/command", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/command")>();
  return { ...actual, resolveExecutable: async (name: string) => (name === "bd" ? "/usr/bin/bd" : null) };
});

const { searchIssues } = await import("../server/search");
const { getIssue } = await import("../server/issue");
const { searchAttachments } = await import("../server/attachments");
const { clearTrackerCache } = await import("../server/tracker");

const ROOT = await mkdtemp(join(tmpdir(), "paseo-beads-rpc-"));
const BEADS_DIR = join(ROOT, "with-beads");
const PLAIN_DIR = join(ROOT, "no-beads");
await mkdir(join(BEADS_DIR, ".beads"), { recursive: true });
await writeFile(join(BEADS_DIR, ".beads", "metadata.json"), JSON.stringify({ backend: "dolt" }));
await mkdir(PLAIN_DIR, { recursive: true });
const routedTriagePayload = { ...triagePayload, source_path: join(BEADS_DIR, ".beads", "issues.jsonl") };

function ok<Value>(value: Value): CommandResult<Value> {
  return { ok: true, value };
}

function err(code: "timeout" | "exit" | "unavailable", message: string) {
  return { ok: false as const, error: { code, message, exitCode: null } };
}

interface WorkspaceRecord {
  readonly id: string;
  readonly directory: string | null;
  readonly name: string;
}

function context(records: readonly WorkspaceRecord[], listFails = false): PluginHandlerContext {
  return {
    paseo: {
      workspaces: {
        ref: (id: string) => ({
          refresh: async () => {
            const record = records.find((entry) => entry.id === id);
            if (record === undefined || record.directory === null) return null;
            return { workspaceDirectory: record.directory, name: record.name, title: null };
          },
        }),
        list: async () => {
          if (listFails) throw new Error("daemon unreachable");
          return {
            entries: records.map((record) => ({
              id: record.id,
              name: record.name,
              title: null,
              workspaceDirectory: record.directory,
            })),
          };
        },
      },
    },
  } as unknown as PluginHandlerContext;
}

beforeEach(() => {
  clearTrackerCache();
  runBvJson.mockReset();
  runTrackerShow.mockReset();
});

describe("search handler", () => {
  it("passes a sanitized query and clamped limit to bv and normalizes results", async () => {
    runBvJson.mockImplementation(async (_command, _cwd, parse) => ok(parse(searchPayload)));
    const result = await searchIssues(
      { workspaceId: "ws-1", query: "  plugin   search  ", limit: 999 },
      context([{ id: "ws-1", directory: BEADS_DIR, name: "repo" }]),
    );

    expect(searchRpc.output.parse(result)).toEqual(result);
    expect(result.query).toBe("plugin search");
    expect(result.limit).toBe(25);
    expect(result.results.map((entry) => entry.id)).toEqual(["pib-cjo.2", "pib-yut.1", "pib-cikr.2"]);
    expect(result.error).toBeNull();
    expect(runBvJson).toHaveBeenCalledWith("search", BEADS_DIR, expect.any(Function), {
      query: "plugin search",
      limit: 25,
    });
  });

  it("rejects a blank query before spawning anything", async () => {
    const result = await searchIssues(
      { workspaceId: "ws-1", query: "   " },
      context([{ id: "ws-1", directory: BEADS_DIR, name: "repo" }]),
    );
    expect(result.results).toEqual([]);
    expect(result.error?.code).toBe("internal");
    expect(runBvJson).not.toHaveBeenCalled();
  });

  it("returns the command error rather than throwing", async () => {
    runBvJson.mockResolvedValue(err("timeout", "bv --robot-search timed out."));
    const result = await searchIssues(
      { workspaceId: "ws-1", query: "plugin" },
      context([{ id: "ws-1", directory: BEADS_DIR, name: "repo" }]),
    );
    expect(result.error?.code).toBe("timeout");
    expect(result.results).toEqual([]);
  });

  it("reports an unresolved workspace", async () => {
    const result = await searchIssues({ workspaceId: "nope", query: "plugin" }, context([]));
    expect(result.error?.code).toBe("workspace_unresolved");
    expect(runBvJson).not.toHaveBeenCalled();
  });
});

describe("issue handler", () => {
  it("detects the tracker from bv and reads the detail read-only", async () => {
    runBvJson.mockImplementation(async (_command, _cwd, parse) => ok(parse(routedTriagePayload)));
    runTrackerShow.mockImplementation(async (_tracker, _cwd, _id, parse) => ok(parse(brShowPayload)));

    const result = await getIssue(
      { workspaceId: "ws-1", issueId: "pib-33zb" },
      context([{ id: "ws-1", directory: BEADS_DIR, name: "repo" }]),
    );

    expect(issueRpc.output.parse(result)).toEqual(result);
    expect(result.tracker).toEqual({ kind: "bd", available: true, detail: null });
    expect(result.issue?.id).toBe("pib-33zb");
    expect(result.error).toBeNull();
    expect(runTrackerShow).toHaveBeenCalledWith(
      { kind: "bd", beadsDirectory: join(BEADS_DIR, ".beads"), database: join(BEADS_DIR, ".beads") },
      BEADS_DIR,
      "pib-33zb",
      expect.any(Function),
    );
  });

  it("uses tracker metadata when bv recommendations do not name a tracker", async () => {
    // No recommendation carries `actions.tracker`; metadata binds this workspace to bd.
    runBvJson.mockImplementation(async (_command, _cwd, parse) =>
      ok(parse({ ...routedTriagePayload, triage: { recommendations: [] } })),
    );
    runTrackerShow.mockImplementation(async (_tracker, _cwd, _id, parse) => ok(parse(brShowPayload)));
    const result = await getIssue(
      { workspaceId: "ws-1", issueId: "pib-33zb" },
      context([{ id: "ws-1", directory: BEADS_DIR, name: "repo" }]),
    );
    expect(result.tracker.kind).toBe("bd");
    expect(result.tracker.detail).toBeNull();
  });

  it("returns tracker_unknown without spawning when detection fails", async () => {
    runBvJson.mockResolvedValue(err("exit", "bv --robot-triage failed: no beads directory"));
    const result = await getIssue(
      { workspaceId: "ws-1", issueId: "pib-33zb" },
      context([{ id: "ws-1", directory: BEADS_DIR, name: "repo" }]),
    );
    expect(result.issue).toBeNull();
    expect(result.error?.code).toBe("tracker_unknown");
    expect(runTrackerShow).not.toHaveBeenCalled();
  });

  it("surfaces a malformed detail payload as an error, not a partial issue", async () => {
    runBvJson.mockImplementation(async (_command, _cwd, parse) => ok(parse(routedTriagePayload)));
    runTrackerShow.mockResolvedValue(err("exit", "bd show --json failed: unknown id"));
    const result = await getIssue(
      { workspaceId: "ws-1", issueId: "pib-nope" },
      context([{ id: "ws-1", directory: BEADS_DIR, name: "repo" }]),
    );
    expect(result.issue).toBeNull();
    expect(result.error?.code).toBe("exit");
  });
});

describe("attachment handler", () => {
  it("only searches workspaces that have a .beads directory", async () => {
    runBvJson.mockImplementation(async (command, _cwd, parse) =>
      ok(parse(command === "search" ? searchPayload : routedTriagePayload)),
    );
    runTrackerShow.mockImplementation(async (_tracker, _cwd, _id, parse) => ok(parse(brShowPayload)));

    const result = await searchAttachments(
      { query: "plugin" },
      context([
        { id: "ws-plain", directory: PLAIN_DIR, name: "plain" },
        { id: "ws-beads", directory: BEADS_DIR, name: "repo" },
      ]),
    );

    expect(attachmentSearchRpc.output.parse(result)).toEqual(result);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((item) => item.id.startsWith("ws-beads:"))).toBe(true);
    for (const call of runBvJson.mock.calls) {
      expect(call[1]).toBe(BEADS_DIR);
    }
  });

  it("returns valid urls, resource types, and detail-bearing snapshots", async () => {
    runBvJson.mockImplementation(async (command, _cwd, parse) =>
      ok(parse(command === "search" ? searchPayload : routedTriagePayload)),
    );
    runTrackerShow.mockImplementation(async (_tracker, _cwd, _id, parse) => ok(parse(brShowPayload)));

    const result = await searchAttachments(
      { query: "plugin" },
      context([{ id: "ws-beads", directory: BEADS_DIR, name: "repo" }]),
    );

    const first = result.items[0];
    expect(first).toBeDefined();
    expect(first?.url).toMatch(/^beads-viewer:\/\/workspace\/ws-beads\/issue\//);
    expect(first?.resourceType).toBe("beads_issue");
    expect(first?.subtitle).toContain("repo");
    expect(first?.text).toContain("Paseo workspace: repo");
    expect(first?.text).toContain("## Description");
  });

  it("still includes an item when the detail read fails", async () => {
    runBvJson.mockImplementation(async (command, _cwd, parse) =>
      ok(parse(command === "search" ? searchPayload : routedTriagePayload)),
    );
    runTrackerShow.mockResolvedValue(err("timeout", "bd show --json timed out."));

    const result = await searchAttachments(
      { query: "plugin" },
      context([{ id: "ws-beads", directory: BEADS_DIR, name: "repo" }]),
    );
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0]?.text).toContain("Detail unavailable");
  });

  it("keeps results from healthy workspaces when another workspace fails", async () => {
    const OTHER = join(ROOT, "with-beads-2");
    await mkdir(join(OTHER, ".beads"), { recursive: true });
    runBvJson.mockImplementation(async (command, cwd, parse) => {
      if (cwd === OTHER) return err("timeout", "bv --robot-search timed out.");
      return ok(parse(command === "search" ? searchPayload : routedTriagePayload));
    });
    runTrackerShow.mockImplementation(async (_tracker, _cwd, _id, parse) => ok(parse(brShowPayload)));

    const result = await searchAttachments(
      { query: "plugin" },
      context([
        { id: "ws-broken", directory: OTHER, name: "broken" },
        { id: "ws-beads", directory: BEADS_DIR, name: "repo" },
      ]),
    );
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((item) => item.id.startsWith("ws-beads:"))).toBe(true);
  });

  it("bounds the returned item count and deduplicates per workspace", async () => {
    const many = {
      results: Array.from({ length: 40 }, (_unused, index) => ({
        issue_id: `pib-${index}`,
        title: `Issue ${index}`,
        score: 1 - index / 100,
      })),
    };
    runBvJson.mockImplementation(async (command, _cwd, parse) =>
      ok(parse(command === "search" ? many : routedTriagePayload)),
    );
    runTrackerShow.mockImplementation(async (_tracker, _cwd, _id, parse) => ok(parse(brShowPayload)));

    const result = await searchAttachments(
      { query: "plugin" },
      context([
        { id: "ws-a", directory: BEADS_DIR, name: "a" },
        { id: "ws-b", directory: BEADS_DIR, name: "b" },
      ]),
    );
    expect(result.items.length).toBeLessThanOrEqual(8);
    expect(new Set(result.items.map((item) => item.id)).size).toBe(result.items.length);
  });

  it("returns nothing for a blank query and never lists workspaces", async () => {
    const result = await searchAttachments({ query: "  " }, context([{ id: "ws", directory: BEADS_DIR, name: "r" }]));
    expect(result.items).toEqual([]);
    expect(runBvJson).not.toHaveBeenCalled();
  });

  it("returns nothing when the workspace list cannot be read", async () => {
    const result = await searchAttachments(
      { query: "plugin" },
      context([{ id: "ws", directory: BEADS_DIR, name: "r" }], true),
    );
    expect(result.items).toEqual([]);
    expect(runBvJson).not.toHaveBeenCalled();
  });
});
