import { describe, expect, it } from "vitest";
import { groupRelations } from "../client/relations";

const ref = (id: string, relation: string, status = "open") => ({ id, title: `title ${id}`, status, relation });

describe("relation groups", () => {
  it("splits an epic's children from the work it blocks", () => {
    // Shaped after `br show` on an epic: every dependent was parent-child, yet
    // the old detail line called all of them "blocks".
    const groups = groupRelations({
      parent: null,
      dependencies: [],
      dependents: [ref("e.2", "parent-child", "closed"), ref("e.1", "parent-child"), ref("x", "blocks")],
    });
    expect(groups.map((group) => [group.key, group.refs.map((entry) => entry.id)])).toEqual([
      ["blocks", ["x"]],
      ["children", ["e.1", "e.2"]],
    ]);
  });

  it("reads a task's parent and blockers from its dependencies, open ones first", () => {
    const groups = groupRelations({
      parent: "p",
      dependencies: [ref("b.2", "blocks", "closed"), ref("p", "parent-child"), ref("b.10", "blocks")],
      dependents: [ref("n", "related")],
    });
    expect(groups.map((group) => [group.key, group.refs.map((entry) => entry.id)])).toEqual([
      ["parent", ["p"]],
      ["blockedBy", ["b.10", "b.2"]],
      ["related", ["n"]],
    ]);
  });

  it("still names a parent the dependency list left out", () => {
    const groups = groupRelations({ parent: "p", dependencies: [], dependents: [] });
    expect(groups).toEqual([{ key: "parent", title: "Parent", refs: [{ id: "p", title: null, status: null, relation: "parent-child" }] }]);
  });
});
