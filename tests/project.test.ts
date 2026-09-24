import { describe, expect, it } from "vitest";
import { buildProject, compareIds, labelNamespace, workIn, workStateOf } from "../client/project";
import type { Recommendation, Track } from "../shared/beads";
import { issue, plannedProject, project } from "./work-fixtures";

function recommendation(overrides: Partial<Recommendation> & { id: string }): Recommendation {
  return {
    title: `title ${overrides.id}`,
    status: "open",
    type: null,
    priority: null,
    assignee: null,
    labels: [],
    score: null,
    action: null,
    reasons: [],
    blockedBy: [],
    unblocks: [],
    claimable: true,
    ...overrides,
  };
}

describe("work state", () => {
  it("lets an explicit status win and splits open work by its open blockers", () => {
    expect(workStateOf("closed", 0)).toBe("done");
    expect(workStateOf("in_progress", 2)).toBe("active");
    expect(workStateOf("blocked", 0)).toBe("held");
    expect(workStateOf("deferred", 0)).toBe("held");
    expect(workStateOf("open", 0)).toBe("ready");
    expect(workStateOf("open", 1)).toBe("waiting");
  });

  it("maps only Beads' built-in statuses and gives a custom one its own state", () => {
    expect(workStateOf("hooked", 0)).toBe("active");
    expect(workStateOf("draft", 0)).toBe("held");
    expect(workStateOf("pinned", 0)).toBe("held");
    // A project's own status is not guessed to be open, ready, or done.
    expect(workStateOf("awaiting_review", 0)).toBe("other");
    expect(workStateOf("done", 0)).toBe("other");
    expect(workStateOf("review", 1)).toBe("other");
  });

  it("drops tombstones, which are deleted issues rather than finished work", () => {
    const model = project([issue({ id: "a" }), issue({ id: "gone", status: "tombstone" })]);
    expect(model.work.map((item) => item.id)).toEqual(["a"]);
  });
});

describe("work and containers", () => {
  it("counts only work, so epics never inflate ready", () => {
    const model = project(plannedProject);
    // bv's own actionable count on this shape includes all four epics.
    expect(model.work.map((item) => item.id).sort(compareIds)).toEqual([
      "p.1.1",
      "p.1.2",
      "p.2.1",
      "p.2.2",
      "p.2.3",
      "p.10.1",
    ]);
    expect(model.counts).toEqual({ active: 1, ready: 2, waiting: 2, held: 0, other: 0, done: 1 });
    expect(model.byId.get("p.1")?.container).toBe(true);
  });

  it("holds work under a blocked container, as bv does", () => {
    // Shaped after the reviewer's bv v0.25 run: bv's plan listed only x, and
    // counted both the epic and its child as dependency-blocked.
    const model = project([
      issue({ id: "x" }),
      issue({ id: "e", type: "epic", blockedBy: ["x"] }),
      issue({ id: "e.1", parentId: "e" }),
    ]);
    const child = model.byId.get("e.1");
    expect(child?.state).toBe("waiting");
    expect(child?.inheritedBlockedBy).toEqual(["x"]);
    expect(child?.heldVia).toBe("e");
    expect(workIn(model, "ready").map((item) => item.id)).toEqual(["x"]);
  });

  it("does not inherit a container's wait on its own subtree", () => {
    // An epic that waits on its own tasks must not hold those tasks back.
    const model = project([
      issue({ id: "e", type: "epic", blockedBy: ["e.1", "e.2"] }),
      issue({ id: "e.1", parentId: "e" }),
      issue({ id: "e.2", parentId: "e" }),
    ]);
    expect(model.byId.get("e.1")?.state).toBe("ready");
    expect(model.byId.get("e.2")?.inheritedBlockedBy).toEqual([]);
  });

  it("ignores blockers of a finished container", () => {
    const model = project([
      issue({ id: "x" }),
      issue({ id: "e", type: "epic", status: "closed", blockedBy: ["x"] }),
      issue({ id: "e.1", parentId: "e" }),
    ]);
    expect(model.byId.get("e.1")?.state).toBe("ready");
  });

  it("keeps an epic a container when truncation dropped its closed children", () => {
    const model = project([issue({ id: "e", type: "epic", childCount: 3 })], { truncated: true });
    expect(model.work).toEqual([]);
    expect(model.byId.get("e")?.container).toBe(true);
  });

  it("treats an epic with nothing under it as work, so it is not lost", () => {
    const model = project([issue({ id: "e", type: "epic" })]);
    expect(model.work.map((item) => item.id)).toEqual(["e"]);
  });

  it("counts labels as written, without giving any of them a meaning", () => {
    const model = project([
      issue({ id: "a", labels: ["human-approval", "stack:ops", "everywhere"] }),
      issue({ id: "b", labels: ["stack:ops", "everywhere"], blockedBy: ["a"] }),
      issue({ id: "c", labels: ["stack:be", "everywhere"] }),
      issue({ id: "d", labels: ["human-approval"], status: "closed" }),
    ]);
    // A label on every open item distinguishes nothing, so it is set apart.
    expect([...model.commonLabels]).toEqual(["everywhere"]);
    expect(model.labels).toEqual([
      { label: "stack:ops", live: 2, ready: 1 },
      { label: "human-approval", live: 1, ready: 1 },
      { label: "stack:be", live: 1, ready: 1 },
    ]);
    expect(model.labelNamespaces).toEqual(["stack"]);
  });

  it("reads a namespace only from a prefix:value label", () => {
    expect(labelNamespace("stack:ops")).toBe("stack");
    expect(labelNamespace("human-approval")).toBeNull();
    expect(labelNamespace(":x")).toBeNull();
    expect(labelNamespace("x:")).toBeNull();
  });

  it("reports whether type varies across live work", () => {
    expect(project([issue({ id: "a" }), issue({ id: "b" })]).typeVaries).toBe(false);
    expect(project([issue({ id: "a" }), issue({ id: "b", type: "bug" })]).typeVaries).toBe(true);
  });

  it("reports whether priority varies across live work", () => {
    expect(project(plannedProject).priorityVaries).toBe(false);
    expect(project([issue({ id: "a", priority: 0 }), issue({ id: "b", priority: 2 })]).priorityVaries).toBe(true);
    // A finished issue's priority no longer distinguishes anything.
    expect(
      project([issue({ id: "a", priority: 0, status: "closed" }), issue({ id: "b", priority: 2 })]).priorityVaries,
    ).toBe(false);
  });
});

describe("groups", () => {
  it("groups work by its direct parent under the outermost epic, in id order", () => {
    const model = project(plannedProject);
    expect(model.roots).toHaveLength(1);
    const root = model.roots[0];
    expect(root?.id).toBe("p");
    expect(root?.done).toBe(1);
    expect(root?.total).toBe(6);
    // p.10 after p.2: ids compare numerically.
    expect(root?.packages.map((pkg) => [pkg.id, pkg.done, pkg.total])).toEqual([
      ["p.1", 1, 2],
      ["p.2", 0, 3],
      ["p.10", 0, 1],
    ]);
  });

  it("gives an epic that holds its tasks directly a single package of itself", () => {
    const model = project([issue({ id: "e", type: "epic" }), issue({ id: "e.1", parentId: "e" })]);
    expect(model.roots[0]?.packages.map((pkg) => pkg.id)).toEqual(["e"]);
  });

  it("puts parentless work in a catch-all that sorts last", () => {
    const model = project([
      issue({ id: "z-loose" }),
      issue({ id: "a", type: "epic" }),
      issue({ id: "a.1", parentId: "a" }),
    ]);
    expect(model.roots.map((root) => root.id)).toEqual(["a", null]);
    expect(model.roots[1]?.packages[0]?.items.map((item) => item.id)).toEqual(["z-loose"]);
  });

  it("marks a group settled only when all of its work is done", () => {
    const model = project([
      issue({ id: "e", type: "epic" }),
      issue({ id: "e.1", parentId: "e", status: "closed" }),
      issue({ id: "f", type: "epic" }),
      issue({ id: "f.1", parentId: "f", status: "closed" }),
      issue({ id: "f.2", parentId: "f" }),
    ]);
    expect(model.roots.map((root) => [root.id, root.settled])).toEqual([
      ["e", true],
      ["f", false],
    ]);
  });

  it("terminates on a cyclic parent chain instead of hanging", () => {
    const model = project([
      issue({ id: "a", parentId: "b" }),
      issue({ id: "b", parentId: "a" }),
      issue({ id: "c", parentId: "a" }),
    ]);
    expect(model.work.map((item) => item.id)).toEqual(["c"]);
    expect(model.roots).toHaveLength(1);
  });
});

describe("critical chain", () => {
  it("is the longest run of open dependencies, first step first, finished work excluded", () => {
    const model = project(plannedProject);
    expect(model.chain.map((item) => item.id)).toEqual(["p.2.1", "p.2.2", "p.2.3"]);
    expect(model.byId.get("p.2.1")?.critical).toBe(true);
    expect(model.byId.get("p.1.2")?.critical).toBe(false);
  });

  it("is empty when nothing depends on anything", () => {
    expect(project([issue({ id: "a" }), issue({ id: "b" })]).chain).toEqual([]);
  });

  it("breaks ties by id so the chain is stable across reads", () => {
    const issues = [
      issue({ id: "x.2" }),
      issue({ id: "x.1" }),
      issue({ id: "y", blockedBy: ["x.2", "x.1"] }),
    ];
    expect(project(issues).chain.map((item) => item.id)).toEqual(["x.1", "y"]);
    expect(project([...issues].reverse()).chain.map((item) => item.id)).toEqual(["x.1", "y"]);
  });

  it("claims no chain when open work forms a cycle, whatever the input order", () => {
    const issues = [
      issue({ id: "a", blockedBy: ["b"] }),
      issue({ id: "b", blockedBy: ["a"] }),
      issue({ id: "c", blockedBy: ["b"] }),
      issue({ id: "d" }),
      issue({ id: "e", blockedBy: ["d"] }),
    ];
    for (const ordered of [issues, [...issues].reverse()]) {
      const model = project(ordered);
      expect(model.chain).toEqual([]);
      expect(model.chainCycle).toBe(true);
    }
    expect(project([issue({ id: "a", blockedBy: ["a"] })]).chainCycle).toBe(true);
  });

  it("does not treat a cycle through finished work as a cycle", () => {
    const model = project([
      issue({ id: "a", blockedBy: ["b"] }),
      issue({ id: "b", status: "closed", blockedBy: ["a"] }),
    ]);
    expect(model.chainCycle).toBe(false);
  });

  it("follows blockers inherited from a blocked package and never steps through a container", () => {
    const model = project([
      issue({ id: "x" }),
      issue({ id: "e", type: "epic", blockedBy: ["x"] }),
      issue({ id: "e.1", parentId: "e" }),
      issue({ id: "e.2", parentId: "e", blockedBy: ["e.1"] }),
    ]);
    expect(model.chain.map((item) => item.id)).toEqual(["x", "e.1", "e.2"]);
  });

  it("handles a very long chain without overflowing the stack", () => {
    const issues = Array.from({ length: 5000 }, (_, index) =>
      issue({ id: `n-${index}`, blockedBy: index === 0 ? [] : [`n-${index - 1}`] }),
    );
    expect(project(issues).chain).toHaveLength(5000);
  });
});

describe("ordering", () => {
  it("orders by priority, then critical chain, then triage score, then unblocks, then id", () => {
    const model = project(
      [
        issue({ id: "low", priority: 3 }),
        issue({ id: "scored" }),
        issue({ id: "unblocker", unblocksCount: 2 }),
        issue({ id: "plain" }),
        issue({ id: "head" }),
        issue({ id: "tail", blockedBy: ["head"] }),
      ],
      { recommendations: [recommendation({ id: "scored", score: 0.4 })] },
    );
    expect(workIn(model, "ready").map((item) => item.id)).toEqual(["head", "scored", "unblocker", "plain", "low"]);
  });
});

describe("enrichment", () => {
  it("takes score and action from triage and membership from plan tracks", () => {
    const tracks: Track[] = [
      { id: "track-A", reason: null, items: [{ id: "a", title: "a", status: "open", priority: 1, unblocks: [] }], totalItems: 1 },
    ];
    const model = project([issue({ id: "a" })], {
      recommendations: [recommendation({ id: "a", score: 0.5, action: "Start here", assignee: "ada" })],
      tracks,
    });
    const item = model.byId.get("a");
    expect(item?.score).toBe(0.5);
    expect(item?.action).toBe("Start here");
    expect(item?.assignee).toBe("ada");
    expect(item?.trackIds).toEqual(["track-A"]);
  });

  it("never invents work from an enrichment source the graph does not know", () => {
    const model = project([issue({ id: "a" })], { recommendations: [recommendation({ id: "ghost" })] });
    expect([...model.byId.keys()]).toEqual(["a"]);
  });
});

describe("working-set fallback", () => {
  it("builds from triage and plan when the graph is unavailable, and says so", () => {
    const model = buildProject({
      graphAvailable: false,
      issues: [issue({ id: "ignored" })],
      truncated: true,
      recommendations: [recommendation({ id: "r", blockedBy: ["t"] })],
      tracks: [{ id: "track-A", reason: null, items: [{ id: "t", title: "t", status: "open", priority: 1, unblocks: ["r"] }], totalItems: 1 }],
    });
    expect(model.complete).toBe(false);
    expect(model.truncated).toBe(false);
    expect(model.byId.has("ignored")).toBe(false);
    expect(model.byId.get("r")?.state).toBe("waiting");
    expect(model.byId.get("t")?.state).toBe("ready");
  });
});

describe("label families", () => {
  it("offers no family whose only label sits on every open item", () => {
    const model = project([
      issue({ id: "a", labels: ["feature:one", "stack:be"] }),
      issue({ id: "b", labels: ["feature:one", "stack:fe"] }),
    ]);
    expect(model.labelNamespaces).toEqual(["stack"]);
  });
});
