/**
 * Board derivation for the read-only project board.
 *
 * The lanes come from `bv --robot-graph`, the one `bv` read that returns every
 * issue, so open, in-progress, blocked and closed work are all representable.
 * Triage picks and plan tracks are folded in only as *enrichment* — assignee,
 * type and track membership — never as the source of which issues exist.
 *
 * When the graph is unavailable the board falls back to the old working set
 * (triage picks plus track items) and says so through `complete: false`, rather
 * than pretending a subset is the project.
 *
 * Statuses stay opaque strings: lanes are discovered from the data, and only
 * lane *ordering* uses well-known names. Everything is pure so it can be tested
 * in the Vitest node environment.
 */
import { CLOSED_STATUSES, type BoardIssue, type Recommendation, type Track } from "../shared/beads";

/** One card on the board. */
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
  /** Cards to render, capped at {@link BOARD_LANE_CARD_LIMIT}. */
  readonly cards: readonly BoardCard[];
  /** Issues in this lane before the cap. */
  readonly total: number;
  /** How many of `total` the cap left out. */
  readonly hidden: number;
  /** True for lanes holding finished work, which the view collapses by default. */
  readonly closed: boolean;
}

export interface BoardModel {
  readonly lanes: readonly BoardLane[];
  /** Number of distinct issues on the board, before per-lane caps. */
  readonly surfaced: number;
  /** Issue count `bv` reported, which exceeds `surfaced` only when truncated. */
  readonly total: number;
  /** True when the payload dropped closed issues to stay inside its bound. */
  readonly truncated: boolean;
  /** True when lanes came from the whole-project graph rather than the fallback. */
  readonly complete: boolean;
  /** True when triage enriched or contributed cards. */
  readonly hasRecommendations: boolean;
  /** True when the plan enriched or contributed cards. */
  readonly hasTracks: boolean;
}

export interface BoardInput {
  /**
   * Whether the graph read succeeded. Kept separate from `issues` because a
   * healthy project with zero issues and a failed graph read are different
   * states that must not share an empty-state message.
   */
  readonly graphAvailable: boolean;
  /** Every issue `bv --robot-graph` reported. */
  readonly issues: readonly BoardIssue[];
  readonly total: number;
  readonly truncated: boolean;
  readonly recommendations: readonly Recommendation[];
  readonly tracks: readonly Track[];
}

/**
 * Cards rendered per lane. A closed lane can hold hundreds of issues; the lane
 * header keeps the true count, and the view offers the rest as "+N more".
 */
export const BOARD_LANE_CARD_LIMIT = 60;

/** Lane groups in reading order; unknown statuses sort between them. */
const LANE_RANK: readonly { readonly rank: number; readonly names: readonly string[] }[] = [
  { rank: 0, names: ["in_progress", "in progress", "in-progress", "active", "doing", "started"] },
  { rank: 1, names: ["blocked", "waiting", "on_hold", "on hold"] },
  { rank: 2, names: ["ready", "actionable", "open", "todo", "to_do", "to do", "backlog", "new"] },
  { rank: 4, names: CLOSED_STATUSES },
];

/** Unknown statuses land here and sort alphabetically among themselves. */
const UNKNOWN_LANE_RANK = 3;

const CLOSED_LANE_RANK = 4;

/**
 * Builds the board from the whole-project graph, falling back to the triage and
 * plan working set when the graph read failed.
 */
export function buildBoard(input: BoardInput): BoardModel {
  const enrichment = buildEnrichment(input.recommendations, input.tracks);
  const complete = input.graphAvailable;
  const byId = complete
    ? cardsFromIssues(input.issues, enrichment)
    : cardsFromWorkingSet(input.recommendations, input.tracks);

  const grouped = new Map<string, BoardCard[]>();
  for (const card of byId.values()) {
    const key = laneKey(card.status);
    const bucket = grouped.get(key);
    if (bucket === undefined) grouped.set(key, [card]);
    else bucket.push(card);
  }

  const lanes: BoardLane[] = [...grouped.entries()]
    .map(([key, cards]) => {
      const sorted = [...cards].sort(compareCards);
      return {
        status: key,
        label: laneLabel(key),
        cards: sorted.slice(0, BOARD_LANE_CARD_LIMIT),
        total: sorted.length,
        hidden: Math.max(0, sorted.length - BOARD_LANE_CARD_LIMIT),
        closed: laneRank(key) === CLOSED_LANE_RANK,
      };
    })
    .sort(compareLanes);

  let hasRecommendations = false;
  let hasTracks = false;
  for (const card of byId.values()) {
    if (card.fromRecommendations) hasRecommendations = true;
    if (card.trackIds.length > 0) hasTracks = true;
  }

  return {
    lanes,
    surfaced: byId.size,
    total: complete ? Math.max(input.total, byId.size) : byId.size,
    truncated: complete && input.truncated,
    complete,
    hasRecommendations,
    hasTracks,
  };
}

interface Enrichment {
  readonly recommendations: ReadonlyMap<string, Recommendation>;
  readonly trackIds: ReadonlyMap<string, readonly string[]>;
}

function buildEnrichment(
  recommendations: readonly Recommendation[],
  tracks: readonly Track[],
): Enrichment {
  const byId = new Map<string, Recommendation>();
  for (const recommendation of recommendations) {
    if (recommendation.id.length === 0) continue;
    byId.set(recommendation.id, recommendation);
  }
  const trackIds = new Map<string, string[]>();
  for (const track of tracks) {
    for (const item of track.items) {
      if (item.id.length === 0) continue;
      const existing = trackIds.get(item.id);
      if (existing === undefined) trackIds.set(item.id, [track.id]);
      else if (!existing.includes(track.id)) existing.push(track.id);
    }
  }
  return { recommendations: byId, trackIds };
}

/** The whole project: one card per graph node, enriched where triage knows more. */
function cardsFromIssues(
  issues: readonly BoardIssue[],
  enrichment: Enrichment,
): Map<string, BoardCard> {
  const byId = new Map<string, BoardCard>();
  for (const issue of issues) {
    if (issue.id.length === 0) continue;
    const recommendation = enrichment.recommendations.get(issue.id) ?? null;
    byId.set(issue.id, {
      id: issue.id,
      title: issue.title,
      status: issue.status,
      priority: issue.priority,
      // The graph carries no assignee or type, so triage is the only source.
      assignee: recommendation?.assignee ?? null,
      type: recommendation?.type ?? null,
      labels: issue.labels,
      blockedByCount: issue.blockedByCount,
      unblocksCount: issue.unblocksCount,
      trackIds: enrichment.trackIds.get(issue.id) ?? [],
      fromRecommendations: recommendation !== null,
    });
  }
  return byId;
}

/**
 * Fallback for a failed graph read: the deduplicated union of triage picks and
 * plan track items. Recommendation metadata wins on conflict because it is the
 * richer payload; track membership is merged in either way.
 */
function cardsFromWorkingSet(
  recommendations: readonly Recommendation[],
  tracks: readonly Track[],
): Map<string, BoardCard> {
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

  return byId;
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
