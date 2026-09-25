import {
  BOARD_ISSUE_LIMIT,
  isClosedStatus,
  type Alert,
  type AlertSummary,
  type Blocker,
  type BoardIssue,
  type BoardSnapshot,
  type IssueDetail,
  type PlanSummary,
  type ProjectCounts,
  type ProjectHealth,
  type Recommendation,
  type SearchResult,
  type SourceAuthority,
  type SourceSnapshot,
  type Track,
} from "../shared/beads";

/**
 * `bv` and the trackers are external tools with an evolving payload shape.
 * Every reader below is defensive: unknown fields are ignored, unknown enum
 * values stay opaque strings, and a missing section becomes `null` rather than
 * a thrown error. Nothing here interprets `.beads/*.jsonl` or recomputes graph
 * analysis; it only reshapes what the tools already decided.
 */

type Json = Record<string, unknown>;

export function asRecord(value: unknown): Json | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Json;
}

function readString(source: Json | null, key: string): string | null {
  if (source === null) return null;
  const value = source[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function readNumber(source: Json | null, key: string): number | null {
  if (source === null) return null;
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readCount(source: Json | null, key: string): number {
  return readNumber(source, key) ?? 0;
}

function readBoolean(source: Json | null, key: string): boolean {
  if (source === null) return false;
  return source[key] === true;
}

function readArray(source: Json | null, key: string): readonly unknown[] {
  if (source === null) return [];
  const value = source[key];
  return Array.isArray(value) ? value : [];
}

function readStringArray(source: Json | null, key: string): string[] {
  return readArray(source, key).filter((entry): entry is string => typeof entry === "string");
}

/** Accepts either a plain string or a nested `{ text }`-shaped comment body. */
function readText(source: Json | null, ...keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = readString(source, key);
    if (value !== null) return value;
  }
  return null;
}

export function normalizeAuthority(payload: unknown): SourceAuthority | null {
  const authority = asRecord(payload);
  if (authority === null) return null;
  const sources = readArray(authority, "sources").map(asRecord);
  const warnings: string[] = [];
  let stale = false;
  for (const source of sources) {
    if (source === null) continue;
    if (source["stale"] === true) stale = true;
    for (const warning of readStringArray(source, "warnings")) warnings.push(warning);
    const error = readString(source, "error");
    if (error !== null) warnings.push(error);
  }
  return {
    state: readString(authority, "state") ?? "unknown",
    readiness: readString(authority, "readiness") ?? "unknown",
    claimSafe: readBoolean(authority, "claim_safe"),
    stale,
    loaded: readCount(authority, "loaded"),
    failed: readCount(authority, "failed"),
    valid: readCount(authority, "valid"),
    visible: readCount(authority, "visible"),
    tombstones: readCount(authority, "tombstones"),
    warnings,
  };
}

/** Provenance envelope shared by every `bv --robot-*` payload. */
export function normalizeSource(payload: unknown): SourceSnapshot | null {
  const root = asRecord(payload);
  if (root === null) return null;
  return {
    generatedAt: readString(root, "generated_at"),
    dataHash: readString(root, "data_hash"),
    sourcePath: readString(root, "source_path"),
    sourceKind: readString(root, "source_kind"),
    toolVersion: readString(root, "version"),
    authority: normalizeAuthority(root["source_authority"]),
  };
}

/** A `bv` payload carrying a top-level `error` means the project failed to load. */
export function readPayloadError(payload: unknown): string | null {
  return readString(asRecord(payload), "error");
}

export function normalizeCounts(payload: unknown): ProjectCounts | null {
  const root = asRecord(payload);
  const triage = asRecord(root?.["triage"]);
  const quickRef = asRecord(triage?.["quick_ref"]);
  if (quickRef === null) return null;
  const meta = asRecord(triage?.["meta"]);
  const healthCounts = asRecord(asRecord(triage?.["project_health"])?.["counts"]);
  return {
    open: readCount(quickRef, "open_count"),
    actionable: readCount(quickRef, "actionable_count"),
    blocked: readCount(quickRef, "blocked_count"),
    inProgress: readCount(quickRef, "in_progress_count"),
    notClosed: readCount(quickRef, "not_closed_count"),
    notActionable: readCount(quickRef, "not_actionable_count"),
    total: readCount(meta, "issue_count"),
    waiting: readNumber(healthCounts, "dependency_blocked"),
    closed: readNumber(healthCounts, "closed"),
  };
}

/** Velocity and cycle state from triage's `project_health`; null when absent. */
export function normalizeHealth(payload: unknown): ProjectHealth | null {
  const triage = asRecord(asRecord(payload)?.["triage"]);
  const health = asRecord(triage?.["project_health"]);
  if (health === null) return null;
  const velocity = asRecord(health["velocity"]);
  const graph = asRecord(health["graph"]);
  const cycles = graph?.["has_cycles"];
  return {
    closedLast7Days: readNumber(velocity, "closed_last_7_days"),
    closedLast30Days: readNumber(velocity, "closed_last_30_days"),
    velocityEstimated: readBoolean(velocity, "estimated"),
    hasCycles: typeof cycles === "boolean" ? cycles : null,
  };
}

function normalizeRecommendation(entry: unknown): Recommendation | null {
  const record = asRecord(entry);
  const id = readString(record, "id");
  if (record === null || id === null) return null;
  return {
    id,
    title: readString(record, "title") ?? id,
    status: readString(record, "status") ?? "unknown",
    type: readString(record, "type") ?? readString(record, "issue_type"),
    priority: readNumber(record, "priority"),
    assignee: readString(record, "assignee"),
    labels: readStringArray(record, "labels"),
    score: readNumber(record, "score"),
    action: readString(record, "action"),
    reasons: readStringArray(record, "reasons"),
    blockedBy: readStringArray(record, "blocked_by"),
    unblocks: readStringArray(record, "unblocks_ids"),
    claimable: readBoolean(record, "claimable"),
  };
}

export function normalizeRecommendations(payload: unknown, limit = 12): Recommendation[] {
  const triage = asRecord(asRecord(payload)?.["triage"]);
  const picks = readArray(asRecord(triage?.["quick_ref"]), "top_picks");
  const source = picks.length > 0 ? picks : readArray(triage, "recommendations");
  const normalized: Recommendation[] = [];
  for (const entry of source) {
    const recommendation = normalizeRecommendation(entry);
    if (recommendation !== null) normalized.push(recommendation);
    if (normalized.length >= limit) break;
  }
  return normalized;
}

export function normalizeBlockers(payload: unknown, limit = 12): Blocker[] {
  const triage = asRecord(asRecord(payload)?.["triage"]);
  const blockers: Blocker[] = [];
  for (const entry of readArray(triage, "blockers_to_clear")) {
    const record = asRecord(entry);
    const id = readString(record, "id");
    if (record === null || id === null) continue;
    const unblocks = readStringArray(record, "unblocks_ids");
    blockers.push({
      id,
      title: readString(record, "title") ?? id,
      unblocksCount: readNumber(record, "unblocks_count") ?? unblocks.length,
      unblocks,
      actionable: readBoolean(record, "actionable"),
    });
    if (blockers.length >= limit) break;
  }
  return blockers;
}

export function normalizeTracks(payload: unknown, trackLimit = 12, itemLimit = 25): Track[] {
  const plan = asRecord(asRecord(payload)?.["plan"]);
  const tracks: Track[] = [];
  for (const entry of readArray(plan, "tracks")) {
    const record = asRecord(entry);
    if (record === null) continue;
    const items: Track["items"] = [];
    const rawItems = readArray(record, "items");
    for (const rawItem of rawItems) {
      const item = asRecord(rawItem);
      const id = readString(item, "id");
      if (item === null || id === null) continue;
      items.push({
        id,
        title: readString(item, "title") ?? id,
        status: readString(item, "status") ?? "unknown",
        priority: readNumber(item, "priority"),
        unblocks: readStringArray(item, "unblocks"),
      });
      if (items.length >= itemLimit) break;
    }
    tracks.push({
      id: readString(record, "track_id") ?? `track-${tracks.length + 1}`,
      reason: readString(record, "reason"),
      items,
      totalItems: rawItems.length,
    });
    if (tracks.length >= trackLimit) break;
  }
  return tracks;
}

/**
 * Reshapes `bv --robot-graph` into the complete issue set behind the board.
 *
 * `bv` keeps a `blocks` edge after its blocker closes, so counting edges would
 * report "blocked by 1" on work that is ready. Only blockers that are still
 * open are kept, and only dependents that are still open count as unblocked.
 *
 * Edge semantics, verified against `bv v0.25.0` by cross-checking `br show
 * --json` on real repositories. The two edge kinds do NOT share a direction:
 *   - `blocks` runs `from` → `to` where `from` is blocked by `to`, so an
 *     inbound edge means "this issue unblocks that one".
 *   - `parent-child` runs `child` → `parent`, the opposite way round.
 * `discovered-from` and `related` are ignored: neither implies containment or
 * ordering, and inventing one would misgroup issues.
 *
 * When the project is larger than `limit`, open work is kept and closed issues
 * are dropped first: a truncated board should still show everything a person
 * can act on, and `truncated` says so out loud.
 */
export function normalizeBoardIssues(
  payload: unknown,
  facets: TrackerFacets = EMPTY_FACETS,
  limit = BOARD_ISSUE_LIMIT,
): BoardSnapshot {
  const adjacency = asRecord(asRecord(payload)?.["adjacency"]);
  const rawNodes = readArray(adjacency, "nodes");
  if (rawNodes.length === 0) return { issues: [], typed: facets.ok, total: 0, truncated: false };

  // Statuses first: an edge only blocks while its blocker is still open.
  const statuses = new Map<string, string>();
  for (const rawNode of rawNodes) {
    const node = asRecord(rawNode);
    const id = readString(node, "id");
    if (id === null || statuses.has(id)) continue;
    statuses.set(id, readString(node, "status") ?? "unknown");
  }
  const isOpen = (id: string): boolean => {
    const status = statuses.get(id);
    // A blocker the graph does not list cannot be shown closed, so it still blocks.
    return status === undefined || !isClosedStatus(status);
  };

  const blockedBy = new Map<string, string[]>();
  const unblocksCounts = new Map<string, number>();
  const parents = new Map<string, string>();
  const childCounts = new Map<string, number>();
  const seenBlocks = new Set<string>();
  for (const rawEdge of readArray(adjacency, "edges")) {
    const edge = asRecord(rawEdge);
    const from = readString(edge, "from");
    const to = readString(edge, "to");
    if (from === null || to === null) continue;
    const type = readString(edge, "type");
    if (type === "blocks") {
      // A repeated edge is one dependency, not two.
      const pair = `${from}\u0000${to}`;
      if (seenBlocks.has(pair)) continue;
      seenBlocks.add(pair);
      if (isOpen(to)) {
        const list = blockedBy.get(from);
        if (list === undefined) blockedBy.set(from, [to]);
        else list.push(to);
      }
      if (isOpen(from)) unblocksCounts.set(to, (unblocksCounts.get(to) ?? 0) + 1);
    } else if (type === "parent-child" && !parents.has(from)) {
      parents.set(from, to);
      childCounts.set(to, (childCounts.get(to) ?? 0) + 1);
    }
  }

  const open: BoardIssue[] = [];
  const closed: BoardIssue[] = [];
  const seen = new Set<string>();
  for (const rawNode of rawNodes) {
    const node = asRecord(rawNode);
    const id = readString(node, "id");
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    const status = statuses.get(id) ?? "unknown";
    const facet = facets.byId.get(id);
    const issue: BoardIssue = {
      id,
      title: readString(node, "title") ?? id,
      status,
      priority: readNumber(node, "priority"),
      labels: readStringArray(node, "labels"),
      blockedBy: blockedBy.get(id) ?? [],
      unblocksCount: unblocksCounts.get(id) ?? 0,
      parentId: parents.get(id) ?? null,
      childCount: childCounts.get(id) ?? 0,
      type: facet?.type ?? null,
      assignee: facet?.assignee ?? null,
      updatedAt: facet?.updatedAt ?? null,
      closedAt: facet?.closedAt ?? null,
    };
    if (isClosedStatus(status)) closed.push(issue);
    else open.push(issue);
  }

  const total = open.length + closed.length;
  if (total <= limit) {
    return { issues: [...open, ...closed], typed: facets.ok, total, truncated: false };
  }
  // Closed containers above open work are kept before any other closed issue,
  // so a truncated board still groups every open issue under its real epic.
  const ancestors = new Set<string>();
  for (const issue of open) {
    for (let parent = parents.get(issue.id); parent !== undefined && !ancestors.has(parent); parent = parents.get(parent)) {
      ancestors.add(parent);
    }
  }
  const keptClosed = closed.filter((issue) => ancestors.has(issue.id));
  const otherClosed = closed.filter((issue) => !ancestors.has(issue.id));
  const kept = [...open, ...keptClosed];
  return {
    issues: [...kept, ...otherClosed.slice(0, Math.max(0, limit - kept.length))],
    typed: facets.ok,
    total,
    truncated: true,
  };
}

/** Type and assignee for one issue, the two facets the graph does not carry. */
export interface TrackerFacet {
  readonly type: string | null;
  readonly assignee: string | null;
  /** Last change of any kind; null when the tracker did not supply it. */
  readonly updatedAt: string | null;
  readonly closedAt: string | null;
}

export interface TrackerFacets {
  /** False when the tracker was absent or rejected the read; the board then has no types. */
  readonly ok: boolean;
  readonly byId: ReadonlyMap<string, TrackerFacet>;
}

export const EMPTY_FACETS: TrackerFacets = { ok: false, byId: new Map() };

/** An ISO timestamp the client can parse, or null; a malformed cell never becomes a date. */
function readTimestamp(cell: string | undefined): string | null {
  const value = cell?.trim() ?? "";
  if (value.length === 0 || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

/** Bounds on the facet CSV, so a runaway tracker cannot allocate without limit. */
const FACET_MAX_ROWS = 20_000;
const FACET_MAX_FIELD_LENGTH = 512;

/**
 * Reads RFC 4180 CSV records.
 *
 * The trackers do quote: `br` wrapped 167 of 784 rows when asked for a column
 * holding free text, because titles and assignees are unconstrained strings. A
 * line-splitting parser would mis-split or silently drop exactly those rows, so
 * this walks characters instead and handles quoted commas, doubled quotes, and
 * newlines inside a quoted field.
 *
 * Bounds are enforced while scanning: an over-long field or an unterminated
 * quote ends the read rather than growing without limit.
 */
export function readCsvRecords(
  csv: string,
  maxRecords = FACET_MAX_ROWS,
  maxFieldLength = FACET_MAX_FIELD_LENGTH,
): { readonly records: readonly (readonly string[])[]; readonly truncated: boolean } {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;

  const endField = (): boolean => {
    if (field.length > maxFieldLength) return false;
    record.push(field);
    field = "";
    started = false;
    return true;
  };
  const endRecord = (): boolean => {
    if (!endField()) return false;
    // A trailing newline produces one empty field, which is not a record.
    if (record.length > 1 || record[0] !== "") records.push(record);
    record = [];
    return true;
  };

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (quoted) {
      if (char === '"') {
        if (csv[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      if (field.length > maxFieldLength) return { records, truncated: true };
      continue;
    }
    if (char === '"' && !started) {
      quoted = true;
      started = true;
      continue;
    }
    if (char === ",") {
      if (!endField()) return { records, truncated: true };
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && csv[index + 1] === "\n") index += 1;
      if (!endRecord()) return { records, truncated: true };
      if (records.length >= maxRecords) return { records, truncated: index < csv.length - 1 };
      continue;
    }
    field += char;
    started = true;
    if (field.length > maxFieldLength) return { records, truncated: true };
  }

  if (quoted) return { records, truncated: true };
  if (field.length > 0 || record.length > 0) {
    if (!endRecord()) return { records, truncated: true };
  }
  return { records, truncated: false };
}

const FACET_HEADER: readonly string[] = ["id", "issue_type", "assignee", "updated_at", "closed_at"];

/** Accepts the timestamped read, or the base three columns when the tracker rejected the timestamps. */
const FACET_WIDTHS: readonly number[] = [5, 3];

/**
 * Parses `id,issue_type,assignee[,updated_at,closed_at]` from `br`/`bd list`.
 *
 * A partial overlay is worse than none: an issue whose row was dropped is
 * indistinguishable from a genuinely untyped one, and it would sit in the
 * board's catch-all group with nothing to explain why. So a truncated or
 * malformed read reports `ok: false`, which disables the axes that need types
 * rather than quietly misgrouping issues.
 */
export function parseTrackerFacets(csv: string): TrackerFacets {
  const { records, truncated } = readCsvRecords(csv);
  if (truncated) return EMPTY_FACETS;

  const byId = new Map<string, TrackerFacet>();
  for (const [index, record] of records.entries()) {
    if (!FACET_WIDTHS.includes(record.length)) continue;
    const id = record[0]?.trim() ?? "";
    if (id.length === 0) continue;
    // Tolerate a tracker that omits the header rather than losing the first row.
    if (index === 0 && record.every((cell, column) => cell.trim() === FACET_HEADER[column])) continue;
    const type = record[1]?.trim() ?? "";
    const assignee = record[2]?.trim() ?? "";
    byId.set(id, {
      type: type.length === 0 ? null : type.toLowerCase(),
      assignee: assignee.length === 0 ? null : assignee,
      updatedAt: readTimestamp(record[3]),
      closedAt: readTimestamp(record[4]),
    });
  }
  return { ok: byId.size > 0, byId };
}

export function normalizePlanSummary(payload: unknown): PlanSummary | null {
  const plan = asRecord(asRecord(payload)?.["plan"]);
  if (plan === null) return null;
  const summary = asRecord(plan["summary"]);
  return {
    totalActionable: readNumber(plan, "total_actionable"),
    totalBlocked: readNumber(plan, "total_blocked"),
    totalTracks: readArray(plan, "tracks").length,
    highestImpact: readString(summary, "highest_impact"),
    impactReason: readString(summary, "impact_reason"),
  };
}

const SEVERITY_ORDER: Readonly<Record<string, number>> = { critical: 0, warning: 1, info: 2 };

export function normalizeAlerts(payload: unknown, limit = 20): Alert[] {
  const alerts: Alert[] = [];
  for (const entry of readArray(asRecord(payload), "alerts")) {
    const record = asRecord(entry);
    const message = readString(record, "message");
    if (record === null || message === null) continue;
    alerts.push({
      type: readString(record, "type") ?? "unknown",
      severity: readString(record, "severity") ?? "info",
      message,
      issueId: readString(record, "issue_id"),
      detectedAt: readString(record, "detected_at"),
      suggestedAction: readString(record, "suggested_action"),
      labels: readStringArray(record, "labels"),
    });
  }
  alerts.sort((left, right) => {
    const leftRank = SEVERITY_ORDER[left.severity] ?? 3;
    const rightRank = SEVERITY_ORDER[right.severity] ?? 3;
    return leftRank - rightRank;
  });
  return alerts.slice(0, limit);
}

export function normalizeAlertSummary(payload: unknown): AlertSummary | null {
  const summary = asRecord(asRecord(payload)?.["summary"]);
  if (summary === null) return null;
  return {
    total: readCount(summary, "total"),
    critical: readCount(summary, "critical"),
    warning: readCount(summary, "warning"),
    info: readCount(summary, "info"),
  };
}

export function normalizeSearchResults(payload: unknown, limit: number): SearchResult[] {
  const results: SearchResult[] = [];
  for (const entry of readArray(asRecord(payload), "results")) {
    const record = asRecord(entry);
    const id = readString(record, "issue_id") ?? readString(record, "id");
    if (record === null || id === null) continue;
    results.push({
      id,
      title: readString(record, "title") ?? id,
      score: readNumber(record, "score"),
    });
    if (results.length >= limit) break;
  }
  return results;
}

function normalizeRefs(source: Json | null, key: string, limit = 25): IssueDetail["dependencies"] {
  const refs: IssueDetail["dependencies"] = [];
  for (const entry of readArray(source, key)) {
    const record = asRecord(entry);
    const id = readString(record, "id") ?? readString(record, "depends_on_id") ?? readString(record, "issue_id");
    if (record === null || id === null) continue;
    refs.push({
      id,
      title: readString(record, "title"),
      status: readString(record, "status"),
      relation: readString(record, "dependency_type") ?? readString(record, "type"),
    });
    if (refs.length >= limit) break;
  }
  return refs;
}

function normalizeComments(source: Json | null, limit = 30): IssueDetail["comments"] {
  const comments: IssueDetail["comments"] = [];
  for (const entry of readArray(source, "comments")) {
    const record = asRecord(entry);
    if (record === null) continue;
    const text = readText(record, "text", "body");
    if (text === null) continue;
    const rawId = record["id"];
    const id =
      typeof rawId === "string" && rawId.length > 0
        ? rawId
        : typeof rawId === "number"
          ? String(rawId)
          : `comment-${comments.length + 1}`;
    comments.push({
      id,
      author: readString(record, "author"),
      text,
      createdAt: readString(record, "created_at"),
    });
    if (comments.length >= limit) break;
  }
  return comments;
}

/**
 * `br`/`bd` answer `show --json` with either an object or a single-element
 * array. Both shapes normalize to one detail record.
 */
export function normalizeIssueDetail(payload: unknown): IssueDetail | null {
  const candidate = Array.isArray(payload) ? (payload.length === 1 ? payload[0] : undefined) : payload;
  const record = asRecord(candidate);
  const id = readString(record, "id");
  if (record === null || id === null) return null;
  return {
    id,
    title: readString(record, "title") ?? id,
    status: readString(record, "status") ?? "unknown",
    type: readString(record, "issue_type") ?? readString(record, "type"),
    priority: readNumber(record, "priority"),
    assignee: readString(record, "assignee"),
    description: readString(record, "description"),
    design: readString(record, "design"),
    acceptanceCriteria: readString(record, "acceptance_criteria"),
    notes: readString(record, "notes"),
    labels: readStringArray(record, "labels"),
    parent: readString(record, "parent"),
    dependencies: normalizeRefs(record, "dependencies"),
    dependents: normalizeRefs(record, "dependents"),
    comments: normalizeComments(record),
    createdAt: readString(record, "created_at"),
    updatedAt: readString(record, "updated_at"),
    closedAt: readString(record, "closed_at"),
    closeReason: readString(record, "close_reason"),
  };
}

const SNAPSHOT_FIELD_LIMIT = 1600;

function snapshotSection(label: string, value: string | null): string {
  if (value === null) return "";
  const trimmed = value.length > SNAPSHOT_FIELD_LIMIT ? `${value.slice(0, SNAPSHOT_FIELD_LIMIT)}…` : value;
  return `\n\n## ${label}\n${trimmed}`;
}

/** Plain-text snapshot handed to the agent when an issue is attached. */
export function buildIssueSnapshot(input: {
  readonly workspaceName: string;
  readonly workspaceDirectory: string | null;
  readonly issueId: string;
  readonly title: string;
  readonly detail: IssueDetail | null;
}): string {
  const header = [
    `Beads issue ${input.issueId}: ${input.title}`,
    `Paseo workspace: ${input.workspaceName}`,
    input.workspaceDirectory === null ? null : `Directory: ${input.workspaceDirectory}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const detail = input.detail;
  if (detail === null) {
    return `${header}\n\nDetail unavailable: only search metadata could be read for this issue.`;
  }

  const facts = [
    `Status: ${detail.status}`,
    detail.type === null ? null : `Type: ${detail.type}`,
    detail.priority === null ? null : `Priority: P${detail.priority}`,
    detail.assignee === null ? null : `Assignee: ${detail.assignee}`,
    detail.labels.length === 0 ? null : `Labels: ${detail.labels.join(", ")}`,
    detail.parent === null ? null : `Parent: ${detail.parent}`,
    detail.dependencies.length === 0 ? null : `Depends on: ${detail.dependencies.map((ref) => ref.id).join(", ")}`,
    detail.dependents.length === 0 ? null : `Blocks: ${detail.dependents.map((ref) => ref.id).join(", ")}`,
    detail.updatedAt === null ? null : `Updated: ${detail.updatedAt}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  return [
    header,
    `\n${facts}`,
    snapshotSection("Description", detail.description),
    snapshotSection("Design", detail.design),
    snapshotSection("Acceptance criteria", detail.acceptanceCriteria),
    snapshotSection("Notes", detail.notes),
  ].join("");
}
