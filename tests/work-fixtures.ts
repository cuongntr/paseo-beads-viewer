import { buildProject, type ProjectInput } from "../client/project";
import type { BoardIssue } from "../shared/beads";

/** Builders for the project and board model tests. */
export function issue(overrides: Partial<BoardIssue> & { id: string }): BoardIssue {
  return {
    title: `title ${overrides.id}`,
    status: "open",
    priority: 1,
    labels: [],
    blockedBy: [],
    unblocksCount: 0,
    parentId: null,
    childCount: 0,
    type: "task",
    assignee: null,
    ...overrides,
  };
}

export function project(issues: readonly BoardIssue[], extra: Partial<ProjectInput> = {}) {
  return buildProject({
    graphAvailable: true,
    issues,
    truncated: false,
    recommendations: [],
    tracks: [],
    ...extra,
  });
}

/**
 * Shaped after the real project the redesign was measured on: one feature
 * epic, work packages under it, tasks under those, and one closed task every
 * other chain started from.
 */
export const plannedProject: readonly BoardIssue[] = [
  issue({ id: "p", title: "FEAT-001", type: "epic" }),
  issue({ id: "p.1", title: "WP-001", type: "epic", parentId: "p" }),
  issue({ id: "p.2", title: "WP-002", type: "epic", parentId: "p" }),
  issue({ id: "p.10", title: "WP-010", type: "epic", parentId: "p" }),
  issue({ id: "p.1.1", status: "closed", parentId: "p.1" }),
  issue({ id: "p.1.2", parentId: "p.1", labels: ["human-approval"] }),
  issue({ id: "p.2.1", parentId: "p.2" }),
  issue({ id: "p.2.2", parentId: "p.2", blockedBy: ["p.2.1"] }),
  issue({ id: "p.2.3", parentId: "p.2", blockedBy: ["p.2.2"] }),
  issue({ id: "p.10.1", parentId: "p.10", status: "in_progress", assignee: "ada" }),
];

