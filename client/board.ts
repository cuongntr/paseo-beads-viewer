/**
 * Board derivation for the read-only project board.
 *
 * Issues come from `bv --robot-graph`, the one `bv` read that returns the whole
 * project, enriched by the tracker's type/assignee overlay and by triage and
 * plan metadata. What varies is how they are *grouped*: status is only one of
 * four axes, and it is rarely the one a reader wants when a mature project
 * holds hundreds of closed issues.
 *
 * Measured on a real 776-issue project, which is what the axes are shaped for:
 * 620 issues have a parent, the epic→task link carries 432 of those pairs,
 * bugs sit outside the tree almost always (4 of 34 have a parent), 734 issues
 * carry exactly one `feature:` label, and only 38 issues are not closed. So the
 * default view hides finished work and groups by the containing epic.
 *
 * Statuses and types stay opaque strings: groups are discovered from the data,
 * and only group *ordering* uses well-known names. Everything is pure so it can
 * be tested in the Vitest node environment.
 */
import {
  CLOSED_STATUSES,
  CONTAINER_TYPES,
  FEATURE_LABEL_PREFIX,
  isClosedStatus,
  type BoardIssue,
  type Recommendation,
  type Track,
} from "../shared/beads";

/** How the board divides the project into groups. */
export type BoardAxis = "epic" | "feature" | "type" | "status";

export const BOARD_AXES: readonly BoardAxis[] = ["epic", "feature", "type", "status"];

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
  readonly parentId: string | null;
  /** Track ids this issue belongs to, in plan order. */
  readonly trackIds: readonly string[];
  /** True when triage recommended this issue, i.e. its metadata is triage-grade. */
  readonly fromRecommendations: boolean;
}

/** A column or section of the board. */
export interface BoardGroup {
  /** Stable identity for keys and expand/collapse state. */
  readonly key: string;
  readonly label: string;
  /** Issue heading this group, when the group is an issue itself (an epic). */
  readonly headerId: string | null;
  /** Cards to render, after the closed filter and the per-group cap. */
  readonly cards: readonly BoardCard[];
  /** Issues in this group that survived the closed filter. */
  readonly total: number;
  /** How many of `total` the cap left out. */
  readonly hidden: number;
  /** Issues in this group before the closed filter. */
  readonly size: number;
  /** Closed issues in this group, so a group can show real progress. */
  readonly done: number;
  /** True when nothing live remains here, so the view collapses it by default. */
  readonly settled: boolean;
  /** Axis-defined precedence: containers lead, catch-all groups sink. */
  readonly rank: number;
}

export interface BoardModel {
  readonly axis: BoardAxis;
  readonly groups: readonly BoardGroup[];
  /** Distinct issues placed on the board, before per-group caps. */
  readonly surfaced: number;
  /** Issue count `bv` reported, which exceeds `surfaced` only when truncated. */
  readonly total: number;
  /** Issues that are not closed, whatever the current filter shows. */
  readonly live: number;
  /** True when the payload dropped closed issues to stay inside its bound. */
  readonly truncated: boolean;
  /** True when groups came from the whole-project graph rather than the fallback. */
  readonly complete: boolean;
  /** True when the tracker supplied types, without which `epic` and `type` cannot group. */
  readonly typed: boolean;
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
  /** Whether the tracker supplied the type/assignee overlay. */
  readonly typed: boolean;
  readonly total: number;
  readonly truncated: boolean;
  readonly recommendations: readonly Recommendation[];
  readonly tracks: readonly Track[];
  readonly axis: BoardAxis;
  /** Default on: a mature project buries its live work under finished work. */
  readonly hideClosed: boolean;
}

/**
 * Cards rendered per group. A closed status or a long-running epic can hold
 * hundreds of issues; the group header keeps the true count, and the view
 * offers the rest as "+N more".
 */
export const BOARD_LANE_CARD_LIMIT = 60;

/** Group key used when an issue has no container on the current axis. */
export const UNGROUPED_KEY = "\u0000ungrouped";

/** Status groups in reading order; unknown statuses sort between them. */
const LANE_RANK: readonly { readonly rank: number; readonly names: readonly string[] }[] = [
  { rank: 0, names: ["in_progress", "in progress", "in-progress", "active", "doing", "started"] },
  { rank: 1, names: ["blocked", "waiting", "on_hold", "on hold"] },
  { rank: 2, names: ["ready", "actionable", "open", "todo", "to_do", "to do", "backlog", "new"] },
  { rank: 4, names: CLOSED_STATUSES },
];

/** Unknown statuses land here and sort alphabetically among themselves. */
const UNKNOWN_LANE_RANK = 3;

const CLOSED_LANE_RANK = 4;

/** Type groups in reading order: containers first, then work, then defects. */
const TYPE_ORDER: readonly string[] = ["epic", "feature", "milestone", "story", "task", "chore", "bug"];

export function buildBoard(input: BoardInput): BoardModel {
  const enrichment = buildEnrichment(input.recommendations, input.tracks);
  const complete = input.graphAvailable;
  const byId = complete
    ? cardsFromIssues(input.issues, enrichment)
    : cardsFromWorkingSet(input.recommendations, input.tracks);

  // `epic` and `type` need the tracker overlay; without it they would put every
  // issue in one unnamed pile, so the board falls back to grouping by status.
  const axis = (input.axis === "epic" || input.axis === "type") && !input.typed ? "status" : input.axis;

  const assignments = new Map<string, readonly GroupSlot[]>();
  for (const card of byId.values()) assignments.set(card.id, slotsFor(card, axis, byId));

  const buckets = new Map<string, MutableGroup>();
  for (const card of byId.values()) {
    for (const slot of assignments.get(card.id) ?? []) {
      const bucket = buckets.get(slot.key);
      if (bucket === undefined) {
        buckets.set(slot.key, { slot, members: [card] });
      } else {
        bucket.members.push(card);
      }
    }
  }

  const groups = [...buckets.values()]
    .map((bucket) => finishGroup(bucket, input.hideClosed))
    .filter((group) => group.size > 0)
    .sort((left, right) => compareGroups(left, right, axis));

  let live = 0;
  let hasRecommendations = false;
  let hasTracks = false;
  for (const card of byId.values()) {
    if (!isClosedStatus(card.status)) live += 1;
    if (card.fromRecommendations) hasRecommendations = true;
    if (card.trackIds.length > 0) hasTracks = true;
  }

  return {
    axis,
    groups,
    surfaced: byId.size,
    total: complete ? Math.max(input.total, byId.size) : byId.size,
    live,
    truncated: complete && input.truncated,
    complete,
    typed: input.typed,
    hasRecommendations,
    hasTracks,
  };
}

interface GroupSlot {
  readonly key: string;
  readonly label: string;
  readonly headerId: string | null;
  /** Ties are broken by this before the label, so well-known groups lead. */
  readonly rank: number;
}

interface MutableGroup {
  readonly slot: GroupSlot;
  readonly members: BoardCard[];
}

/**
 * Which groups a card belongs to on the given axis. Only the feature axis can
 * return more than one: an issue carrying two `feature:` labels genuinely
 * belongs to both, and dropping one would hide work from a reader who filters
 * by the other.
 */
function slotsFor(
  card: BoardCard,
  axis: BoardAxis,
  byId: ReadonlyMap<string, BoardCard>,
): readonly GroupSlot[] {
  switch (axis) {
    case "status": {
      const key = card.status.trim().length === 0 ? "unknown" : card.status.trim();
      return [{ key, label: laneLabel(key), headerId: null, rank: laneRank(key) }];
    }
    case "type": {
      const type = card.type?.trim().toLowerCase() ?? "";
      if (type.length === 0) return [untyped("No type")];
      const rank = TYPE_ORDER.indexOf(type);
      return [{ key: type, label: type, headerId: null, rank: rank === -1 ? TYPE_ORDER.length : rank }];
    }
    case "feature": {
      const features = card.labels.filter((label) => label.startsWith(FEATURE_LABEL_PREFIX));
      if (features.length === 0) return [untyped("No feature")];
      return features.map((label) => ({
        key: label,
        label: label.slice(FEATURE_LABEL_PREFIX.length),
        headerId: null,
        rank: 0,
      }));
    }
    case "epic": {
      const container = containerOf(card, byId);
      if (container === null) return [untyped(card.type === "bug" ? "Loose bugs" : "No epic")];
      return [{ key: container.id, label: container.title, headerId: container.id, rank: 0 }];
    }
  }
}

function untyped(label: string): GroupSlot {
  // Sorted last by rank so a catch-all never heads the board.
  return { key: `${UNGROUPED_KEY}:${label}`, label, headerId: null, rank: Number.MAX_SAFE_INTEGER };
}

/**
 * Walks up the parent chain to the outermost container (an epic, feature, or
 * similar) so a task nested under a sub-epic still lands under the epic a
 * reader thinks in. Returns null when nothing on the chain is a container,
 * which is the normal case for a loose bug. The visited set makes a cyclic or
 * self-referential chain terminate instead of hanging the panel.
 */
function containerOf(
  card: BoardCard,
  byId: ReadonlyMap<string, BoardCard>,
): BoardCard | null {
  let outermost: BoardCard | null = isContainer(card) ? card : null;
  const visited = new Set<string>([card.id]);
  let current: BoardCard | undefined = card;
  while (current?.parentId != null && !visited.has(current.parentId)) {
    visited.add(current.parentId);
    const parent: BoardCard | undefined = byId.get(current.parentId);
    if (parent === undefined) break;
    if (isContainer(parent)) outermost = parent;
    current = parent;
  }
  return outermost;
}

function isContainer(card: BoardCard): boolean {
  const type = card.type?.trim().toLowerCase() ?? "";
  return CONTAINER_TYPES.includes(type);
}

function finishGroup(bucket: MutableGroup, hideClosed: boolean): BoardGroup {
  const { slot, members } = bucket;
  const done = members.filter((card) => isClosedStatus(card.status)).length;
  // The heading issue is the group, so listing it inside itself is noise.
  const body = members.filter((card) => card.id !== slot.headerId);
  const visible = (hideClosed ? body.filter((card) => !isClosedStatus(card.status)) : body).sort(
    compareCards,
  );
  return {
    key: slot.key,
    label: slot.label,
    headerId: slot.headerId,
    rank: slot.rank,
    cards: visible.slice(0, BOARD_LANE_CARD_LIMIT),
    total: visible.length,
    hidden: Math.max(0, visible.length - BOARD_LANE_CARD_LIMIT),
    size: members.length,
    done,
    settled: done === members.length,
  };
}

/**
 * Finished groups sink, then the axis's own precedence decides, then the group
 * with the most unfinished work leads.
 *
 * The axes want different things from this. Status has a well-known reading
 * order, because a reader expects in-progress before blocked before open. Type
 * wants containers before work before defects, which is what `rank` carries.
 * Epic and feature have no intrinsic order, so every real group ranks equal and
 * live volume decides, while the catch-all group ranks last and sinks.
 */
function compareGroups(left: BoardGroup, right: BoardGroup, axis: BoardAxis): number {
  if (axis === "status") {
    const rankDelta = laneRank(left.key) - laneRank(right.key);
    if (rankDelta !== 0) return rankDelta;
    return left.key.localeCompare(right.key);
  }
  if (left.settled !== right.settled) return left.settled ? 1 : -1;
  if (left.rank !== right.rank) return left.rank - right.rank;
  const leftLive = left.size - left.done;
  const rightLive = right.size - right.done;
  if (leftLive !== rightLive) return rightLive - leftLive;
  if (left.size !== right.size) return right.size - left.size;
  return left.label.localeCompare(right.label);
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

/** The whole project: one card per graph node, enriched where another source knows more. */
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
      // The tracker overlay covers the whole project; triage only covers its
      // own picks, so it is the fallback rather than the source.
      assignee: issue.assignee ?? recommendation?.assignee ?? null,
      type: issue.type ?? recommendation?.type ?? null,
      labels: issue.labels,
      blockedByCount: issue.blockedByCount,
      unblocksCount: issue.unblocksCount,
      parentId: issue.parentId,
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
      parentId: null,
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
          parentId: null,
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

/** Human-readable group heading for an opaque status value. */
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

/** True for a status group holding finished work, which the view collapses. */
export function isClosedLane(status: string): boolean {
  return laneRank(status) === CLOSED_LANE_RANK;
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
