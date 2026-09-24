/**
 * Board layout for the read-only project board.
 *
 * Columns are the derived {@link WorkState}, not the raw status: on a real
 * project every live issue had status `open`, so a status board was one column
 * of 27 cards that could not tell ready work from work waiting on three others.
 * Lanes are the grouping the reader picks, by default the direct parent, which
 * is how a Beads plan nests its work whatever the project calls its levels.
 *
 * Only work is carded. A container is its lane's heading and progress, never a
 * card beside its own tasks. Everything is pure for the Vitest node environment.
 */
import {
  compareIds,
  countStates,
  labelNamespace,
  LOOSE_KEY,
  WORK_STATES,
  type ProjectModel,
  type StateCounts,
  type WorkItem,
  type WorkState,
} from "./project";

/**
 * How the board divides work into lanes. `parent` and `root` follow parent
 * links; `labels` puts work under each label it carries; `ns:<prefix>` does the
 * same for one `prefix:value` label family. Label groupings are discovered from
 * the project's own labels, never from a fixed list.
 */
export type BoardGrouping = "parent" | "root" | "none" | "labels" | `ns:${string}`;

/** Groupings this project's data supports, in the order they are offered. */
export function boardGroupings(project: ProjectModel): readonly BoardGrouping[] {
  const groupings: BoardGrouping[] = ["parent", "root", "none"];
  if (project.labels.length > 0) groupings.push("labels");
  for (const namespace of project.labelNamespaces) groupings.push(`ns:${namespace}`);
  return groupings;
}

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

  // Held and other statuses are exceptions, so their columns appear only when
  // something is in them. Done is a column only on request; otherwise it is
  // each lane's progress.
  const columns = WORK_STATES.filter((state) => {
    if (state === "held") return counts.held > 0;
    if (state === "other") return counts.other > 0;
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
 * Which lanes an item belongs to. Label groupings can return several: an issue
 * carrying two labels genuinely belongs to both lanes.
 */
function slotsFor(item: WorkItem, grouping: BoardGrouping, project: ProjectModel): readonly LaneSlot[] {
  if (grouping === "none") {
    return [{ key: "all", label: "All work", headerId: null, context: null, order: "" }];
  }
  if (grouping === "parent" || grouping === "root") {
    const parent = item.parentId === null ? undefined : project.byId.get(item.parentId);
    if (parent === undefined) return [catchAll("No parent")];
    const root = outermost(parent, project);
    const lane = grouping === "parent" ? parent : root;
    return [
      {
        key: lane.id,
        label: lane.title,
        headerId: lane.id,
        context: grouping === "parent" && root.id !== parent.id ? root.id : null,
        order: lane.id,
      },
    ];
  }
  const labels = [...new Set(item.labels)].filter((label) => {
    if (grouping === "labels") return !project.commonLabels.has(label);
    return labelNamespace(label) === grouping.slice("ns:".length);
  });
  if (labels.length === 0) return [catchAll(grouping === "labels" ? "No label" : `No ${grouping.slice(3)}: label`)];
  return labels.map((label) => ({
    key: label,
    label: grouping === "labels" ? label : label.slice(grouping.length - 2),
    headerId: null,
    context: null,
    order: label,
  }));
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
