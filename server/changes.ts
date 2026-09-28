import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { ChangeReason, ChangeState } from "../shared/beads";
import { changesRpc } from "../shared/rpc";
import {
  BASELINE_TAIL_LIMITS,
  POLL_TAIL_LIMITS,
  readJournalEnabled,
  tailJournal,
  type JournalMark,
} from "./journal";
import type { TrackerRoute } from "./tracker";
import { resolveWorkspaceTarget } from "./workspace";

/**
 * Live refresh for `bd` workspaces whose events journal is on. The server keeps
 * one checkpoint per workspace: the last journal record the panel's dashboard
 * has accounted for. A poll asks bd for the records from that checkpoint on,
 * in one short read, and the token moves when anything follows it.
 *
 * The read starts at the checkpoint record itself rather than after it, so the
 * same read proves the checkpoint still exists in this journal. Each clone
 * counts its own seq, so after a clone switch, reset or restore the record is
 * gone or different, and a checkpoint above the head would otherwise read as
 * "nothing new" forever. Any such doubt re-baselines on the next dashboard load
 * and moves the token so that load happens.
 *
 * Everything here degrades to "not live": the panel then behaves as before,
 * with manual Refresh.
 */

interface LiveEntry {
  readonly database: string;
  readonly route: TrackerRoute;
  readonly cwd: string;
  /** Last record accounted for; null when the journal was empty. */
  checkpoint: JournalMark | null;
  generation: number;
  /** Set when the checkpoint can no longer be trusted; the next dashboard load re-reads the head. */
  stale: boolean;
  /** `live` while polling makes sense; anything else stops the panel's polling. */
  reason: ChangeReason;
}

const MAX_ENTRIES = 64;
/** Distinguishes tokens across plugin reloads, which reset the generation counter. */
const INSTANCE = Math.random().toString(36).slice(2, 10);
/** One counter for every workspace, so no two states ever share a token. */
let lastGeneration = 0;

function nextGeneration(): number {
  lastGeneration += 1;
  return lastGeneration;
}

const entries = new Map<string, LiveEntry>();
const checks = new Map<string, Promise<ChangeState>>();
const baselines = new Map<string, Promise<ChangeState>>();

export function clearChangeState(): void {
  entries.clear();
  checks.clear();
  baselines.clear();
}

function entryKey(workspaceId: string, directory: string): string {
  return `${workspaceId}\0${directory}`;
}

export function notLive(reason: Exclude<ChangeReason, "live">): ChangeState {
  return { live: false, reason, token: null };
}

function tokenOf(entry: LiveEntry): string {
  return `${INSTANCE}.${entry.generation}.${entry.checkpoint?.seq ?? 0}`;
}

function stateOf(entry: LiveEntry): ChangeState {
  return entry.reason === "live" ? { live: true, reason: "live", token: tokenOf(entry) } : notLive(entry.reason);
}

function remember(key: string, entry: LiveEntry): void {
  entries.delete(key);
  if (entries.size >= MAX_ENTRIES) {
    const oldest = entries.keys().next();
    if (!oldest.done) entries.delete(oldest.value);
  }
  entries.set(key, entry);
}

function sameMark(left: JournalMark, right: JournalMark): boolean {
  return left.seq === right.seq && left.ts === right.ts && left.op === right.op && left.issueId === right.issueId;
}

/** Marks the checkpoint untrustworthy and moves the token so the panel reloads. */
function invalidate(entry: LiveEntry): void {
  entry.stale = true;
  entry.generation = nextGeneration();
}

/** The single journal read a poll costs. */
async function checkEntry(entry: LiveEntry): Promise<void> {
  if (entry.reason !== "live" || entry.stale) return;
  const checkpoint = entry.checkpoint;
  const outcome = await tailJournal(
    entry.route,
    entry.cwd,
    checkpoint === null ? 0 : checkpoint.seq - 1,
    null,
    POLL_TAIL_LIMITS,
  );
  switch (outcome.kind) {
    case "off":
      entry.reason = "journal-off";
      return;
    case "truncated":
      invalidate(entry);
      return;
    case "failed":
      // More than a poll accepts is a bulk change: certainly news, and the head
      // is then re-read by the reload rather than by this poll.
      if (outcome.error.code === "output_limit") invalidate(entry);
      else entry.reason = "unavailable";
      return;
    case "records": {
      if (checkpoint !== null && (outcome.first === null || !sameMark(outcome.first, checkpoint))) {
        invalidate(entry);
        return;
      }
      const last = outcome.last;
      if (last !== null && last.seq > (checkpoint?.seq ?? 0)) {
        entry.checkpoint = last;
        entry.generation = nextGeneration();
      }
      return;
    }
  }
}

async function sharedCheck(key: string, entry: LiveEntry): Promise<ChangeState> {
  const active = checks.get(key);
  if (active !== undefined) return await active;
  const run = (async () => {
    await checkEntry(entry);
    // A baseline may have replaced this entry meanwhile; report what is current.
    const current = entries.get(key);
    return current === undefined ? notLive("unavailable") : stateOf(current);
  })();
  checks.set(key, run);
  try {
    return await run;
  } catch {
    return notLive("unavailable");
  } finally {
    checks.delete(key);
  }
}

/** Finds the head by reading the journal once, streamed; a truncated journal names it instead. */
async function readHead(route: TrackerRoute, cwd: string): Promise<{ ok: true; mark: JournalMark | null } | { ok: false; reason: ChangeReason }> {
  const full = await tailJournal(route, cwd, 0, null, BASELINE_TAIL_LIMITS);
  if (full.kind === "records") return { ok: true, mark: full.last };
  if (full.kind === "off") return { ok: false, reason: "journal-off" };
  if (full.kind === "failed") return { ok: false, reason: "unavailable" };
  const atHead = await tailJournal(route, cwd, full.head - 1, 1, POLL_TAIL_LIMITS);
  if (atHead.kind === "records" && atHead.first !== null && atHead.first.seq === full.head) {
    return { ok: true, mark: atHead.first };
  }
  return { ok: false, reason: atHead.kind === "off" ? "journal-off" : "unavailable" };
}

async function baseline(key: string, route: TrackerRoute, cwd: string): Promise<ChangeState> {
  const enabled = await readJournalEnabled(route, cwd);
  const base = { database: route.database, route, cwd, checkpoint: null, generation: nextGeneration(), stale: false };
  if (!enabled.ok || !enabled.value) {
    const reason: ChangeReason = enabled.ok ? "journal-off" : "unavailable";
    remember(key, { ...base, reason });
    return notLive(reason);
  }
  const head = await readHead(route, cwd);
  const entry: LiveEntry = head.ok
    ? { ...base, checkpoint: head.mark, reason: "live" }
    : { ...base, reason: head.reason };
  remember(key, entry);
  return stateOf(entry);
}

function sharedBaseline(key: string, route: TrackerRoute, cwd: string): Promise<ChangeState> {
  const active = baselines.get(key);
  if (active !== undefined) return active;
  const run = baseline(key, route, cwd)
    .catch(() => notLive("unavailable"))
    .finally(() => baselines.delete(key));
  baselines.set(key, run);
  return run;
}

/**
 * Called by a dashboard load before it reads bv: the journal position the
 * snapshot is at least as new as. Null when no live checkpoint is known yet.
 */
export async function changesBeforeRead(workspaceId: string, directory: string): Promise<ChangeState | null> {
  const key = entryKey(workspaceId, directory);
  const entry = entries.get(key);
  if (entry === undefined || entry.reason !== "live" || entry.stale) return null;
  return await sharedCheck(key, entry);
}

/**
 * Called by a dashboard load once the tracker route is known. Keeps the early
 * reading when the checkpoint is still sound for this exact database, and
 * otherwise re-baselines: first load, a different database, a stale
 * checkpoint, or a workspace that was not live (so turning the journal on
 * takes effect on the next Refresh).
 */
export async function changesAfterRead(
  workspaceId: string,
  directory: string,
  route: TrackerRoute | null,
  before: ChangeState | null,
): Promise<ChangeState> {
  const key = entryKey(workspaceId, directory);
  if (route === null || route.kind !== "bd") {
    entries.delete(key);
    return notLive(route === null ? "unavailable" : "not-bd");
  }
  const entry = entries.get(key);
  if (before !== null && before.live && entry !== undefined && entry.database === route.database && !entry.stale) {
    return stateOf(entry);
  }
  return await sharedBaseline(key, route, directory);
}

/** The poll: at most one short bd read, shared by concurrent callers, never bv. */
export async function getChanges(
  input: RpcInput<typeof changesRpc>,
  context: PluginHandlerContext,
): Promise<RpcOutput<typeof changesRpc>> {
  try {
    const workspace = await resolveWorkspaceTarget(context, input.workspaceId);
    if (!workspace.ok) return notLive("unavailable");
    const key = entryKey(input.workspaceId, workspace.value.directory);
    const entry = entries.get(key);
    if (entry === undefined) return notLive("unavailable");
    if (entry.reason !== "live" || entry.stale) return stateOf(entry);
    return await sharedCheck(key, entry);
  } catch {
    return notLive("unavailable");
  }
}
