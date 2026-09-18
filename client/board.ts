/**
 * Board derivation for the read-only working-set board.
 *
 * Honesty constraint: `bv` never hands the plugin the whole issue set. Triage
 * recommendations are capped at 12 and the plan is capped at 8 tracks of 10
 * items, so anything derived here is a *surfaced working set*, never a complete
 * project Kanban. Blockers are deliberately excluded because the blocker payload
 * carries no authoritative status and would force this module to invent a lane.
 *
 * Statuses stay opaque strings: lanes are discovered from the data, and only
 * lane *ordering* uses well-known names. Everything is pure so it can be tested
 * in the Vitest node environment.
 */
import type { Recommendation, Track } from "../shared/beads";

/** One card on the board: an issue surfaced by triage, the plan, or both. */
export interface BoardCard {
  readonly id: string;
  readonly title: string;
  /** Raw `bv` status, preserved verbatim. */
  readonly status: string;
  readonly priority: number | null;
  readonly assignee: string | null;
  readonly type: string | null;
  readonly labels: readonly string[];
  readonly blockedByCount: number;
  readonly unblocksCount: number;
  /** Track ids this issue belongs to, in plan order. */
  readonly trackIds: readonly string[];
  /** True when triage recommended this issue, i.e. its metadata is triage-grade. */
  readonly fromRecommendations: boolean;
}

/** A status column. `status` is the raw value; `label` is display-safe. */
export interface BoardLane {
  readonly status: string;
  readonly label: string;
  readonly cards: readonly BoardCard[];
}

export interface BoardModel {
  readonly lanes: readonly BoardLane[];
  /** Number of distinct issues surfaced across all lanes. */
  readonly surfaced: number;
  /** True when triage contributed cards. */
  readonly hasRecommendations: boolean;
  /** True when the plan contributed cards. */
  readonly hasTracks: boolean;
}

/** Lane groups in reading order; unknown statuses sort between them. */
const LANE_RANK: readonly { readonly rank: number; readonly names: readonly string[] }[] = [
  { rank: 0, names: ["in_progress", "in progress", "in-progress", "active", "doing", "started"] },
  { rank: 1, names: ["blocked", "waiting", "on_hold", "on hold"] },
  { rank: 2, names: ["ready", "actionable", "open", "todo", "to_do", "to do", "backlog", "new"] },
  { rank: 4, names: ["closed", "done", "completed", "resolved", "cancelled", "canceled"] },
];

/** Unknown statuses land here and sort alphabetically among themselves. */
const UNKNOWN_LANE_RANK = 3;

/**
 * Builds the board from the union of triage recommendations and plan track
 * items, deduplicated by issue id. Recommendation metadata wins on conflict
 * because it is the richer payload; track membership is merged in either way.
 */
export function buildBoard(
  recommendations: readonly Recommendation[],
  tracks: readonly Track[],
): BoardModel {
  const byId = new Map<string, BoardCard>();

  for (const recommendation of recommendations) {
    if (recommendation.id.length === 0) continue;
    const existing = byId.get(recommendation.id);
    byId.set(recommendation.id, {
      id: recommendation.id,
      title: recommendation.title,
      status: recommendation.status,
      priority: recommendation.priority,
      assignee: recommendation.assignee,
      type: recommendation.type,
      labels: recommendation.labels,
      blockedByCount: recommendation.blockedBy.length,
      unblocksCount: recommendation.unblocks.length,
      trackIds: existing?.trackIds ?? [],
      fromRecommendations: true,
    });
  }

  for (const track of tracks) {
    for (const item of track.items) {
      if (item.id.length === 0) continue;
      const existing = byId.get(item.id);
      if (existing === undefined) {
        byId.set(item.id, {
          id: item.id,
          title: item.title,
          status: item.status,
          priority: item.priority,
          assignee: null,
          type: null,
          labels: [],
          blockedByCount: 0,
          unblocksCount: item.unblocks.length,
          trackIds: [track.id],
          fromRecommendations: false,
        });
        continue;
      }
      byId.set(item.id, {
        ...existing,
        trackIds: existing.trackIds.includes(track.id)
          ? existing.trackIds
          : [...existing.trackIds, track.id],
      });
    }
  }

  const grouped = new Map<string, BoardCard[]>();
  for (const card of byId.values()) {
    const key = laneKey(card.status);
    const bucket = grouped.get(key);
    if (bucket === undefined) grouped.set(key, [card]);
    else bucket.push(card);
  }

  const lanes: BoardLane[] = [...grouped.entries()]
    .map(([key, cards]) => ({
      status: key,
      label: laneLabel(key),
      cards: [...cards].sort(compareCards),
    }))
    .sort(compareLanes);

  let hasRecommendations = false;
  let hasTracks = false;
  for (const card of byId.values()) {
    if (card.fromRecommendations) hasRecommendations = true;
    if (card.trackIds.length > 0) hasTracks = true;
  }

  return { lanes, surfaced: byId.size, hasRecommendations, hasTracks };
}

/** Human-readable lane heading for an opaque status value. */
export function laneLabel(status: string): string {
  const trimmed = status.trim();
  if (trimmed.length === 0) return "unknown";
  return trimmed.replace(/[_-]+/g, " ");
}

/** Ordering rank for a raw status; unknown values share {@link UNKNOWN_LANE_RANK}. */
export function laneRank(status: string): number {
  const normalized = status.trim().toLowerCase();
  for (const group of LANE_RANK) {
    if (group.names.includes(normalized)) return group.rank;
  }
  return UNKNOWN_LANE_RANK;
}

function laneKey(status: string): string {
  const trimmed = status.trim();
  return trimmed.length === 0 ? "unknown" : trimmed;
}

function compareLanes(left: BoardLane, right: BoardLane): number {
  const rankDelta = laneRank(left.status) - laneRank(right.status);
  if (rankDelta !== 0) return rankDelta;
  return left.status.localeCompare(right.status);
}

/** Priority ascending (P0 first), null last, then title, then id. */
function compareCards(left: BoardCard, right: BoardCard): number {
  const leftPriority = left.priority ?? Number.MAX_SAFE_INTEGER;
  const rightPriority = right.priority ?? Number.MAX_SAFE_INTEGER;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  const titleDelta = left.title.localeCompare(right.title);
  if (titleDelta !== 0) return titleDelta;
  return left.id.localeCompare(right.id);
}
