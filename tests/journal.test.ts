import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execPath } from "node:process";
import { clearExecutableCache, primeExecutableCache, runProcess } from "../server/command";
import {
  MAX_RECORD_LINE,
  journalConfigInvocation,
  journalTailInvocation,
  parseRecordLine,
  tailJournal,
} from "../server/journal";
import type { TrackerRoute } from "../server/tracker";

const DIRECTORY = await mkdtemp(join(tmpdir(), "paseo-beads-journal-"));
const ROUTE: TrackerRoute = { kind: "bd", beadsDirectory: join(DIRECTORY, ".beads"), database: join(DIRECTORY, ".beads") };

/**
 * A stand-in for `bd events tail`: its behaviour comes from FAKE_BD_MODE, and
 * it echoes nothing it was not asked for. Records are real bd 1.3 lines.
 */
const FAKE_BD = join(DIRECTORY, "fake-bd");
await writeFile(
  FAKE_BD,
  `#!${execPath}
const mode = process.env.FAKE_BD_MODE;
const args = process.argv.slice(2);
const since = Number(args[args.indexOf("--since") + 1]);
const line = (seq, extra = "") =>
  JSON.stringify({ seq, ts: "2026-09-28T05:05:" + String(seq % 60).padStart(2, "0") + "Z", op: "update", issue_id: "bd-" + seq, actor: "ada", issue: { id: "bd-" + seq, description: extra } }) + "\\n";
if (mode === "records") {
  let out = "";
  for (let seq = since + 1; seq <= 1200; seq += 1) out += line(seq, seq % 100 === 0 ? "x".repeat(${MAX_RECORD_LINE * 2}) : "short");
  process.stdout.write(out);
} else if (mode === "empty") {
  // Nothing after the head.
} else if (mode === "off") {
  process.stderr.write("note: the events journal is disabled for this workspace (enable with 'bd config set events-journal true'); any records shown were written while it was enabled, and new mutations are not being recorded\\n");
  process.stdout.write(line(1));
} else if (mode === "truncated") {
  process.stdout.write(JSON.stringify({ code: "events_journal_truncated", error: "events journal truncated", floor: 3, head: 4, schema_version: 1, since }, null, 2) + "\\n");
  process.exit(1);
} else if (mode === "unknown") {
  process.stderr.write('Error: unknown command "events" for "bd"\\n');
  process.exit(1);
}
`,
);
await chmod(FAKE_BD, 0o755);

afterEach(() => {
  delete process.env.FAKE_BD_MODE;
  clearExecutableCache();
});

async function tail(mode: string, since: number, maxOutputBytes = 64 * 1024 * 1024) {
  process.env.FAKE_BD_MODE = mode;
  primeExecutableCache("bd", FAKE_BD);
  return await tailJournal(ROUTE, DIRECTORY, since, null, { timeoutMs: 20_000, maxOutputBytes });
}

describe("journal argv", () => {
  it("pins the database, is read-only, and takes no user input", () => {
    expect(journalTailInvocation(ROUTE, 41, null).args).toEqual([
      "--db",
      ROUTE.database,
      "--readonly",
      "events",
      "tail",
      "--since",
      "41",
      "--json",
    ]);
    expect(journalTailInvocation(ROUTE, 5, 1).args).toContain("--limit");
    // bd rejects a negative --since; the reader never sends one.
    expect(journalTailInvocation(ROUTE, -1, null).args).toContain("0");
    expect(journalConfigInvocation(ROUTE).args).toEqual([
      "--db",
      ROUTE.database,
      "--readonly",
      "config",
      "get",
      "events-journal",
      "--json",
    ]);
    expect(journalConfigInvocation(ROUTE).env).toMatchObject({ BEADS_DIR: ROUTE.beadsDirectory, BEADS_DB: ROUTE.database });
  });
});

describe("journal tail", () => {
  it("streams a long journal keeping only the first and last record, cut lines included", async () => {
    const outcome = await tail("records", 0);
    expect(outcome).toEqual({
      kind: "records",
      first: { seq: 1, ts: "2026-09-28T05:05:01Z", op: "update", issueId: "bd-1" },
      // Seq 1200 carries a description twice the line cap, so only its prefix is read.
      last: { seq: 1200, ts: "2026-09-28T05:05:00Z", op: "update", issueId: "bd-1200" },
    });
  });

  it("starts where asked", async () => {
    const outcome = await tail("records", 1198);
    expect(outcome.kind === "records" ? [outcome.first?.seq, outcome.last?.seq] : null).toEqual([1199, 1200]);
  });

  it("reads nothing after the head as no records", async () => {
    expect(await tail("empty", 1200)).toEqual({ kind: "records", first: null, last: null });
  });

  it("recognises bd's journal-off note even when old records are printed", async () => {
    expect(await tail("off", 0)).toEqual({ kind: "off" });
  });

  it("reads the head out of the truncated error", async () => {
    expect(await tail("truncated", 0)).toEqual({ kind: "truncated", head: 4 });
  });

  it("reports a bd without the journal as a failure", async () => {
    const outcome = await tail("unknown", 0);
    expect(outcome.kind).toBe("failed");
    expect(outcome.kind === "failed" ? outcome.error.message : "").toMatch(/unknown command/);
  });

  it("stops at the byte cap instead of reading on", async () => {
    const outcome = await tail("records", 0, 32 * 1024);
    expect(outcome.kind === "failed" ? outcome.error.code : outcome.kind).toBe("output_limit");
  });

  it("is unavailable when bd is not installed", async () => {
    primeExecutableCache("bd", null);
    const outcome = await tailJournal(ROUTE, DIRECTORY, 0, null);
    expect(outcome.kind === "failed" ? outcome.error.code : outcome.kind).toBe("unavailable");
  });
});

describe("record lines", () => {
  it("reads the identifying fields from a whole line or a cut prefix", () => {
    const whole = '{"seq":7,"ts":"2026-09-28T05:05:27Z","op":"close","issue_id":"bd-wor","issue":{"title":"B"}}';
    const expected = { seq: 7, ts: "2026-09-28T05:05:27Z", op: "close", issueId: "bd-wor" };
    expect(parseRecordLine(whole, true)).toEqual(expected);
    expect(parseRecordLine(whole.slice(0, 80), false)).toEqual(expected);
    expect(parseRecordLine('{"seq":"x"}', true)).toBeNull();
    expect(parseRecordLine("{", false)).toBeNull();
  });
});

describe("streamed process output", () => {
  it("delivers lines across chunk boundaries and cuts an over-long line once", async () => {
    const lines: [string, boolean][] = [];
    const outcome = await runProcess({
      executable: execPath,
      args: ["-e", 'process.stdout.write("a\\nbb"); setTimeout(() => process.stdout.write("b\\n" + "z".repeat(50) + "\\ntail"), 20);'],
      cwd: DIRECTORY,
      lines: { maxLineLength: 10, onLine: (line, complete) => lines.push([line, complete]) },
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toBe("");
    expect(lines).toEqual([
      ["a", true],
      ["bbb", true],
      ["zzzzzzzzzz", false],
      ["tail", true],
    ]);
  });
});
