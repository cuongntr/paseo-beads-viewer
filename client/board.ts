/**
 * Board layout for the read-only project board.
 *
 * Columns are the derived {@link WorkState}, not the raw status: on a real
 * project every live issue had status `open`, so a status board was one column
 * of 27 cards that could not tell ready work from work waiting on three others.
 * Lanes are the grouping the reader picks, by default the work package (the
 * direct parent), which is the unit a Beads plan is written in.
 *
 * Only work is carded. A container is its lane's heading and progress, never a
 * card beside its own tasks. Everything is pure for the Vitest node environment.
 */
import { FEATURE_LABEL_PREFIX } from "../shared/beads";
import {
  compareIds,
  countStates,
  LOOSE_KEY,
  WORK_STATES,
  type ProjectModel,
  type StateCounts,
  type WorkItem,
  type WorkState,
} from "./project";

/** How the board divides work into lanes. */
export type BoardGrouping = "package" | "epic" | "feature" | "none";

export const BOARD_GROUPINGS: readonly BoardGrouping[] = ["package", "epic", "feature", "none"];

/**
 * Cards rendered per cell. The lane header keeps the true count, and the view
 * reports the rest as "+N more".
 */
export const BOARD_CELL_CARD_LIMIT = 40;

export interface BoardCell {
  readonly cards: readonly WorkItem[];
  readonly total: number;
  readonly hidden: number;
}

export interface BoardLane {
  readonly key: string;
  readonly label: string;
  /** The container issue heading this lane, when there is one to open. */
  readonly headerId: string | null;
  /** The outermost container, shown under a package lane when it differs. */
  readonly context: string | null;
  readonly cells: Readonly<Record<WorkState, BoardCell>>;
  readonly counts: StateCounts;
  readonly done: number;
  readonly total: number;
  /** True when every item in the lane is done. */
  readonly settled: boolean;
}

export interface BoardModel {
  readonly grouping: BoardGrouping;
  /** Lanes to render; settled lanes are dropped unless done work is shown. */
  readonly lanes: readonly BoardLane[];
  /** Columns to render, in {@link WORK_STATES} order. */
  readonly columns: readonly WorkState[];
  /** Work per state across the whole board. */
  readonly counts: StateCounts;
  /** Settled lanes left out because done work is hidden. */
  readonly settledHidden: number;
  readonly showDone: boolean;
}

export function buildBoard(project: ProjectModel, grouping: BoardGrouping, showDone: boolean): BoardModel {
  const buckets = new Map<string, { slot: LaneSlot; items: WorkItem[] }>();
  for (const item of project.work) {
    for (const slot of slotsFor(item, grouping, project)) {
      const bucket = buckets.get(slot.key);
      if (bucket === undefined) buckets.set(slot.key, { slot, items: [item] });
      else bucket.items.push(item);
    }
  }

  const all = [...buckets.values()]
    .map(({ slot, items }) => finishLane(slot, items))
    .sort(compareLanes);
  const lanes = showDone ? all : all.filter((lane) => !lane.settled);
  const counts = countStates(project.work);

  // Held is an exception, so its column appears only when something is held.
  // Done is a column only on request; otherwise it is each lane's progress.
  const columns = WORK_STATES.filter((state) => {
    if (state === "held") return counts.held > 0;
    if (state === "done") return showDone;
    return true;
  });

  return {
    grouping,
    lanes,
    columns,
    counts,
    settledHidden: all.length - lanes.length,
    showDone,
  };
}

interface LaneSlot {
  readonly key: string;
  readonly label: string;
  readonly headerId: string | null;
  readonly context: string | null;
  /** Sort key: containers by id, features by name, catch-alls last. */
  readonly order: string | null;
}

/**
 * Which lanes an item belongs to. Only the feature grouping can return more
 * than one: an issue carrying two `feature:` labels belongs to both.
 */
function slotsFor(item: WorkItem, grouping: BoardGrouping, project: ProjectModel): readonly LaneSlot[] {
  switch (grouping) {
    case "none":
      return [{ key: "all", label: "All work", headerId: null, context: null, order: "" }];
    case "feature": {
      // A label repeated on one issue is still one membership.
      const features = [...new Set(item.labels.filter((label) => label.startsWith(FEATURE_LABEL_PREFIX)))];
      if (features.length === 0) return [catchAll("No feature label")];
      return features.map((label) => ({
        key: label,
        label: label.slice(FEATURE_LABEL_PREFIX.length),
        headerId: null,
        context: null,
        order: label,
      }));
    }
    case "package": {
      const parent = item.parentId === null ? undefined : project.byId.get(item.parentId);
      if (parent === undefined) return [catchAll("No parent")];
      const root = outermost(parent, project);
      return [
        {
          key: parent.id,
          label: parent.title,
          headerId: parent.id,
          context: root.id === parent.id ? null : root.id,
          order: parent.id,
        },
      ];
    }
    case "epic": {
      const parent = item.parentId === null ? undefined : project.byId.get(item.parentId);
      if (parent === undefined) return [catchAll("Not under an epic")];
      const root = outermost(parent, project);
      return [{ key: root.id, label: root.title, headerId: root.id, context: null, order: root.id }];
    }
  }
}

function catchAll(label: string): LaneSlot {
  return { key: `${LOOSE_KEY}:${label}`, label, headerId: null, context: null, order: null };
}

function outermost(container: WorkItem, project: ProjectModel): WorkItem {
  let current = container;
  const visited = new Set<string>([container.id]);
  while (current.parentId !== null && !visited.has(current.parentId)) {
    visited.add(current.parentId);
    const parent = project.byId.get(current.parentId);
    if (parent === undefined) break;
    current = parent;
  }
  return current;
}

function finishLane(slot: LaneSlot, items: readonly WorkItem[]): BoardLane & { readonly order: string | null } {
  const counts = countStates(items);
  const cells = {} as Record<WorkState, BoardCell>;
  for (const state of WORK_STATES) {
    // Items arrive in project order, which is already the in-cell order.
    const inState = items.filter((item) => item.state === state);
    cells[state] = {
      cards: inState.slice(0, BOARD_CELL_CARD_LIMIT),
      total: inState.length,
      hidden: Math.max(0, inState.length - BOARD_CELL_CARD_LIMIT),
    };
  }
  return {
    key: slot.key,
    label: slot.label,
    headerId: slot.headerId,
    context: slot.context,
    order: slot.order,
    cells,
    counts,
    done: counts.done,
    total: items.length,
    settled: counts.done === items.length,
  };
}

/** Plan order by id, numbers compared as numbers; catch-all lanes sink. */
function compareLanes(
  left: { readonly order: string | null; readonly key: string },
  right: { readonly order: string | null; readonly key: string },
): number {
  if (left.order === null || right.order === null) {
    if (left.order === right.order) return left.key.localeCompare(right.key);
    return left.order === null ? 1 : -1;
  }
  return compareIds(left.order, right.order);
}
