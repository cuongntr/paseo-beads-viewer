/**
 * Board layout for the read-only project board: a plain board, one column per
 * derived {@link WorkState}, each column one continuous list.
 *
 * Columns are the derived state, not the raw status: on a real project every
 * live issue had status `open`, so a status board was one column of 27 cards
 * that could not tell ready work from work waiting on three others.
 *
 * Grouping is a filter, not swimlanes. A lanes × columns matrix left most cells
 * empty, repeated a card in every label lane it carried, and made the reader
 * scan two ways at once; the usual boards (GitHub Projects, Linear, Jira) keep
 * swimlanes off by default for the same reasons. Each card names its parent
 * instead, and choosing a parent or a label narrows every column at once.
 *
 * Only work is carded; a container is a filter option and a card's context.
 * Everything is pure for the Vitest node environment.
 */
import { countStates, WORK_STATES, type ProjectModel, type StateCounts, type WorkItem, type WorkState } from "./project";

/** What the board is narrowed to: everything, one parent's subtree, or one label. */
export type BoardFilter =
  | { readonly kind: "all" }
  | { readonly kind: "parent"; readonly id: string }
  | { readonly kind: "label"; readonly label: string };

export const ALL_WORK: BoardFilter = { kind: "all" };

export interface BoardFilterOption {
  readonly key: string;
  readonly filter: BoardFilter;
  readonly label: string;
  /** Unfinished work the option would show. */
  readonly live: number;
  /** Nesting depth for parents: 0 for a top-level issue. */
  readonly depth: number;
}

/** Cards rendered per column before the rest is reported as "+N more". */
export const BOARD_COLUMN_CARD_LIMIT = 60;

export interface BoardColumn {
  readonly state: WorkState;
  readonly cards: readonly WorkItem[];
  readonly total: number;
  readonly hidden: number;
}

export interface BoardModel {
  /** The filter applied, which falls back to all work when the chosen one no longer matches. */
  readonly filter: BoardFilter;
  /** Columns to render, in {@link WORK_STATES} order. */
  readonly columns: readonly BoardColumn[];
  /** Work per state under the filter. */
  readonly counts: StateCounts;
  readonly showDone: boolean;
}

export function filterKey(filter: BoardFilter): string {
  switch (filter.kind) {
    case "all":
      return "all";
    case "parent":
      return `parent:${filter.id}`;
    case "label":
      return `label:${filter.label}`;
  }
}

/**
 * Filters this project's data supports: every parent that still has open
 * work, nested under its top-level issue in plan order, then the project's own
 * labels, most used first. Nothing here comes from a fixed list.
 */
export function boardFilters(project: ProjectModel): readonly BoardFilterOption[] {
  const options: BoardFilterOption[] = [
    {
      key: "all",
      filter: ALL_WORK,
      label: "All work",
      live: project.work.length - project.counts.done,
      depth: 0,
    },
  ];
  for (const root of project.roots) {
    if (root.id === null || root.settled) continue;
    options.push(parentOption(root.id, root.title, root.total - root.done, 0));
    for (const pkg of root.packages) {
      if (pkg.id === null || pkg.id === root.id || pkg.settled) continue;
      options.push(parentOption(pkg.id, pkg.title, pkg.total - pkg.done, 1));
    }
  }
  for (const stat of project.labels) {
    const filter: BoardFilter = { kind: "label", label: stat.label };
    options.push({ key: filterKey(filter), filter, label: stat.label, live: stat.live, depth: 0 });
  }
  return options;
}

function parentOption(id: string, title: string, live: number, depth: number): BoardFilterOption {
  const filter: BoardFilter = { kind: "parent", id };
  return { key: filterKey(filter), filter, label: title, live, depth };
}

export function buildBoard(project: ProjectModel, filter: BoardFilter, showDone: boolean): BoardModel {
  // A filter chosen on an earlier read may have nothing left to match.
  const known = boardFilters(project).some((option) => option.key === filterKey(filter));
  const active = known ? filter : ALL_WORK;
  const items = project.work.filter((item) => matches(item, active, project));
  const counts = countStates(items);

  // Held and other statuses are exceptions, so their columns appear only when
  // something is in them. Done is a column only on request.
  const states = WORK_STATES.filter((state) => {
    if (state === "held") return counts.held > 0;
    if (state === "other") return counts.other > 0;
    if (state === "done") return showDone;
    return true;
  });

  const columns = states.map((state) => {
    // Work arrives in project order, which is already the in-column order.
    const inState = items.filter((item) => item.state === state);
    return {
      state,
      cards: inState.slice(0, BOARD_COLUMN_CARD_LIMIT),
      total: inState.length,
      hidden: Math.max(0, inState.length - BOARD_COLUMN_CARD_LIMIT),
    };
  });

  return { filter: active, columns, counts, showDone };
}

function matches(item: WorkItem, filter: BoardFilter, project: ProjectModel): boolean {
  switch (filter.kind) {
    case "all":
      return true;
    case "label":
      return item.labels.includes(filter.label);
    case "parent":
      return hasAncestor(item, filter.id, project);
  }
}

/** True when `id` is on the item's parent chain; a cyclic chain ends the walk. */
function hasAncestor(item: WorkItem, id: string, project: ProjectModel): boolean {
  const visited = new Set<string>([item.id]);
  for (let parent = item.parentId; parent !== null && !visited.has(parent); ) {
    if (parent === id) return true;
    visited.add(parent);
    parent = project.byId.get(parent)?.parentId ?? null;
  }
  return false;
}

/** A card's context line: its direct parent's title, or its id when the parent is not loaded. */
export function parentLabel(item: WorkItem, project: ProjectModel): string | null {
  if (item.parentId === null) return null;
  return project.byId.get(item.parentId)?.title ?? item.parentId;
}
