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

/** The graph-backed board: issues are the source, triage and plan only enrich. */
function board(input: Partial<BoardInput> & { issues: readonly BoardIssue[] }) {
  return buildBoard({
    graphAvailable: true,
    total: input.issues.length,
    truncated: false,
    recommendations: [],
    tracks: [],
    ...input,
  });
}

/** The fallback board: no graph, so triage and plan are the only sources. */
function workingSet(recommendations: readonly Recommendation[], tracks: readonly Track[]) {
  return buildBoard({
    graphAvailable: false,
    issues: [],
    total: 0,
    truncated: false,
    recommendations,
    tracks,
  });
}

function idsIn(lanes: ReturnType<typeof buildBoard>["lanes"], status: string): readonly string[] {
  return lanes.find((lane) => lane.status === status)?.cards.map((card) => card.id) ?? [];
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
    expect(model.lanes.map((lane) => lane.status)).toEqual([
      "in_progress",
      "blocked",
      "open",
      "closed",
    ]);
    expect(idsIn(model.lanes, "closed")).toEqual(["a-3"]);
    expect(idsIn(model.lanes, "in_progress")).toEqual(["a-2"]);
  });

  it("carries the graph's dependency counts onto the cards", () => {
    const model = board({
      issues: [issue({ id: "a-1", blockedByCount: 2, unblocksCount: 5, labels: ["core"] })],
    });
    const card = model.lanes[0]?.cards[0];
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
    const card = model.lanes[0]?.cards[0];
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
    expect(model.lanes.flatMap((lane) => lane.cards.map((card) => card.id))).toEqual(["a-1"]);
  });

  it("keeps the reported total and truncation flag when the payload was capped", () => {
    const model = buildBoard({
      graphAvailable: true,
      issues: [issue({ id: "a-1" })],
      total: 9000,
      truncated: true,
      recommendations: [],
      tracks: [],
    });
    expect(model.total).toBe(9000);
    expect(model.truncated).toBe(true);
  });

  it("ignores blank ids rather than creating a phantom card", () => {
    const model = board({ issues: [issue({ id: "" })] });
    expect(model.surfaced).toBe(0);
    expect(model.lanes).toEqual([]);
  });

  it("separates a healthy empty project from a failed graph read", () => {
    // Both are empty, but only one of them is the whole project.
    const healthyEmpty = board({ issues: [] });
    expect(healthyEmpty.complete).toBe(true);
    expect(healthyEmpty.lanes).toEqual([]);

    const failedGraph = workingSet([], []);
    expect(failedGraph.complete).toBe(false);
  });
});

describe("lane capping", () => {
  it("caps rendered cards per lane while the lane header keeps the true count", () => {
    const issues = Array.from({ length: BOARD_LANE_CARD_LIMIT + 7 }, (_, index) =>
      issue({ id: `a-${String(index).padStart(3, "0")}`, status: "closed" }),
    );
    const model = board({ issues });
    const lane = model.lanes[0];
    expect(lane?.status).toBe("closed");
    expect(lane?.total).toBe(BOARD_LANE_CARD_LIMIT + 7);
    expect(lane?.cards).toHaveLength(BOARD_LANE_CARD_LIMIT);
    expect(lane?.hidden).toBe(7);
    // `surfaced` counts issues, not rendered cards.
    expect(model.surfaced).toBe(BOARD_LANE_CARD_LIMIT + 7);
  });

  it("marks only finished lanes as closed so the view collapses nothing else", () => {
    const model = board({
      issues: [
        issue({ id: "a-1", status: "open" }),
        issue({ id: "a-2", status: "done" }),
        issue({ id: "a-3", status: "awaiting_review" }),
      ],
    });
    expect(model.lanes.map((lane) => [lane.status, lane.closed])).toEqual([
      ["open", false],
      ["awaiting_review", false],
      ["done", true],
    ]);
  });
});

describe("lane grouping and ordering", () => {
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
    expect(model.lanes.map((lane) => lane.status)).toEqual([
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
    expect(model.lanes.map((lane) => lane.status)).toEqual([
      "alpha_state",
      "mid_state",
      "zeta_state",
      "done",
    ]);
  });

  it("preserves the raw status verbatim while labelling it readably", () => {
    const model = board({ issues: [issue({ id: "a-1", status: "IN_PROGRESS" })] });
    expect(model.lanes[0]?.status).toBe("IN_PROGRESS");
    expect(model.lanes[0]?.label).toBe("IN PROGRESS");
    expect(model.lanes[0]?.cards[0]?.status).toBe("IN_PROGRESS");
  });

  it("keeps distinct spellings of one concept as distinct lanes but adjacent", () => {
    const model = board({
      issues: [
        issue({ id: "a", status: "in progress" }),
        issue({ id: "b", status: "in_progress" }),
        issue({ id: "c", status: "open" }),
      ],
    });
    expect(model.lanes.map((lane) => lane.status)).toEqual(["in progress", "in_progress", "open"]);
  });

  it("folds a blank status into an unknown lane", () => {
    const model = board({ issues: [issue({ id: "a-1", status: "   " })] });
    expect(model.lanes[0]?.status).toBe("unknown");
    expect(model.lanes[0]?.label).toBe("unknown");
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
    expect(idsIn(model.lanes, "open")).toEqual(["c-3", "a-1", "b-2", "d-4", "z-9"]);
  });

  it("is deterministic across input permutations", () => {
    const issues: readonly BoardIssue[] = [
      issue({ id: "a-1", status: "open", priority: 1 }),
      issue({ id: "b-2", status: "blocked", priority: 0 }),
      issue({ id: "c-3", status: "weird", priority: 2 }),
    ];
    const forward = board({ issues });
    const reversed = board({ issues: [...issues].reverse() });
    expect(reversed.lanes.map((lane) => lane.status)).toEqual(forward.lanes.map((lane) => lane.status));
    expect(reversed.lanes.map((lane) => lane.cards.map((card) => card.id))).toEqual(
      forward.lanes.map((lane) => lane.cards.map((card) => card.id)),
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
    expect(idsIn(model.lanes, "open")).toEqual(["a-1", "b-2"]);
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
    const card = model.lanes[0]?.cards[0];
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
    expect(model.lanes[0]?.cards[0]?.trackIds).toEqual(["track-1", "track-2"]);
  });

  it("never claims truncation for a working set", () => {
    const model = buildBoard({
      graphAvailable: false,
      issues: [],
      total: 9000,
      truncated: true,
      recommendations: [recommendation({ id: "a-1" })],
      tracks: [],
    });
    expect(model.complete).toBe(false);
    expect(model.truncated).toBe(false);
    expect(model.total).toBe(1);
  });

  it("returns an empty, incomplete board when every source is empty", () => {
    const model = workingSet([], []);
    expect(model.lanes).toEqual([]);
    expect(model.surfaced).toBe(0);
    expect(model.complete).toBe(false);
  });

  it("tolerates tracks with no items", () => {
    const model = workingSet([], [track("track-1", []), track("track-2", [])]);
    expect(model.lanes).toEqual([]);
    expect(model.hasTracks).toBe(false);
  });
});

describe("lane helpers", () => {
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
