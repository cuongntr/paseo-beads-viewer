/**
 * An issue's relations, grouped by what they mean. `br show` lists parent and
 * blocker links together in `dependencies`, and children and blocked issues
 * together in `dependents`, each tagged with its `dependency_type`. Printing
 * the two lists as "depends on" and "blocks" called an epic's children the
 * work it blocks, so they are split by type here. Pure for Vitest.
 */
import { isClosedStatus, type IssueDetail } from "../shared/beads";

type Ref = IssueDetail["dependencies"][number];

export type RelationGroupKey = "parent" | "blockedBy" | "blocks" | "children" | "related";

export interface RelationGroup {
  readonly key: RelationGroupKey;
  readonly title: string;
  /** Open issues first, then by id, so what still matters leads. */
  readonly refs: readonly Ref[];
}

const TITLES: Readonly<Record<RelationGroupKey, string>> = {
  parent: "Parent",
  blockedBy: "Blocked by",
  blocks: "Blocks",
  children: "Children",
  related: "Related",
};

const ORDER: readonly RelationGroupKey[] = ["parent", "blockedBy", "blocks", "children", "related"];

export function groupRelations(issue: Pick<IssueDetail, "parent" | "dependencies" | "dependents">): readonly RelationGroup[] {
  const groups: Record<RelationGroupKey, Ref[]> = { parent: [], blockedBy: [], blocks: [], children: [], related: [] };
  const add = (key: RelationGroupKey, ref: Ref) => {
    if (!groups[key].some((existing) => existing.id === ref.id)) groups[key].push(ref);
  };
  for (const ref of issue.dependencies) {
    const type = normalize(ref.relation);
    if (type === "parent-child") add("parent", ref);
    else if (type === "blocks") add("blockedBy", ref);
    else add("related", ref);
  }
  for (const ref of issue.dependents) {
    const type = normalize(ref.relation);
    if (type === "parent-child") add("children", ref);
    else if (type === "blocks") add("blocks", ref);
    else add("related", ref);
  }
  // A parent id with no matching dependency row still names the parent.
  if (issue.parent !== null && groups.parent.length === 0) {
    groups.parent.push({ id: issue.parent, title: null, status: null, relation: "parent-child" });
  }
  return ORDER.filter((key) => groups[key].length > 0).map((key) => ({
    key,
    title: TITLES[key],
    refs: [...groups[key]].sort(openFirst),
  }));
}

function normalize(relation: string | null): string {
  return (relation ?? "").trim().toLowerCase().replace(/_/g, "-");
}

function openFirst(left: Ref, right: Ref): number {
  const leftClosed = left.status !== null && isClosedStatus(left.status) ? 1 : 0;
  const rightClosed = right.status !== null && isClosedStatus(right.status) ? 1 : 0;
  if (leftClosed !== rightClosed) return leftClosed - rightClosed;
  return left.id.localeCompare(right.id, undefined, { numeric: true });
}
