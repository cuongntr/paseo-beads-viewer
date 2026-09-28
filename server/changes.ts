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
 * Live refresh for `bd` workspaces whose events journal is on.
 *
 * The server keeps one checkpoint per workspace: the newest journal record it
 * has read. A token names a journal position (checkpoint seq plus an epoch that
 * changes on every baseline), and a poll returns the current one. A dashboard
 * snapshot carries the position read *before* bv read the project, never a
 * later one, so its token can only be older than its data: a write that lands
 * during the load moves the next poll's token and the panel reloads once more.
 * When no position could be read before bv (the first load of a workspace, or
 * a different database), the snapshot gets a pending token no poll ever
 * returns, so the next poll forces exactly one reload, which then reads a
 * position first.
 *
 * A poll reads from the checkpoint record itself, so the same read proves the
 * checkpoint still exists in this journal. Each clone counts its own seq, so
 * after a clone switch, reset or restore the record is gone or different, and a
 * checkpoint above the head would otherwise read as "nothing new" forever. Such
 * doubt marks the checkpoint stale and moves the token; the reload re-baselines
 * before bv.
 *
 * A failed or timed-out read is expected while bd is busy (a reader waits
 * behind a bulk writer's lock), so it keeps the workspace live and retries with
 * backoff; only failures that persist end live refresh. At most one journal
 * read runs per database at a time. Everything degrades to "not live", which is
 * manual Refresh as before.
 */

interface LiveEntry {
  readonly route: TrackerRoute;
  readonly cwd: string;
  /** `live` while polling makes sense; anything else stops the panel's polling. */
  reason: ChangeReason;
  /** Newest record read; null when the journal was empty. */
  checkpoint: JournalMark | null;
  /** Changes on every baseline and every invalidation, so tokens never repeat. */
  epoch: number;
  /** Set when the checkpoint can no longer be trusted; the next dashboard load re-baselines. */
  stale: boolean;
  failures: number;
  firstFailureAt: number | null;
  /** No journal read before this time: backoff after a failure. */
  retryAt: number;
  /** For `unavailable`: no baseline is attempted again before this time. */
  quietUntil: number;
}

/** A journal position read before bv ran, and the database it belongs to. */
export interface PositionBeforeRead {
  readonly database: string;
  readonly state: ChangeState;
}

const MAX_ENTRIES = 64;
/** Retry delays after consecutive failed reads: 5 s doubling to a minute. */
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 60_000;
/** Reads failing for this long, at least this many times, end live refresh. */
const PERSISTENT_FAILURE_MS = 5 * 60_000;
const PERSISTENT_FAILURE_COUNT = 3;
/** How long a journal that could not be baselined is left alone; shorter when bd was only busy. */
const UNAVAILABLE_QUIET_MS = 10 * 60_000;
const BUSY_QUIET_MS = 60_000;
/** A dashboard load waits this long for a poll already reading; then it uses the last position. */
const BEFORE_READ_WAIT_MS = 5_000;

/** Distinguishes tokens across plugin reloads, which reset the epoch counter. */
const INSTANCE = Math.random().toString(36).slice(2, 10);
let lastEpoch = 0;

function nextEpoch(): number {
  lastEpoch += 1;
  return lastEpoch;
}

const entries = new Map<string, LiveEntry>();
const checks = new Map<string, Promise<void>>();
const baselines = new Map<string, Promise<LiveEntry>>();
const journalQueues = new Map<string, Promise<void>>();

export function clearChangeState(): void {
  entries.clear();
  checks.clear();
  baselines.clear();
  journalQueues.clear();
}

function entryKey(workspaceId: string, directory: string): string {
  return `${workspaceId}\0${directory}`;
}

export function notLive(reason: Exclude<ChangeReason, "live">): ChangeState {
  return { live: false, reason, token: null };
}

function positionToken(entry: LiveEntry): string {
  return `${INSTANCE}.${entry.epoch}.${entry.checkpoint?.seq ?? 0}`;
}

function stateOf(entry: LiveEntry): ChangeState {
  return entry.reason === "live" ? { live: true, reason: "live", token: positionToken(entry) } : notLive(entry.reason);
}

/** A token no poll returns: the snapshot's position is unknown, so the next poll reloads once. */
function pendingState(): ChangeState {
  return { live: true, reason: "live", token: `${INSTANCE}.${nextEpoch()}.pending` };
}

function remember(key: string, entry: LiveEntry): void {
  entries.delete(key);
  if (entries.size >= MAX_ENTRIES) {
    const oldest = entries.keys().next();
    if (!oldest.done) entries.delete(oldest.value);
  }
  entries.set(key, entry);
}

/** One journal read at a time per database, whoever asks. */
async function exclusive<Value>(database: string, run: () => Promise<Value>): Promise<Value> {
  const previous = journalQueues.get(database) ?? Promise.resolve();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  journalQueues.set(database, tail);
  await previous;
  try {
    return await run();
  } finally {
    release();
    if (journalQueues.get(database) === tail) journalQueues.delete(database);
  }
}

function sameMark(left: JournalMark, right: JournalMark): boolean {
  return left.seq === right.seq && left.ts === right.ts && left.op === right.op && left.issueId === right.issueId;
}

/** Marks the checkpoint untrustworthy and moves the token so the panel reloads. */
function invalidate(entry: LiveEntry): void {
  entry.stale = true;
  entry.epoch = nextEpoch();
}

function succeeded(entry: LiveEntry): void {
  entry.failures = 0;
  entry.firstFailureAt = null;
  entry.retryAt = 0;
}

/** A transient failure keeps the workspace live and delays the next read; a persistent one ends it. */
function failed(entry: LiveEntry, now: number): void {
  entry.failures += 1;
  entry.firstFailureAt ??= now;
  entry.retryAt = now + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (entry.failures - 1));
  if (entry.failures >= PERSISTENT_FAILURE_COUNT && now - entry.firstFailureAt >= PERSISTENT_FAILURE_MS) {
    entry.reason = "unavailable";
    entry.quietUntil = now + UNAVAILABLE_QUIET_MS;
  }
}

/** The single journal read a poll costs. */
async function checkEntry(entry: LiveEntry): Promise<void> {
  if (entry.reason !== "live" || entry.stale || Date.now() < entry.retryAt) return;
  const checkpoint = entry.checkpoint;
  const outcome = await exclusive(entry.route.database, async () =>
    await tailJournal(entry.route, entry.cwd, checkpoint === null ? 0 : checkpoint.seq - 1, null, POLL_TAIL_LIMITS),
  );
  switch (outcome.kind) {
    case "off":
      entry.reason = "journal-off";
      return;
    case "truncated":
      succeeded(entry);
      invalidate(entry);
      return;
    case "failed":
      // More than a poll accepts is a bulk change: certainly news, and the head
      // is then re-read by the reload rather than by this poll.
      if (outcome.error.code === "output_limit") {
        succeeded(entry);
        invalidate(entry);
      } else {
        failed(entry, Date.now());
      }
      return;
    case "records": {
      succeeded(entry);
      if (checkpoint !== null && (outcome.first === null || !sameMark(outcome.first, checkpoint))) {
        invalidate(entry);
        return;
      }
      const last = outcome.last;
      if (last !== null && last.seq > (checkpoint?.seq ?? 0)) entry.checkpoint = last;
      return;
    }
  }
}

/** Concurrent callers share one read; the answer is the entry's position afterwards. */
async function sharedCheck(key: string, entry: LiveEntry): Promise<void> {
  const active = checks.get(key);
  if (active !== undefined) return await active;
  const run = checkEntry(entry)
    .catch(() => failed(entry, Date.now()))
    .finally(() => checks.delete(key));
  checks.set(key, run);
  await run;
}

/** Finds the head by reading the journal once, streamed; a truncated journal names it instead. */
type HeadRead =
  | { readonly ok: true; readonly mark: JournalMark | null }
  | { readonly ok: false; readonly reason: ChangeReason; readonly busy: boolean };

async function readHead(route: TrackerRoute, cwd: string): Promise<HeadRead> {
  const full = await tailJournal(route, cwd, 0, null, BASELINE_TAIL_LIMITS);
  if (full.kind === "records") return { ok: true, mark: full.last };
  if (full.kind === "off") return { ok: false, reason: "journal-off", busy: false };
  if (full.kind === "failed") return { ok: false, reason: "unavailable", busy: full.error.code === "timeout" };
  const atHead = await tailJournal(route, cwd, full.head - 1, 1, POLL_TAIL_LIMITS);
  if (atHead.kind === "records" && atHead.first !== null && atHead.first.seq === full.head) {
    return { ok: true, mark: atHead.first };
  }
  if (atHead.kind === "off") return { ok: false, reason: "journal-off", busy: false };
  return { ok: false, reason: "unavailable", busy: atHead.kind === "failed" && atHead.error.code === "timeout" };
}

async function baseline(route: TrackerRoute, cwd: string): Promise<LiveEntry> {
  const base: LiveEntry = {
    route,
    cwd,
    reason: "unavailable",
    checkpoint: null,
    epoch: nextEpoch(),
    stale: false,
    failures: 0,
    firstFailureAt: null,
    retryAt: 0,
    quietUntil: 0,
  };
  const outcome = await exclusive(route.database, async (): Promise<HeadRead> => {
    const enabled = await readJournalEnabled(route, cwd);
    if (!enabled.ok) return { ok: false, reason: "unavailable", busy: enabled.error.code === "timeout" };
    if (!enabled.value) return { ok: false, reason: "journal-off", busy: false };
    return await readHead(route, cwd);
  });
  if (outcome.ok) return { ...base, reason: "live", checkpoint: outcome.mark };
  if (outcome.reason === "unavailable") {
    return { ...base, quietUntil: Date.now() + (outcome.busy ? BUSY_QUIET_MS : UNAVAILABLE_QUIET_MS) };
  }
  return { ...base, reason: outcome.reason };
}

function sharedBaseline(key: string, route: TrackerRoute, cwd: string): Promise<LiveEntry> {
  const active = baselines.get(key);
  if (active !== undefined) return active;
  const run = baseline(route, cwd)
    .catch(
      (): LiveEntry => ({
        route,
        cwd,
        reason: "unavailable",
        checkpoint: null,
        epoch: nextEpoch(),
        stale: false,
        failures: 0,
        firstFailureAt: null,
        retryAt: 0,
        quietUntil: Date.now() + UNAVAILABLE_QUIET_MS,
      }),
    )
    .then((entry) => {
      remember(key, entry);
      return entry;
    })
    .finally(() => baselines.delete(key));
  baselines.set(key, run);
  return run;
}

function delay(ms: number): Promise<null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    timer.unref?.();
  });
}

/**
 * Called by a dashboard load before it runs bv, for a workspace whose tracker
 * route is already known from an earlier load: the journal position the
 * snapshot will be at least as new as. A live checkpoint is refreshed with one
 * read (or the last known position when bd is busy); a stale checkpoint, a
 * journal that was off, or one that failed long enough ago is baselined here,
 * still before bv. Null when nothing is known yet.
 */
export async function changesBeforeRead(workspaceId: string, directory: string): Promise<PositionBeforeRead | null> {
  const key = entryKey(workspaceId, directory);
  const entry = entries.get(key);
  if (entry === undefined) return null;
  const database = entry.route.database;

  if (entry.reason === "live" && !entry.stale) {
    // Any position read so far predates bv's read, so it is a safe answer if bd is too busy to say more.
    const known = stateOf(entry);
    const checked = await Promise.race([sharedCheck(key, entry).then(() => true), delay(BEFORE_READ_WAIT_MS)]);
    if (checked === null || entries.get(key) !== entry) return { database, state: known };
    if (entry.reason === "live" && !entry.stale) return { database, state: stateOf(entry) };
    // The check found the checkpoint stale or the journal off: settle that now, still before bv,
    // rather than hand the snapshot a token the polls would keep agreeing with.
  }
  if (entry.reason === "unavailable" && Date.now() < entry.quietUntil) {
    return { database, state: notLive("unavailable") };
  }
  const fresh = await sharedBaseline(key, entry.route, entry.cwd);
  return { database: fresh.route.database, state: stateOf(fresh) };
}

/**
 * Called by a dashboard load once bv named the tracker route. Returns the
 * position read before bv when it belongs to this database. Otherwise the
 * position before bv is unknown: the journal is baselined now for future polls
 * and the snapshot is tagged pending, so the next poll reloads it once.
 */
export async function changesAfterRead(
  workspaceId: string,
  directory: string,
  route: TrackerRoute | null,
  before: PositionBeforeRead | null,
): Promise<ChangeState> {
  const key = entryKey(workspaceId, directory);
  if (route === null || route.kind !== "bd") {
    entries.delete(key);
    return notLive(route === null ? "unavailable" : "not-bd");
  }
  if (before !== null && before.database === route.database) return before.state;

  const entry = entries.get(key);
  const known =
    entry !== undefined && entry.route.database === route.database && entry.reason === "live" && !entry.stale
      ? entry
      : await sharedBaseline(key, route, directory);
  return known.reason === "live" ? pendingState() : stateOf(known);
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
    await sharedCheck(key, entry);
    const current = entries.get(key);
    return current === undefined ? notLive("unavailable") : stateOf(current);
  } catch {
    return notLive("unavailable");
  }
}
