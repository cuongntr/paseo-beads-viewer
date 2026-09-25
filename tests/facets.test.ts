import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandResult } from "../server/command";

/** The facet read is exercised at the command boundary; no tracker is spawned. */
const runTextCommand = vi.fn<(request: { args: readonly string[] }) => Promise<CommandResult<string>>>();

vi.mock("../server/command", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/command")>()),
  runTextCommand: (request: { args: readonly string[] }) => runTextCommand(request),
}));

const { FACET_FIELDS_BASE, FACET_FIELDS_WITH_TIMES, runTrackerFacets } = await import("../server/bv");

const route = { kind: "br" as const, beadsDirectory: "/repo/.beads", database: "/repo/.beads/beads.db" };
const fieldsOf = (call: number) => {
  const args = runTextCommand.mock.calls[call]?.[0].args ?? [];
  return args[args.indexOf("--fields") + 1];
};

describe("tracker facet read", () => {
  beforeEach(() => runTextCommand.mockReset());

  it("asks for update and close times first", async () => {
    runTextCommand.mockResolvedValue({ ok: true, value: "id,issue_type,assignee,updated_at,closed_at\n" });
    await runTrackerFacets(route, "/repo");
    expect(runTextCommand).toHaveBeenCalledTimes(1);
    expect(fieldsOf(0)).toBe(FACET_FIELDS_WITH_TIMES);
  });

  it("falls back to the base columns when the tracker rejects the timestamps", async () => {
    runTextCommand
      .mockResolvedValueOnce({ ok: false, error: { code: "exit", message: "unknown field updated_at", exitCode: 2 } })
      .mockResolvedValueOnce({ ok: true, value: "id,issue_type,assignee\n" });
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
});
