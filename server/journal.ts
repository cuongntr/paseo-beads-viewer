import type { CommandError } from "../shared/beads";
import { trackerEnvironment } from "./bv";
import {
  DEFAULT_LIMITS,
  resolveExecutable,
  runJsonCommand,
  runProcess,
  summarizeStderr,
  type CommandLimits,
  type CommandResult,
  type ProcessOutcome,
} from "./command";
import { asRecord } from "./normalize";
import type { TrackerRoute } from "./tracker";

/**
 * Reads of the `bd` 1.3 events journal: whether it is on, and which records
 * follow a sequence number. Both are `--readonly`, take no user input, and
 * never write the journal or its configuration.
 */

/** What identifies one journal record. Each clone counts its own seq, so seq alone is not enough. */
export interface JournalMark {
  readonly seq: number;
  readonly ts: string;
  readonly op: string;
  readonly issueId: string;
}

export type TailOutcome =
  /** `first` and `last` of the records after `since`; both null when there were none. */
  | { readonly kind: "records"; readonly first: JournalMark | null; readonly last: JournalMark | null }
  /** bd says the journal is off; records it prints were written while it was on. */
  | { readonly kind: "off" }
  /** `since` fell below the retained window; `head` is the highest seq ever assigned. */
  | { readonly kind: "truncated"; readonly head: number }
  | { readonly kind: "failed"; readonly error: CommandError };

/**
 * A poll reads what changed in about five seconds; more than this is a bulk
 * change. An idle read takes about 0.1-0.25 s, but a reader waits behind a
 * bulk writer's lock (measured 19 s behind three 40-issue updates) without
 * slowing it, so the wait is allowed to run well past the poll interval; the
 * caller keeps one read per database and retries a timeout with backoff.
 */
export const POLL_TAIL_LIMITS: CommandLimits = { timeoutMs: 20_000, maxOutputBytes: 16 * 1024 * 1024 };

/**
 * A baseline reads the whole journal to find its head, since bd has no head
 * query. Streamed, it holds one line at a time; bd's default retention of 100k
 * records measured at about 1 KB each fits well inside this.
 */
export const BASELINE_TAIL_LIMITS: CommandLimits = { timeoutMs: 30_000, maxOutputBytes: 512 * 1024 * 1024 };

/** Records carry full issue state; only their leading fields are needed. */
export const MAX_RECORD_LINE = 64 * 1024;

const CONFIG_LIMITS: CommandLimits = { timeoutMs: 10_000, maxOutputBytes: 64 * 1024 };
const MAX_OTHER_OUTPUT = 64 * 1024;
const OFF_NOTE = /events journal is disabled/i;
const RECORD_PREFIX = /^\{"seq":(\d+),"ts":"([^"\\]*)","op":"([^"\\]*)","issue_id":"([^"\\]*)"/;

export function journalConfigInvocation(route: TrackerRoute) {
  return {
    args: ["--db", route.database, "--readonly", "config", "get", "events-journal", "--json"],
    env: trackerEnvironment(route),
  } as const;
}

export function journalTailInvocation(route: TrackerRoute, since: number, limit: number | null) {
  const safeSince = Number.isSafeInteger(since) && since > 0 ? since : 0;
  const limitArgs = limit === null ? [] : ["--limit", String(Math.max(1, Math.trunc(limit)))];
  return {
    args: [
      "--db",
      route.database,
      "--readonly",
      "events",
      "tail",
      "--since",
      String(safeSince),
      ...limitArgs,
      "--json",
    ],
    env: trackerEnvironment(route),
  } as const;
}

/** bd reports `BD_EVENTS_JOURNAL=1` as the value "1"; accept every truthy spelling. */
const TRUTHY = new Set(["1", "t", "true", "y", "yes", "on"]);

export function parseJournalEnabled(payload: unknown): boolean {
  const value = asRecord(payload)?.["value"];
  if (value === undefined) throw new Error("no value");
  if (value === true || value === 1) return true;
  return typeof value === "string" && TRUTHY.has(value.trim().toLowerCase());
}

/** True only when the workspace's own configuration turns the journal on. */
export async function readJournalEnabled(route: TrackerRoute, cwd: string): Promise<CommandResult<boolean>> {
  const invocation = journalConfigInvocation(route);
  return await runJsonCommand(
    {
      label: "bd config get events-journal",
      executableName: "bd",
      args: invocation.args,
      cwd,
      env: invocation.env,
      limits: CONFIG_LIMITS,
      processGroup: true,
    },
    parseJournalEnabled,
  );
}

/** Reads the identifying fields of one record line; a cut line still has them first. */
export function parseRecordLine(line: string, complete: boolean): JournalMark | null {
  if (complete) {
    try {
      const record = asRecord(JSON.parse(line) as unknown);
      const seq = record?.["seq"];
      if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq <= 0) return null;
      const text = (key: string): string => (typeof record?.[key] === "string" ? (record[key] as string) : "");
      return { seq, ts: text("ts"), op: text("op"), issueId: text("issue_id") };
    } catch {
      return null;
    }
  }
  const match = RECORD_PREFIX.exec(line);
  if (match === null) return null;
  const seq = Number(match[1]);
  if (!Number.isSafeInteger(seq) || seq <= 0) return null;
  return { seq, ts: match[2] ?? "", op: match[3] ?? "", issueId: match[4] ?? "" };
}

function failed(code: CommandError["code"], message: string, exitCode: number | null = null): TailOutcome {
  return { kind: "failed", error: { code, message, exitCode } };
}

/** Folds a streamed tail into its outcome. Exported for tests. */
export function tailCollector() {
  let first: JournalMark | null = null;
  let last: JournalMark | null = null;
  let malformed = false;
  let other = "";
  return {
    onLine(line: string, complete: boolean) {
      if (line.startsWith('{"seq":')) {
        const mark = parseRecordLine(line, complete);
        if (mark === null) {
          malformed = true;
          return;
        }
        first ??= mark;
        last = mark;
        return;
      }
      if (other.length < MAX_OTHER_OUTPUT) other += `${line}\n`;
    },
    finish(label: string, outcome: ProcessOutcome): TailOutcome {
      if (outcome.truncated) return failed("output_limit", `${label} produced more output than the plugin accepts.`);
      if (outcome.timedOut) return failed("timeout", `${label} timed out.`);
      if (OFF_NOTE.test(outcome.stderr)) return { kind: "off" };
      if (outcome.exitCode !== 0) {
        let payload: Record<string, unknown> | null = null;
        try {
          payload = asRecord(JSON.parse(other.trim()) as unknown);
        } catch {
          payload = null;
        }
        const head = payload?.["head"];
        if (payload?.["code"] === "events_journal_truncated" && typeof head === "number" && Number.isSafeInteger(head)) {
          return { kind: "truncated", head };
        }
        const detail =
          (typeof payload?.["error"] === "string" ? payload["error"] : "") || summarizeStderr(outcome.stderr);
        return failed("exit", detail.length > 0 ? `${label} failed: ${detail}` : `${label} failed.`, outcome.exitCode);
      }
      if (malformed) return failed("invalid_json", `${label} returned a record that could not be read.`);
      return { kind: "records", first, last };
    },
  };
}

/**
 * Streams the records after `since`, keeping only the first and the last, so a
 * journal of any length costs one bounded line of memory.
 */
export async function tailJournal(
  route: TrackerRoute,
  cwd: string,
  since: number,
  limit: number | null,
  limits: CommandLimits = DEFAULT_LIMITS,
): Promise<TailOutcome> {
  const label = "bd events tail";
  const executable = await resolveExecutable("bd");
  if (executable === null) return failed("unavailable", "bd was not found on the daemon PATH.");
  const invocation = journalTailInvocation(route, since, limit);
  const collector = tailCollector();
  let outcome: ProcessOutcome;
  try {
    outcome = await runProcess({
      executable,
      args: invocation.args,
      cwd,
      env: invocation.env,
      limits,
      processGroup: true,
      lines: { maxLineLength: MAX_RECORD_LINE, onLine: collector.onLine },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "spawn failed";
    return failed("unavailable", `${label} could not start: ${message}`);
  }
  return collector.finish(label, outcome);
}
