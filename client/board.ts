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

/**
 * What the board is narrowed to. Choices of one kind widen, choices of
 * different kinds narrow: any chosen parent's subtree, and carrying any chosen
 * label. That is how GitHub Projects and Linear combine filters, and it keeps
 * "WP-2 or WP-3, only stack:be" expressible without a query language. An empty
 * list places no condition.
 */
export interface BoardFilter {
  readonly parents: readonly string[];
  readonly labels: readonly string[];
}

export const ALL_WORK: BoardFilter = { parents: [], labels: [] };

export type BoardFilterKind = "parent" | "label";

export interface BoardFilterOption {
  readonly kind: BoardFilterKind;
  /** The parent's issue id, or the label as written. */
  readonly value: string;
  readonly label: string;
  /** Unfinished work the option matches on its own. */
  readonly live: number;
  /** Nesting depth for parents: 0 for a top-level issue. */
  readonly depth: number;
  /** For a parent, its top-level issue's title, so a search for an epic finds its packages. */
  readonly context: string | null;
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
  /** The filter applied, without choices that no longer match anything. */
  readonly filter: BoardFilter;
  /** Columns to render, in {@link WORK_STATES} order. */
  readonly columns: readonly BoardColumn[];
  /** Work per state under the filter. */
  readonly counts: StateCounts;
  readonly showDone: boolean;
}

export function isFiltered(filter: BoardFilter): boolean {
  return filter.parents.length > 0 || filter.labels.length > 0;
}

/** Adds the option to the filter when absent, removes it when present. */
export function toggleFilter(filter: BoardFilter, kind: BoardFilterKind, value: string): BoardFilter {
  const key = kind === "parent" ? "parents" : "labels";
  const current = filter[key];
  const next = current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value];
  return { ...filter, [key]: next };
}

/**
 * Filters this project's data supports: every parent that still has open
 * work, nested under its top-level issue in plan order, then the project's own
 * labels, most used first. Nothing here comes from a fixed list.
 */
export function boardFilters(project: ProjectModel): readonly BoardFilterOption[] {
  const options: BoardFilterOption[] = [];
  for (const root of project.roots) {
    if (root.id === null || root.settled) continue;
    options.push(parentOption(root.id, root.title, root.total - root.done, 0, null));
    for (const pkg of root.packages) {
      if (pkg.id === null || pkg.id === root.id || pkg.settled) continue;
      options.push(parentOption(pkg.id, pkg.title, pkg.total - pkg.done, 1, root.title));
    }
  }
  for (const stat of project.labels) {
    options.push({ kind: "label", value: stat.label, label: stat.label, live: stat.live, depth: 0, context: null });
  }
  return options;
}

function parentOption(id: string, title: string, live: number, depth: number, context: string | null): BoardFilterOption {
  return { kind: "parent", value: id, label: title, live, depth, context };
}

/**
 * Options whose id, title, label or top-level title contain every word of the
 * query, case-insensitively. An empty query matches everything.
 */
export function searchFilters(options: readonly BoardFilterOption[], query: string): readonly BoardFilterOption[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return options;
  return options.filter((option) => {
    const haystack = [option.value, option.label, option.context ?? ""].join(" ").toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export function buildBoard(project: ProjectModel, filter: BoardFilter, showDone: boolean): BoardModel {
  // Choices from an earlier read may be gone from this one; they stop applying.
  const options = boardFilters(project);
  const known = (kind: BoardFilterKind) => (value: string) =>
    options.some((option) => option.kind === kind && option.value === value);
  const active: BoardFilter = {
    parents: filter.parents.filter(known("parent")),
    labels: filter.labels.filter(known("label")),
  };
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
  const parentOk = filter.parents.length === 0 || filter.parents.some((id) => hasAncestor(item, id, project));
  const labelOk = filter.labels.length === 0 || filter.labels.some((label) => item.labels.includes(label));
  return parentOk && labelOk;
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
