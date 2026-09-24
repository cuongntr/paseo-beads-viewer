/**
 * The project as a reader thinks about it: which work is done, moving, ready,
 * waiting on something, or held, and how that adds up per group.
 *
 * `bv` stays the authority for ranking (triage score), recommendations, plan
 * tracks and alerts. What `bv` reports but a reader misreads is re-derived here
 * from the whole-project graph, measured on a real project:
 *   - `blocked_count` counts only the `blocked` *status*, so a project with 15
 *     dependency-blocked issues showed "0 blocked";
 *   - `actionable_count` counts epics, so "12 ready" held 5 real tasks.
 * So an issue is *work* when nothing in the graph names it as a parent, and a
 * *container* when something does; only work is counted, carded and ranked.
 * Containers become the groups progress is reported against.
 *
 * Everything here is pure so it can be tested in the Vitest node environment.
 */
import { isClosedStatus, type BoardIssue, type Recommendation, type Track } from "../shared/beads";

/** Where a piece of work stands, derived from its status and its open blockers. */
export type WorkState = "active" | "ready" | "waiting" | "held" | "done";

/** Reading order: what is moving, what can start, what cannot, what is parked, what is finished. */
export const WORK_STATES: readonly WorkState[] = ["active", "ready", "waiting", "held", "done"];

const ACTIVE_STATUSES: readonly string[] = [
  "in_progress",
  "in progress",
  "in-progress",
  "active",
  "doing",
  "started",
  "in_review",
  "in review",
  "review",
  "hooked",
];

/** Held because something is in the way: these need a decision. */
const STUCK_STATUSES: readonly string[] = ["blocked", "waiting", "on_hold", "on hold", "on-hold"];

/** Held on purpose: parked, not stuck. */
const PARKED_STATUSES: readonly string[] = ["deferred", "paused", "pinned"];

const HELD_STATUSES: readonly string[] = [...STUCK_STATUSES, ...PARKED_STATUSES];

/** True for held work that was deliberately parked rather than stuck. */
export function isParked(status: string): boolean {
  return PARKED_STATUSES.includes(status.trim().toLowerCase());
}

/**
 * Labels that mean a person, not an agent, has to act. Beads has no field for
 * this, so projects mark it with a label; these are the spellings in use.
 */
export const ATTENTION_LABELS: readonly string[] = [
  "human-approval",
  "human",
  "needs-human",
  "approval",
  "needs-approval",
  "needs-decision",
];

/**
 * An explicit status wins over the graph: work someone claimed is active even
 * if a blocker reopened, and a deliberately parked issue is held. Only open
 * work is split by its blockers. Unknown statuses read as open, so a newer
 * tracker's status still lands somewhere sensible.
 */
export function workStateOf(status: string, openBlockers: number): WorkState {
  const normalized = status.trim().toLowerCase();
  if (isClosedStatus(normalized)) return "done";
  if (ACTIVE_STATUSES.includes(normalized)) return "active";
  if (HELD_STATUSES.includes(normalized)) return "held";
  return openBlockers > 0 ? "waiting" : "ready";
}

export interface WorkItem {
  readonly id: string;
  readonly title: string;
  /** Raw status, preserved verbatim. */
  readonly status: string;
  readonly state: WorkState;
  readonly priority: number | null;
  readonly assignee: string | null;
  readonly type: string | null;
  readonly labels: readonly string[];
  /** Ids of blockers that are still open. */
  readonly blockedBy: readonly string[];
  /**
   * Open blockers of a containing issue: work under a blocked work package
   * cannot start either, which `bv` agrees with. A blocker inside that
   * container's own subtree is not inherited, so an epic that waits on its own
   * tasks does not hold them back.
   */
  readonly inheritedBlockedBy: readonly string[];
  /** The nearest container whose blockers hold this issue, when any do. */
  readonly heldVia: string | null;
  /** Open issues waiting on this one. */
  readonly unblocksCount: number;
  readonly parentId: string | null;
  /** True when some issue names this one as its parent. */
  readonly container: boolean;
  /** True when a label says a person has to act. */
  readonly attention: boolean;
  /** True when this issue is on the longest chain of open dependencies. */
  readonly critical: boolean;
  /** Triage score when `bv` recommended this issue; its ranking, not ours. */
  readonly score: number | null;
  /** `bv`'s suggested action for a recommended issue. */
  readonly action: string | null;
  /** Plan tracks this issue belongs to, in plan order. */
  readonly trackIds: readonly string[];
}

export type StateCounts = Readonly<Record<WorkState, number>>;

/** A container's own work: the issues whose direct parent it is. */
export interface WorkPackage {
  readonly key: string;
  /** The container issue, or null for the catch-all of parentless work. */
  readonly id: string | null;
  readonly title: string;
  readonly items: readonly WorkItem[];
  readonly counts: StateCounts;
  readonly done: number;
  readonly total: number;
  /** True when every item is done. */
  readonly settled: boolean;
}

/** An outermost container and the packages under it. */
export interface WorkRoot {
  readonly key: string;
  readonly id: string | null;
  readonly title: string;
  readonly packages: readonly WorkPackage[];
  readonly counts: StateCounts;
  readonly done: number;
  readonly total: number;
  readonly settled: boolean;
}

export interface ProjectModel {
  /** False when the graph read failed and only triage/plan items are known. */
  readonly complete: boolean;
  /** True when the payload dropped closed issues to stay inside its bound. */
  readonly truncated: boolean;
  /** Every issue, containers included, by id. */
  readonly byId: ReadonlyMap<string, WorkItem>;
  /** Work only, in {@link compareWork} order. */
  readonly work: readonly WorkItem[];
  /** Work per state, over {@link work}. */
  readonly counts: StateCounts;
  readonly roots: readonly WorkRoot[];
  /** The longest chain of open dependencies, first step first; empty below two steps. */
  readonly chain: readonly WorkItem[];
  /** True when a dependency cycle among open work makes the chain unmeasurable. */
  readonly chainCycle: boolean;
  /** False when every live work item shares one priority, so priority carries no signal. */
  readonly priorityVaries: boolean;
}

export interface ProjectInput {
  readonly graphAvailable: boolean;
  readonly issues: readonly BoardIssue[];
  readonly truncated: boolean;
  readonly recommendations: readonly Recommendation[];
  readonly tracks: readonly Track[];
}

/** Group key for work with no parent. */
export const LOOSE_KEY = "\u0000loose";

export function buildProject(input: ProjectInput): ProjectModel {
  const recommendations = new Map<string, Recommendation>();
  for (const recommendation of input.recommendations) {
    if (recommendation.id.length > 0) recommendations.set(recommendation.id, recommendation);
  }
  const trackIds = trackMembership(input.tracks);
  const seeds = input.graphAvailable
    ? seedsFromGraph(input.issues)
    : seedsFromWorkingSet(input.recommendations, input.tracks);

  // The server counts children before truncation, so an epic whose closed
  // children were dropped from the payload is still a container here.
  const parents = new Set<string>();
  for (const seed of seeds.values()) {
    if (seed.childCount > 0) parents.add(seed.id);
    if (seed.parentId !== null && seed.parentId !== seed.id && seeds.has(seed.parentId)) {
      parents.add(seed.parentId);
    }
  }

  const draft = new Map<string, WorkItem>();
  for (const seed of seeds.values()) {
    const recommendation = recommendations.get(seed.id) ?? null;
    const inherited = inheritedBlockers(seed, seeds);
    draft.set(seed.id, {
      ...seed,
      inheritedBlockedBy: inherited.blockers,
      heldVia: inherited.via,
      state: workStateOf(seed.status, seed.blockedBy.length + inherited.blockers.length),
      assignee: seed.assignee ?? recommendation?.assignee ?? null,
      type: seed.type ?? recommendation?.type ?? null,
      container: parents.has(seed.id),
      attention: seed.labels.some((label) => ATTENTION_LABELS.includes(label.trim().toLowerCase())),
      critical: false,
      score: recommendation?.score ?? null,
      action: recommendation?.action ?? null,
      trackIds: trackIds.get(seed.id) ?? [],
    });
  }

  const { chain: chainIds, cycle } = longestChain(draft);
  const byId = new Map<string, WorkItem>();
  const onChain = new Set(chainIds);
  for (const [id, item] of draft) byId.set(id, onChain.has(id) ? { ...item, critical: true } : item);

  const work = [...byId.values()].filter((item) => !item.container).sort(compareWork);
  const livePriorities = new Set(work.filter((item) => item.state !== "done").map((item) => item.priority));

  return {
    complete: input.graphAvailable,
    truncated: input.graphAvailable && input.truncated,
    byId,
    work,
    counts: countStates(work),
    roots: buildRoots(work, byId),
    chain: chainIds.map((id) => byId.get(id)).filter((item) => item !== undefined),
    chainCycle: cycle,
    priorityVaries: livePriorities.size > 1,
  };
}

type Seed = Pick<
  WorkItem,
  "id" | "title" | "status" | "priority" | "assignee" | "type" | "labels" | "blockedBy" | "unblocksCount" | "parentId"
> & { readonly childCount: number };

/**
 * Open blockers of every containing issue, nearest first, leaving out any
 * blocker that sits inside that container's own subtree.
 */
function inheritedBlockers(
  seed: Seed,
  seeds: ReadonlyMap<string, Seed>,
): { readonly blockers: readonly string[]; readonly via: string | null } {
  const blockers: string[] = [];
  let via: string | null = null;
  const visited = new Set<string>([seed.id]);
  for (let id = seed.parentId; id !== null && !visited.has(id); ) {
    visited.add(id);
    const ancestor = seeds.get(id);
    if (ancestor === undefined) break;
    if (!isClosedStatus(ancestor.status)) {
      for (const blocker of ancestor.blockedBy) {
        if (blockers.includes(blocker) || seed.blockedBy.includes(blocker)) continue;
        if (isWithin(blocker, ancestor.id, seeds)) continue;
        blockers.push(blocker);
        via ??= ancestor.id;
      }
    }
    id = ancestor.parentId;
  }
  return { blockers, via };
}

/** True when `id` is `root` or sits somewhere under it. */
function isWithin(id: string, root: string, seeds: ReadonlyMap<string, Seed>): boolean {
  const visited = new Set<string>();
  for (let current: string | null = id; current !== null && !visited.has(current); ) {
    if (current === root) return true;
    visited.add(current);
    current = seeds.get(current)?.parentId ?? null;
  }
  return false;
}

function seedsFromGraph(issues: readonly BoardIssue[]): Map<string, Seed> {
  const seeds = new Map<string, Seed>();
  for (const issue of issues) {
    if (issue.id.length === 0 || seeds.has(issue.id)) continue;
    seeds.set(issue.id, {
      id: issue.id,
      title: issue.title,
      status: issue.status,
      priority: issue.priority,
      assignee: issue.assignee,
      type: issue.type,
      labels: issue.labels,
      blockedBy: issue.blockedBy,
      unblocksCount: issue.unblocksCount,
      parentId: issue.parentId,
      childCount: issue.childCount,
    });
  }
  return seeds;
}

/**
 * Fallback for a failed graph read: triage picks and plan track items. Triage
 * lists only open blockers, and plan tracks hold only actionable items, so
 * both are safe to derive a state from; neither knows parents.
 */
function seedsFromWorkingSet(
  recommendations: readonly Recommendation[],
  tracks: readonly Track[],
): Map<string, Seed> {
  const seeds = new Map<string, Seed>();
  for (const recommendation of recommendations) {
    if (recommendation.id.length === 0 || seeds.has(recommendation.id)) continue;
    seeds.set(recommendation.id, {
      id: recommendation.id,
      title: recommendation.title,
      status: recommendation.status,
      priority: recommendation.priority,
      assignee: recommendation.assignee,
      type: recommendation.type,
      labels: recommendation.labels,
      blockedBy: recommendation.blockedBy,
      unblocksCount: recommendation.unblocks.length,
      parentId: null,
      childCount: 0,
    });
  }
  for (const track of tracks) {
    for (const item of track.items) {
      if (item.id.length === 0 || seeds.has(item.id)) continue;
      seeds.set(item.id, {
        id: item.id,
        title: item.title,
        status: item.status,
        priority: item.priority,
        assignee: null,
        type: null,
        labels: [],
        blockedBy: [],
        unblocksCount: item.unblocks.length,
        parentId: null,
        childCount: 0,
      });
    }
  }
  return seeds;
}

function trackMembership(tracks: readonly Track[]): Map<string, string[]> {
  const membership = new Map<string, string[]>();
  for (const track of tracks) {
    for (const item of track.items) {
      if (item.id.length === 0) continue;
      const existing = membership.get(item.id);
      if (existing === undefined) membership.set(item.id, [track.id]);
      else if (!existing.includes(track.id)) existing.push(track.id);
    }
  }
  return membership;
}

/**
 * The longest chain of open dependencies among unfinished work, first step
 * first. Its length is the least number of sequential steps left, however many
 * agents work in parallel, which is the schedule risk a count cannot show.
 * Blockers inherited from a blocked container count as edges; a container
 * itself is never a step.
 *
 * `bv --robot-insights` reports slack, but caps that list by value on large
 * projects and drops exactly the zero-slack issues, so the chain is walked
 * here from the same open-blocker edges the cards show. Ties go to the lower
 * id so the chain is stable across reads. A cycle among open work makes the
 * chain unmeasurable, so it is reported as a cycle and no chain is claimed.
 */
function longestChain(items: ReadonlyMap<string, WorkItem>): { readonly chain: string[]; readonly cycle: boolean } {
  const depth = new Map<string, number>();
  const next = new Map<string, string | null>();
  const visiting = new Set<string>();
  let cycle = false;

  // Only unfinished work takes part; a container is a heading, not a step.
  const node = (id: string): WorkItem | null => {
    const item = items.get(id);
    return item === undefined || item.state === "done" || item.container ? null : item;
  };
  const blockersOf = (item: WorkItem): string[] =>
    [...item.blockedBy, ...item.inheritedBlockedBy].filter((blocker) => node(blocker) !== null).sort(compareIds);

  // Iterative post-order so a long chain cannot overflow the call stack.
  const resolve = (start: string): void => {
    const stack: string[] = [start];
    while (stack.length > 0) {
      const id = stack[stack.length - 1] as string;
      if (depth.has(id)) {
        stack.pop();
        continue;
      }
      const item = node(id);
      const blockers = item === null ? [] : blockersOf(item);
      if (!visiting.has(id)) {
        visiting.add(id);
        for (const blocker of blockers) {
          // A blocker still being resolved is an ancestor on this path: a cycle.
          if (visiting.has(blocker)) cycle = true;
          else if (!depth.has(blocker)) stack.push(blocker);
        }
        continue;
      }
      let best: string | null = null;
      let bestDepth = 0;
      for (const blocker of blockers) {
        const blockerDepth = depth.get(blocker) ?? 0;
        if (blockerDepth > bestDepth) {
          best = blocker;
          bestDepth = blockerDepth;
        }
      }
      depth.set(id, bestDepth + 1);
      next.set(id, best);
      visiting.delete(id);
      stack.pop();
    }
  };

  let tail: string | null = null;
  let tailDepth = 0;
  for (const id of [...items.keys()].sort(compareIds)) {
    if (node(id) === null) continue;
    resolve(id);
    const itemDepth = depth.get(id) ?? 0;
    if (itemDepth > tailDepth) {
      tail = id;
      tailDepth = itemDepth;
    }
  }

  // Depths inside a cycle depend on where the walk entered it, so no chain is
  // claimed at all; the Risks view names the cycle instead.
  if (cycle) return { chain: [], cycle: true };

  const reversed: string[] = [];
  const seen = new Set<string>();
  for (let id = tail; id !== null && !seen.has(id); id = next.get(id) ?? null) {
    seen.add(id);
    reversed.push(id);
  }
  return { chain: reversed.length < 2 ? [] : reversed.reverse(), cycle: false };
}

/**
 * Groups work by its direct parent, and those packages by their outermost
 * container, so a project shaped epic → work package → task reads as it was
 * planned. Walking straight to the outermost epic instead put a 27-issue
 * project in a single group.
 */
function buildRoots(work: readonly WorkItem[], byId: ReadonlyMap<string, WorkItem>): WorkRoot[] {
  const packages = new Map<string, { id: string | null; items: WorkItem[] }>();
  for (const item of work) {
    const parent = item.parentId === null ? undefined : byId.get(item.parentId);
    const key = parent === undefined ? LOOSE_KEY : parent.id;
    const bucket = packages.get(key);
    if (bucket === undefined) packages.set(key, { id: parent?.id ?? null, items: [item] });
    else bucket.items.push(item);
  }

  const roots = new Map<string, { id: string | null; packages: WorkPackage[] }>();
  for (const [key, bucket] of packages) {
    const container = bucket.id === null ? null : (byId.get(bucket.id) ?? null);
    const pkg = finishPackage(key, container, bucket.items);
    const root = container === null ? null : outermost(container, byId);
    const rootKey = root?.id ?? LOOSE_KEY;
    const entry = roots.get(rootKey);
    if (entry === undefined) roots.set(rootKey, { id: root?.id ?? null, packages: [pkg] });
    else entry.packages.push(pkg);
  }

  return [...roots.entries()]
    .map(([key, entry]) => {
      const container = entry.id === null ? null : (byId.get(entry.id) ?? null);
      const sorted = [...entry.packages].sort(comparePackages);
      const counts = sumCounts(sorted.map((pkg) => pkg.counts));
      const total = sorted.reduce((sum, pkg) => sum + pkg.total, 0);
      return {
        key,
        id: entry.id,
        title: container?.title ?? "Not under an epic",
        packages: sorted,
        counts,
        done: counts.done,
        total,
        settled: counts.done === total,
      };
    })
    .sort(comparePackages);
}

function finishPackage(key: string, container: WorkItem | null, items: readonly WorkItem[]): WorkPackage {
  const counts = countStates(items);
  return {
    key,
    id: container?.id ?? null,
    title: container?.title ?? "No parent",
    items,
    counts,
    done: counts.done,
    total: items.length,
    settled: counts.done === items.length,
  };
}

function outermost(container: WorkItem, byId: ReadonlyMap<string, WorkItem>): WorkItem {
  let current = container;
  const visited = new Set<string>([container.id]);
  while (current.parentId !== null && !visited.has(current.parentId)) {
    visited.add(current.parentId);
    const parent = byId.get(current.parentId);
    if (parent === undefined) break;
    current = parent;
  }
  return current;
}

/** Plan order: parented groups by id with numbers compared as numbers, the catch-all last. */
function comparePackages(
  left: { readonly id: string | null; readonly key: string },
  right: { readonly id: string | null; readonly key: string },
): number {
  if (left.id === null || right.id === null) {
    if (left.id === right.id) return 0;
    return left.id === null ? 1 : -1;
  }
  return compareIds(left.id, right.id);
}

export function countStates(items: readonly WorkItem[]): StateCounts {
  const counts: Record<WorkState, number> = { active: 0, ready: 0, waiting: 0, held: 0, done: 0 };
  for (const item of items) counts[item.state] += 1;
  return counts;
}

function sumCounts(all: readonly StateCounts[]): StateCounts {
  const counts: Record<WorkState, number> = { active: 0, ready: 0, waiting: 0, held: 0, done: 0 };
  for (const entry of all) for (const state of WORK_STATES) counts[state] += entry[state];
  return counts;
}

/** Ids compared with embedded numbers as numbers, so `x.2` precedes `x.10`. */
export function compareIds(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * Within one state: explicit priority first when a project uses it, then the
 * critical chain, then `bv`'s triage score, then how much the work unblocks,
 * then plan order by id.
 */
export function compareWork(left: WorkItem, right: WorkItem): number {
  const leftPriority = left.priority ?? Number.MAX_SAFE_INTEGER;
  const rightPriority = right.priority ?? Number.MAX_SAFE_INTEGER;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  if (left.critical !== right.critical) return left.critical ? -1 : 1;
  const leftScore = left.score ?? Number.NEGATIVE_INFINITY;
  const rightScore = right.score ?? Number.NEGATIVE_INFINITY;
  if (leftScore !== rightScore) return rightScore - leftScore;
  if (left.unblocksCount !== right.unblocksCount) return right.unblocksCount - left.unblocksCount;
  return compareIds(left.id, right.id);
}

/** Work in one state, in {@link compareWork} order. */
export function workIn(project: ProjectModel, state: WorkState): readonly WorkItem[] {
  return project.work.filter((item) => item.state === state);
}

/** Unfinished work a person has to act on, whatever can start first. */
export function attentionWork(project: ProjectModel): readonly WorkItem[] {
  const order = (item: WorkItem) => WORK_STATES.indexOf(item.state);
  return project.work
    .filter((item) => item.attention && item.state !== "done")
    .sort((left, right) => order(left) - order(right) || compareWork(left, right));
}
