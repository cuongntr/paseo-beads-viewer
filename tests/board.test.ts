import { describe, expect, it } from "vitest";
import { BOARD_LANE_CARD_LIMIT, buildBoard, laneLabel, laneRank, type BoardInput } from "../client/board";
import type { BoardIssue, Recommendation, Track } from "../shared/beads";

function issue(overrides: Partial<BoardIssue> & { id: string }): BoardIssue {
  return {
    title: `title ${overrides.id}`,
    status: "open",
    priority: null,
    labels: [],
    blockedByCount: 0,
    unblocksCount: 0,
    parentId: null,
    type: "task",
    assignee: null,
    ...overrides,
  };
}

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

function track(id: string, items: readonly Track["items"][number][]): Track {
  return { id, reason: null, items: [...items] };
}

function item(overrides: Partial<Track["items"][number]> & { id: string }): Track["items"][number] {
  return {
    title: `title ${overrides.id}`,
    status: "open",
    priority: null,
    unblocks: [],
    ...overrides,
  };
}

/**
 * The graph-backed board. Defaults to the status axis showing everything, so
 * each test states the axis and filter it actually exercises.
 */
function board(input: Partial<BoardInput> & { issues: readonly BoardIssue[] }) {
  return buildBoard({
    graphAvailable: true,
    typed: true,
    total: input.issues.length,
    truncated: false,
    recommendations: [],
    tracks: [],
    axis: "status",
    hideClosed: false,
    ...input,
  });
}

/** The fallback board: no graph, so triage and plan are the only sources. */
function workingSet(recommendations: readonly Recommendation[], tracks: readonly Track[]) {
  return buildBoard({
    graphAvailable: false,
    issues: [],
    typed: false,
    total: 0,
    truncated: false,
    recommendations,
    tracks,
    axis: "status",
    hideClosed: false,
  });
}

function idsIn(groups: ReturnType<typeof buildBoard>["groups"], key: string): readonly string[] {
  return groups.find((group) => group.key === key)?.cards.map((card) => card.id) ?? [];
}

describe("whole-project derivation", () => {
  it("lays out every issue the graph reported, whatever its status", () => {
    const model = board({
      issues: [
        issue({ id: "a-1", status: "open" }),
        issue({ id: "a-2", status: "in_progress" }),
        issue({ id: "a-3", status: "closed" }),
        issue({ id: "a-4", status: "blocked" }),
      ],
    });
    expect(model.complete).toBe(true);
    expect(model.surfaced).toBe(4);
    expect(model.total).toBe(4);
    expect(model.groups.map((group) => group.key)).toEqual([
      "in_progress",
      "blocked",
      "open",
      "closed",
    ]);
    expect(idsIn(model.groups, "closed")).toEqual(["a-3"]);
    expect(idsIn(model.groups, "in_progress")).toEqual(["a-2"]);
  });

  it("carries the graph's dependency counts onto the cards", () => {
    const model = board({
      issues: [issue({ id: "a-1", blockedByCount: 2, unblocksCount: 5, labels: ["core"] })],
    });
    const card = model.groups[0]?.cards[0];
    expect(card?.blockedByCount).toBe(2);
    expect(card?.unblocksCount).toBe(5);
    expect(card?.labels).toEqual(["core"]);
  });

  it("enriches graph issues with triage metadata and track membership", () => {
    const model = board({
      issues: [issue({ id: "a-1", status: "in_progress", priority: 1 })],
      recommendations: [recommendation({ id: "a-1", assignee: "ada", type: "task" })],
      tracks: [track("track-1", [item({ id: "a-1" })]), track("track-2", [item({ id: "a-1" })])],
    });
    const card = model.groups[0]?.cards[0];
    expect(card?.assignee).toBe("ada");
    expect(card?.type).toBe("task");
    expect(card?.trackIds).toEqual(["track-1", "track-2"]);
    expect(card?.fromRecommendations).toBe(true);
    // Enrichment must not override what the graph says about the issue itself.
    expect(card?.status).toBe("in_progress");
    expect(card?.priority).toBe(1);
  });

  it("never invents a card from an enrichment source the graph does not know", () => {
    const model = board({
      issues: [issue({ id: "a-1" })],
      recommendations: [recommendation({ id: "ghost-9" })],
      tracks: [track("track-1", [item({ id: "ghost-8" })])],
    });
    expect(model.surfaced).toBe(1);
    expect(model.groups.flatMap((group) => group.cards.map((card) => card.id))).toEqual(["a-1"]);
  });

  it("keeps the reported total and truncation flag when the payload was capped", () => {
    const model = board({ issues: [issue({ id: "a-1" })], total: 9000, truncated: true });
    expect(model.total).toBe(9000);
    expect(model.truncated).toBe(true);
  });

  it("ignores blank ids rather than creating a phantom card", () => {
    const model = board({ issues: [issue({ id: "" })] });
    expect(model.surfaced).toBe(0);
    expect(model.groups).toEqual([]);
  });

  it("separates a healthy empty project from a failed graph read", () => {
    // Both are empty, but only one of them is the whole project.
    const healthyEmpty = board({ issues: [] });
    expect(healthyEmpty.complete).toBe(true);
    expect(healthyEmpty.groups).toEqual([]);

    const failedGraph = workingSet([], []);
    expect(failedGraph.complete).toBe(false);
  });
});

describe("epic axis", () => {
  const tree = [
    issue({ id: "e-1", type: "epic", title: "Checkout" }),
    issue({ id: "e-1.1", type: "task", parentId: "e-1" }),
    issue({ id: "e-1.2", type: "task", parentId: "e-1", status: "closed" }),
    // A task nested under a sub-epic still belongs to the epic a reader thinks in.
    issue({ id: "e-1.3", type: "epic", parentId: "e-1" }),
    issue({ id: "e-1.3.1", type: "task", parentId: "e-1.3" }),
    issue({ id: "b-9", type: "bug" }),
  ];

  it("groups tasks under their outermost containing epic", () => {
    const model = board({ issues: tree, axis: "epic" });
    const epic = model.groups.find((group) => group.key === "e-1");
    expect(epic?.label).toBe("Checkout");
    expect(epic?.headerId).toBe("e-1");
    // Every descendant lands here, including the one under the sub-epic.
    expect(epic?.cards.map((card) => card.id).sort()).toEqual(["e-1.1", "e-1.2", "e-1.3", "e-1.3.1"]);
    // The epic heading the group is not also listed inside itself.
    expect(epic?.cards.some((card) => card.id === "e-1")).toBe(false);
  });

  it("puts a parentless bug in its own group rather than under an epic", () => {
    const model = board({ issues: tree, axis: "epic" });
    const loose = model.groups.find((group) => group.label === "Loose bugs");
    expect(loose?.cards.map((card) => card.id)).toEqual(["b-9"]);
    expect(loose?.headerId).toBeNull();
  });

  it("reports progress from the whole group, not from what the filter shows", () => {
    const model = board({ issues: tree, axis: "epic", hideClosed: true });
    const epic = model.groups.find((group) => group.key === "e-1");
    // e-1.2 is closed: hidden from the cards, still counted in the progress.
    expect(epic?.cards.map((card) => card.id)).not.toContain("e-1.2");
    expect(epic?.done).toBe(1);
    expect(epic?.size).toBe(5);
    expect(epic?.settled).toBe(false);
  });

  it("marks an epic settled once every issue under it is closed", () => {
    const model = board({
      axis: "epic",
      issues: [
        issue({ id: "e-2", type: "epic", status: "closed" }),
        issue({ id: "e-2.1", type: "task", parentId: "e-2", status: "closed" }),
      ],
    });
    expect(model.groups[0]?.settled).toBe(true);
  });

  it("terminates on a cyclic parent chain instead of hanging", () => {
    const model = board({
      axis: "epic",
      issues: [
        issue({ id: "a", type: "task", parentId: "b" }),
        issue({ id: "b", type: "task", parentId: "a" }),
      ],
    });
    expect(model.surfaced).toBe(2);
    expect(model.groups).toHaveLength(1);
  });

  it("falls back to the status axis when the tracker gave no types", () => {
    const model = board({
      issues: [issue({ id: "a-1", type: null, status: "open" })],
      axis: "epic",
      typed: false,
    });
    // Grouping by epic without types would pile everything into one unnamed group.
    expect(model.axis).toBe("status");
    expect(model.groups[0]?.key).toBe("open");
  });
});

describe("feature and type axes", () => {
  it("groups by the feature label and keeps an issue in every feature it carries", () => {
    const model = board({
      axis: "feature",
      issues: [
        issue({ id: "a-1", labels: ["feature:checkout", "stack:be"] }),
        issue({ id: "a-2", labels: ["feature:checkout"] }),
        issue({ id: "a-3", labels: ["feature:checkout", "feature:search"] }),
        issue({ id: "a-4", labels: ["stack:fe"] }),
      ],
    });
    expect(idsIn(model.groups, "feature:checkout")).toEqual(["a-1", "a-2", "a-3"]);
    expect(idsIn(model.groups, "feature:search")).toEqual(["a-3"]);
    expect(model.groups.find((group) => group.label === "No feature")?.cards.map((c) => c.id)).toEqual([
      "a-4",
    ]);
    // Labels are shown without their prefix, which is noise once it is the axis.
    expect(model.groups[0]?.label).toBe("checkout");
  });

  it("orders type groups containers first, then work, then defects", () => {
    const model = board({
      axis: "type",
      issues: [
        issue({ id: "d-1", type: "bug" }),
        issue({ id: "c-1", type: "task" }),
        issue({ id: "a-1", type: "epic" }),
        issue({ id: "b-1", type: "feature" }),
        issue({ id: "e-1", type: "wildcard" }),
      ],
    });
    expect(model.groups.map((group) => group.key)).toEqual([
      "epic",
      "feature",
      "task",
      "bug",
      "wildcard",
    ]);
  });

  it("gives untyped issues their own group instead of guessing a type", () => {
    const model = board({ axis: "type", issues: [issue({ id: "a-1", type: null })] });
    expect(model.groups[0]?.label).toBe("No type");
  });
});

describe("live-only filter", () => {
  const mixed = [
    issue({ id: "a-1", status: "open" }),
    issue({ id: "a-2", status: "closed" }),
    issue({ id: "a-3", status: "closed" }),
  ];

  it("hides closed issues from the cards while the counts stay truthful", () => {
    const model = board({ axis: "type", issues: mixed, hideClosed: true });
    expect(model.groups[0]?.cards.map((card) => card.id)).toEqual(["a-1"]);
    expect(model.groups[0]?.size).toBe(3);
    expect(model.groups[0]?.done).toBe(2);
    expect(model.live).toBe(1);
    expect(model.total).toBe(3);
  });

  it("shows everything when the filter is off", () => {
    const model = board({ axis: "type", issues: mixed, hideClosed: false });
    expect(model.groups[0]?.cards).toHaveLength(3);
    expect(model.live).toBe(1);
  });
});

describe("group capping", () => {
  it("caps rendered cards per lane while the lane header keeps the true count", () => {
    const issues = Array.from({ length: BOARD_LANE_CARD_LIMIT + 7 }, (_, index) =>
      issue({ id: `a-${String(index).padStart(3, "0")}`, status: "closed" }),
    );
    const model = board({ issues });
    const group = model.groups[0];
    expect(group?.key).toBe("closed");
    expect(group?.total).toBe(BOARD_LANE_CARD_LIMIT + 7);
    expect(group?.cards).toHaveLength(BOARD_LANE_CARD_LIMIT);
    expect(group?.hidden).toBe(7);
    // `surfaced` counts issues, not rendered cards.
    expect(model.surfaced).toBe(BOARD_LANE_CARD_LIMIT + 7);
  });

  it("marks a group settled only when every issue in it is closed", () => {
    const model = board({
      issues: [
        issue({ id: "a-1", status: "open" }),
        issue({ id: "a-2", status: "done" }),
        issue({ id: "a-3", status: "awaiting_review" }),
      ],
    });
    expect(model.groups.map((group) => [group.key, group.settled])).toEqual([
      ["open", false],
      ["awaiting_review", false],
      ["done", true],
    ]);
  });
});

describe("status axis grouping and ordering", () => {
  it("orders lanes in-progress, blocked, ready/open, unknown, then closed", () => {
    const model = board({
      issues: [
        issue({ id: "closed-1", status: "closed" }),
        issue({ id: "unknown-1", status: "awaiting_review" }),
        issue({ id: "open-1", status: "open" }),
        issue({ id: "blocked-1", status: "blocked" }),
        issue({ id: "active-1", status: "in_progress" }),
      ],
    });
    expect(model.groups.map((group) => group.key)).toEqual([
      "in_progress",
      "blocked",
      "open",
      "awaiting_review",
      "closed",
    ]);
  });

  it("sorts unknown statuses alphabetically among themselves", () => {
    const model = board({
      issues: [
        issue({ id: "c", status: "zeta_state" }),
        issue({ id: "a", status: "alpha_state" }),
        issue({ id: "b", status: "mid_state" }),
        issue({ id: "d", status: "done" }),
      ],
    });
    expect(model.groups.map((group) => group.key)).toEqual([
      "alpha_state",
      "mid_state",
      "zeta_state",
      "done",
    ]);
  });

  it("preserves the raw status verbatim while labelling it readably", () => {
    const model = board({ issues: [issue({ id: "a-1", status: "IN_PROGRESS" })] });
    expect(model.groups[0]?.key).toBe("IN_PROGRESS");
    expect(model.groups[0]?.label).toBe("IN PROGRESS");
    expect(model.groups[0]?.cards[0]?.status).toBe("IN_PROGRESS");
  });

  it("keeps distinct spellings of one concept as distinct lanes but adjacent", () => {
    const model = board({
      issues: [
        issue({ id: "a", status: "in progress" }),
        issue({ id: "b", status: "in_progress" }),
        issue({ id: "c", status: "open" }),
      ],
    });
    expect(model.groups.map((group) => group.key)).toEqual(["in progress", "in_progress", "open"]);
  });

  it("folds a blank status into an unknown lane", () => {
    const model = board({ issues: [issue({ id: "a-1", status: "   " })] });
    expect(model.groups[0]?.key).toBe("unknown");
    expect(model.groups[0]?.label).toBe("unknown");
  });

  it("orders cards by priority, then title, then id", () => {
    const model = board({
      issues: [
        issue({ id: "z-9", priority: null, title: "no priority" }),
        issue({ id: "d-4", priority: 2, title: "beta" }),
        issue({ id: "c-3", priority: 0, title: "zulu" }),
        issue({ id: "b-2", priority: 2, title: "alpha" }),
        issue({ id: "a-1", priority: 2, title: "alpha" }),
      ],
    });
    expect(idsIn(model.groups, "open")).toEqual(["c-3", "a-1", "b-2", "d-4", "z-9"]);
  });

  it("is deterministic across input permutations", () => {
    const issues: readonly BoardIssue[] = [
      issue({ id: "a-1", status: "open", priority: 1 }),
      issue({ id: "b-2", status: "blocked", priority: 0 }),
      issue({ id: "c-3", status: "weird", priority: 2 }),
    ];
    const forward = board({ issues });
    const reversed = board({ issues: [...issues].reverse() });
    expect(reversed.groups.map((group) => group.key)).toEqual(forward.groups.map((group) => group.key));
    expect(reversed.groups.map((group) => group.cards.map((card) => card.id))).toEqual(
      forward.groups.map((group) => group.cards.map((card) => card.id)),
    );
  });
});

describe("working-set fallback when the graph is unavailable", () => {
  it("unions recommendations and track items and reports itself as incomplete", () => {
    const model = workingSet([recommendation({ id: "a-1" })], [track("track-1", [item({ id: "b-2" })])]);
    expect(model.complete).toBe(false);
    expect(model.surfaced).toBe(2);
    expect(model.total).toBe(2);
    expect(model.hasRecommendations).toBe(true);
    expect(model.hasTracks).toBe(true);
    expect(idsIn(model.groups, "open")).toEqual(["a-1", "b-2"]);
  });

  it("deduplicates by id and lets recommendation metadata win", () => {
    const model = workingSet(
      [
        recommendation({
          id: "a-1",
          title: "triage title",
          status: "in_progress",
          priority: 1,
          assignee: "ada",
          type: "task",
          labels: ["core"],
          blockedBy: ["x-1"],
          unblocks: ["y-1", "y-2"],
        }),
      ],
      [track("track-1", [item({ id: "a-1", title: "plan title", status: "open", priority: 3 })])],
    );
    expect(model.surfaced).toBe(1);
    const card = model.groups[0]?.cards[0];
    expect(card?.title).toBe("triage title");
    expect(card?.status).toBe("in_progress");
    expect(card?.priority).toBe(1);
    expect(card?.assignee).toBe("ada");
    expect(card?.blockedByCount).toBe(1);
    expect(card?.unblocksCount).toBe(2);
    expect(card?.trackIds).toEqual(["track-1"]);
    expect(card?.fromRecommendations).toBe(true);
  });

  it("records every track a deduplicated issue belongs to, without repeats", () => {
    const model = workingSet(
      [recommendation({ id: "a-1" })],
      [track("track-1", [item({ id: "a-1" })]), track("track-2", [item({ id: "a-1" }), item({ id: "a-1" })])],
    );
    expect(model.groups[0]?.cards[0]?.trackIds).toEqual(["track-1", "track-2"]);
  });

  it("never claims truncation for a working set", () => {
    const model = buildBoard({
      graphAvailable: false,
      issues: [],
      typed: false,
      total: 9000,
      truncated: true,
      recommendations: [recommendation({ id: "a-1" })],
      tracks: [],
      axis: "status",
      hideClosed: false,
    });
    expect(model.complete).toBe(false);
    expect(model.truncated).toBe(false);
    expect(model.total).toBe(1);
  });

  it("returns an empty, incomplete board when every source is empty", () => {
    const model = workingSet([], []);
    expect(model.groups).toEqual([]);
    expect(model.surfaced).toBe(0);
    expect(model.complete).toBe(false);
  });

  it("tolerates tracks with no items", () => {
    const model = workingSet([], [track("track-1", []), track("track-2", [])]);
    expect(model.groups).toEqual([]);
    expect(model.hasTracks).toBe(false);
  });
});

describe("group helpers", () => {
  it("ranks well-known statuses and pools unknown ones between ready and closed", () => {
    expect(laneRank("in_progress")).toBeLessThan(laneRank("blocked"));
    expect(laneRank("blocked")).toBeLessThan(laneRank("ready"));
    expect(laneRank("ready")).toBeLessThan(laneRank("mystery"));
    expect(laneRank("mystery")).toBeLessThan(laneRank("closed"));
    expect(laneRank("MYSTERY")).toBe(laneRank("other_mystery"));
  });

  it("is case-insensitive when ranking", () => {
    expect(laneRank(" In Progress ")).toBe(laneRank("in_progress"));
  });

  it("labels opaque statuses readably", () => {
    expect(laneLabel("in_progress")).toBe("in progress");
    expect(laneLabel("needs-review")).toBe("needs review");
    expect(laneLabel("")).toBe("unknown");
  });
});
