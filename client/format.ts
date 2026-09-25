import type { PluginTheme } from "@getpaseo/plugin";
import { BEADS_STATUSES, type Alert, type CommandError, type SourceAuthority } from "../shared/beads";
import type { WorkState } from "./project";

/** Semantic accent used by the status rail and severity marks. */
export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

export function toneColor(theme: PluginTheme, tone: Tone): string {
  switch (tone) {
    case "accent":
      return theme.colors.accent;
    case "success":
      return theme.colors.statusSuccess;
    case "warning":
      return theme.colors.statusWarning;
    case "danger":
      return theme.colors.statusDanger;
    case "neutral":
      return theme.colors.border;
  }
}

/** Priority colour, for the priority dot and for rows that carry no work state. */
export function priorityTone(priority: number | null): Tone {
  if (priority === null) return "neutral";
  if (priority <= 0) return "danger";
  if (priority === 1) return "warning";
  if (priority === 2) return "accent";
  return "neutral";
}

/**
 * Lucide icon for a status. Only Beads' built-in statuses get their own icon;
 * a project's custom status gets the neutral dashed circle rather than a
 * borrowed meaning.
 */
export function statusIconName(status: string): string {
  switch (status.trim().toLowerCase()) {
    case BEADS_STATUSES.inProgress:
    case BEADS_STATUSES.hooked:
      return "Play";
    case BEADS_STATUSES.blocked:
    case BEADS_STATUSES.deferred:
    case BEADS_STATUSES.draft:
    case BEADS_STATUSES.pinned:
      return "CircleSlash";
    case BEADS_STATUSES.open:
      return "Circle";
    case BEADS_STATUSES.closed:
      return "CircleCheck";
    case BEADS_STATUSES.tombstone:
      return "CircleX";
    default:
      return "CircleDashed";
  }
}

/** Display form of an opaque status: underscores and dashes read as spaces. */
export function statusLabel(status: string): string {
  const trimmed = status.trim();
  if (trimmed.length === 0) return "unknown";
  return trimmed.replace(/[_-]+/g, " ");
}

export function severityTone(severity: string): Tone {
  switch (severity.toLowerCase()) {
    case "critical":
      return "danger";
    case "warning":
      return "warning";
    default:
      return "neutral";
  }
}

export function authorityTone(authority: SourceAuthority | null): Tone {
  if (authority === null) return "neutral";
  if (authority.failed > 0 || authority.state === "unknown") return "danger";
  if (authority.stale || authority.readiness !== "proven" || !authority.claimSafe) return "warning";
  return "success";
}

export function authorityLabel(authority: SourceAuthority | null): string {
  if (authority === null) return "authority unknown";
  const readiness = authority.readiness;
  const freshness = authority.stale ? "stale" : "fresh";
  return `${authority.state} · ${readiness} · ${freshness}`;
}

export function priorityLabel(priority: number | null): string | null {
  return priority === null ? null : `P${priority}`;
}

export function shortHash(hash: string | null): string | null {
  if (hash === null || hash.length === 0) return null;
  return hash.slice(0, 8);
}

/** Compact relative age for a timestamp emitted by `bv`. */
export function relativeAge(timestamp: string | null, now: number = Date.now()): string | null {
  if (timestamp === null) return null;
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return null;
  const seconds = Math.max(0, Math.round((now - parsed) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * How long ago a piece of work last changed, as a bare "9m ago": readers take
 * it as the update time without being told. Finished work counts from when it
 * closed. Beads keeps no separate time for a status change.
 */
export function activityLabel(
  item: { readonly state: WorkState; readonly updatedAt: string | null; readonly closedAt: string | null },
  now: number,
): string | null {
  const at = item.state === "done" && item.closedAt !== null ? item.closedAt : item.updatedAt;
  return relativeAge(at, now);
}

export function errorLabel(error: CommandError | null): string {
  if (error === null) return "Unavailable.";
  switch (error.code) {
    case "unavailable":
      return `bv is unavailable. ${error.message}`;
    case "timeout":
      return `The analysis timed out. ${error.message}`;
    case "output_limit":
      return `The analysis produced too much output. ${error.message}`;
    case "invalid_json":
      return `The analysis output could not be read. ${error.message}`;
    case "cwd_invalid":
    case "workspace_unresolved":
      return `This workspace could not be resolved. ${error.message}`;
    case "tracker_unknown":
      return error.message;
    case "exit":
    case "internal":
      return error.message;
  }
}

export function alertHeadline(alert: Alert): string {
  return alert.issueId === null ? alert.message : `${alert.issueId} — ${alert.message}`;
}

/**
 * Derived work state carries the row colour: it is the one fact that tells
 * cards apart on a project where every issue shares a priority.
 */
export function stateTone(state: WorkState): Tone {
  switch (state) {
    case "active":
      return "accent";
    case "ready":
      return "success";
    case "held":
      return "danger";
    case "other":
      return "warning";
    case "waiting":
    case "done":
      return "neutral";
  }
}

export function stateLabel(state: WorkState): string {
  switch (state) {
    case "active":
      return "In progress";
    case "ready":
      return "Ready";
    case "waiting":
      return "Waiting";
    case "held":
      return "Held";
    case "other":
      return "Other status";
    case "done":
      return "Done";
  }
}

/**
 * What each state means, in Beads' own terms, shown under the column title so
 * nobody has to guess. Ready and Waiting match `br ready` and `br blocked`.
 */
export function stateDescription(state: WorkState): string {
  switch (state) {
    case "ready":
      return "Status open, and nothing it depends on is still open (br ready).";
    case "waiting":
      return "Status open, but a dependency, or its parent's, is still open (br blocked).";
    case "active":
      return "Status in_progress or hooked: someone has claimed it.";
    case "held":
      return "Status set by hand to blocked, deferred, draft or pinned.";
    case "other":
      return "A custom status Beads does not define, shown as written.";
    case "done":
      return "Status closed.";
  }
}

export function stateIconName(state: WorkState): string {
  switch (state) {
    case "active":
      return "Play";
    case "ready":
      return "CircleDot";
    case "waiting":
      return "Circle";
    case "held":
      return "CircleSlash";
    case "other":
      return "CircleDashed";
    case "done":
      return "CircleCheck";
  }
}

/** "waits on a, b +3": the open blockers themselves, not just how many. */
export function waitsOnLabel(blockedBy: readonly string[], shown = 2): string | null {
  if (blockedBy.length === 0) return null;
  const head = blockedBy.slice(0, shown).join(", ");
  const rest = blockedBy.length - shown;
  return rest > 0 ? `waits on ${head} +${rest}` : `waits on ${head}`;
}

/** Whole-number percentage, never rounding unfinished work up to 100. */
export function percentDone(done: number, total: number): number {
  if (total <= 0) return 0;
  const percent = Math.round((done / total) * 100);
  return done < total ? Math.min(percent, 99) : percent;
}
