import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandResult, JsonCommandRequest } from "../server/command";

/** The facet read is exercised at the command boundary; no tracker is spawned. */
const runTextCommand = vi.fn<(request: JsonCommandRequest) => Promise<CommandResult<string>>>();
const runJsonProcess = vi.fn<(request: JsonCommandRequest) => Promise<CommandResult<unknown>>>();

vi.mock("../server/command", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/command")>()),
  runTextCommand: (request: JsonCommandRequest) => runTextCommand(request),
  runJsonCommand: async (request: JsonCommandRequest, parse: (payload: unknown) => unknown) => {
    const result = await runJsonProcess(request);
    return result.ok ? { ok: true, value: parse(result.value) } : result;
  },
}));

const { FACET_FIELDS_BASE, FACET_FIELDS_WITH_TIMES, runTrackerFacets } = await import("../server/bv");

/** Captured from `bd 1.3.0` against a scratch workspace: one closed bug, one assigned feature, one epic. */
const bdBriefList = JSON.parse(
  await readFile(join(import.meta.dirname, "fixtures", "bd-1.3-list-brief.json"), "utf8"),
) as unknown;

const route = { kind: "br" as const, beadsDirectory: "/repo/.beads", database: "/repo/.beads/beads.db" };
const bdRoute = { kind: "bd" as const, beadsDirectory: "/repo/.beads", database: "/repo/.beads" };
const fieldsOf = (call: number) => {
  const args = runTextCommand.mock.calls[call]?.[0].args ?? [];
  return args[args.indexOf("--fields") + 1];
};
const rejected = (message: string) => ({ ok: false as const, error: { code: "exit" as const, message, exitCode: 1 } });

describe("tracker facet read", () => {
  beforeEach(() => {
    runTextCommand.mockReset();
    runJsonProcess.mockReset();
  });

  it("asks br for update and close times first, as CSV, with its safety flags", async () => {
    runTextCommand.mockResolvedValue({ ok: true, value: "id,issue_type,assignee,updated_at,closed_at\nk-1,task,ada,," });
    const result = await runTrackerFacets(route, "/repo");
    expect(runJsonProcess).not.toHaveBeenCalled();
    expect(runTextCommand).toHaveBeenCalledTimes(1);
    expect(runTextCommand.mock.calls[0]?.[0].args).toEqual([
      "--db",
      "/repo/.beads/beads.db",
      "--no-auto-import",
      "--no-auto-flush",
      "list",
      "--status",
      "all",
      "--fields",
      FACET_FIELDS_WITH_TIMES,
      "--format",
      "csv",
    ]);
    expect(result.ok && result.value.byId.get("k-1")?.assignee).toBe("ada");
  });

  it("falls back to the base columns when the tracker rejects the timestamps", async () => {
    runTextCommand
      .mockResolvedValueOnce({ ok: false, error: { code: "exit", message: "unknown field updated_at", exitCode: 2 } })
      .mockResolvedValueOnce({ ok: true, value: "id,issue_type,assignee\nk-1,epic," });
    const result = await runTrackerFacets(route, "/repo");
    expect(result.ok).toBe(true);
    expect(fieldsOf(1)).toBe(FACET_FIELDS_BASE);
  });

  it("does not retry a failure the columns could not have caused", async () => {
    runTextCommand.mockResolvedValue({ ok: false, error: { code: "unavailable", message: "br missing", exitCode: null } });
    const result = await runTrackerFacets(route, "/repo");
    expect(result.ok).toBe(false);
    expect(runTextCommand).toHaveBeenCalledTimes(1);
  });

  it("asks bd for its brief read-only JSON list, with a literal argv and the route's environment", async () => {
    runJsonProcess.mockResolvedValue({ ok: true, value: bdBriefList });
    const result = await runTrackerFacets(bdRoute, "/repo");
    expect(runTextCommand).not.toHaveBeenCalled();
    const request = runJsonProcess.mock.calls[0]?.[0];
    expect(request?.executableName).toBe("bd");
    expect(request?.args).toEqual([
      "--db",
      "/repo/.beads",
      "--readonly",
      "list",
      "--all",
      "--flat",
      "--limit",
      "0",
      "--brief",
      "--skip-labels",
      "--include-infra",
      "--include-gates",
      "--include-templates",
      "--json",
    ]);
    expect(request?.env).toEqual({
      BEADS_DIR: "/repo/.beads",
      BEADS_DB: "/repo/.beads",
      BEADS_JSONL: null,
      BD_DB: "/repo/.beads",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.byId.get("fx-6ye")).toEqual({
      type: "bug",
      assignee: null,
      updatedAt: "2026-09-28T05:01:40.000Z",
      closedAt: "2026-09-28T05:01:40.000Z",
    });
    expect(result.value.byId.get("fx-d54")).toEqual({
      type: "feature",
      assignee: "Ada Lovelace",
      updatedAt: "2026-09-28T05:01:40.000Z",
      closedAt: null,
    });
  });

  it("falls back to the CSV read for a bd that rejects the JSON flags", async () => {
    runJsonProcess.mockResolvedValue(rejected("bd list --brief --json failed: unknown flag: --brief"));
    runTextCommand.mockResolvedValue({ ok: true, value: "id,issue_type,assignee,updated_at,closed_at\nk-1,epic,,," });
    const result = await runTrackerFacets(bdRoute, "/repo");
    expect(result.ok && result.value.byId.get("k-1")?.type).toBe("epic");
    expect(runTextCommand.mock.calls[0]?.[0].args.slice(0, 3)).toEqual(["--db", "/repo/.beads", "list"]);
  });

  it("reports failure when bd rejects every form, so the dashboard drops the overlay", async () => {
    runJsonProcess.mockResolvedValue(rejected("unknown flag: --brief"));
    runTextCommand.mockResolvedValue(rejected("unknown flag: --fields"));
    const result = await runTrackerFacets(bdRoute, "/repo");
    expect(result.ok).toBe(false);
    expect(runTextCommand).toHaveBeenCalledTimes(2);
  });

  it("does not fall back to CSV when bd's JSON read failed for a reason flags could not cause", async () => {
    runJsonProcess.mockResolvedValue({ ok: false, error: { code: "output_limit", message: "too big", exitCode: null } });
    const result = await runTrackerFacets(bdRoute, "/repo");
    expect(result.ok).toBe(false);
    expect(runTextCommand).not.toHaveBeenCalled();
  });
});
