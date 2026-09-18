import type { PluginTheme } from "@getpaseo/plugin";
import type { Alert, CommandError, SourceAuthority } from "../shared/beads";

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

/**
 * Beads statuses are opaque and carry no colour of their own: the row rail is
 * priority-encoded, so status is expressed as {@link statusIconName} plus text.
 * This mapping exists only for the few places that still need a status accent.
 */
export function statusTone(status: string): Tone {
  switch (status.toLowerCase()) {
    case "closed":
    case "done":
      return "success";
    case "in_progress":
    case "in progress":
      return "accent";
    case "blocked":
      return "danger";
    case "open":
    case "ready":
      return "neutral";
    default:
      return "neutral";
  }
}

/**
 * Priority is the primary colour encoding for issue rows and cards: it is the
 * only ranking `bv` reports that is comparable across opaque statuses.
 */
export function priorityTone(priority: number | null): Tone {
  if (priority === null) return "neutral";
  if (priority <= 0) return "danger";
  if (priority === 1) return "warning";
  if (priority === 2) return "accent";
  return "neutral";
}

/**
 * Lucide icon name for an opaque Beads status. Status is conveyed by icon plus
 * text, never by colour, so priority keeps the colour channel to itself.
 */
export function statusIconName(status: string): string {
  switch (status.trim().toLowerCase()) {
    case "in_progress":
    case "in progress":
    case "in-progress":
    case "active":
    case "doing":
    case "started":
      return "Play";
    case "blocked":
    case "waiting":
    case "on_hold":
    case "on hold":
      return "CircleSlash";
    case "ready":
    case "actionable":
      return "CircleDot";
    case "open":
    case "todo":
    case "to_do":
    case "to do":
    case "backlog":
    case "new":
      return "Circle";
    case "closed":
    case "done":
    case "completed":
    case "resolved":
      return "CircleCheck";
    case "cancelled":
    case "canceled":
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
