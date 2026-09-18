import { describe, expect, it } from "vitest";
import { buildBoard, laneLabel, laneRank } from "../client/board";
import type { Recommendation, Track } from "../shared/beads";

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

function idsIn(lanes: ReturnType<typeof buildBoard>["lanes"], status: string): readonly string[] {
  return lanes.find((lane) => lane.status === status)?.cards.map((card) => card.id) ?? [];
}

describe("card derivation", () => {
  it("unions recommendations and track items", () => {
    const board = buildBoard(
      [recommendation({ id: "a-1" })],
      [track("track-1", [item({ id: "b-2" })])],
    );
    expect(board.surfaced).toBe(2);
    expect(board.hasRecommendations).toBe(true);
    expect(board.hasTracks).toBe(true);
    expect(idsIn(board.lanes, "open")).toEqual(["a-1", "b-2"]);
  });

  it("deduplicates by id and lets recommendation metadata win", () => {
    const board = buildBoard(
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
    expect(board.surfaced).toBe(1);
    const card = board.lanes[0]?.cards[0];
    expect(card?.title).toBe("triage title");
    expect(card?.status).toBe("in_progress");
    expect(card?.priority).toBe(1);
    expect(card?.assignee).toBe("ada");
    expect(card?.type).toBe("task");
    expect(card?.labels).toEqual(["core"]);
    expect(card?.blockedByCount).toBe(1);
    expect(card?.unblocksCount).toBe(2);
    // Track membership survives the dedupe even though metadata came from triage.
    expect(card?.trackIds).toEqual(["track-1"]);
    expect(card?.fromRecommendations).toBe(true);
  });

  it("records every track a deduplicated issue belongs to, without repeats", () => {
    const board = buildBoard(
      [recommendation({ id: "a-1" })],
      [
        track("track-1", [item({ id: "a-1" })]),
        track("track-2", [item({ id: "a-1" }), item({ id: "a-1" })]),
      ],
    );
    expect(board.lanes[0]?.cards[0]?.trackIds).toEqual(["track-1", "track-2"]);
  });

  it("ignores blank ids rather than creating a phantom card", () => {
    const board = buildBoard([recommendation({ id: "" })], [track("track-1", [item({ id: "" })])]);
    expect(board.surfaced).toBe(0);
    expect(board.lanes).toEqual([]);
  });
});

describe("lane grouping and ordering", () => {
  it("orders lanes in-progress, blocked, ready/open, unknown, then closed", () => {
    const board = buildBoard(
      [
        recommendation({ id: "closed-1", status: "closed" }),
        recommendation({ id: "unknown-1", status: "awaiting_review" }),
        recommendation({ id: "open-1", status: "open" }),
        recommendation({ id: "blocked-1", status: "blocked" }),
        recommendation({ id: "active-1", status: "in_progress" }),
      ],
      [],
    );
    expect(board.lanes.map((lane) => lane.status)).toEqual([
      "in_progress",
      "blocked",
      "open",
      "awaiting_review",
      "closed",
    ]);
  });

  it("sorts unknown statuses alphabetically among themselves", () => {
    const board = buildBoard(
      [
        recommendation({ id: "c", status: "zeta_state" }),
        recommendation({ id: "a", status: "alpha_state" }),
        recommendation({ id: "b", status: "mid_state" }),
        recommendation({ id: "d", status: "done" }),
      ],
      [],
    );
    expect(board.lanes.map((lane) => lane.status)).toEqual([
      "alpha_state",
      "mid_state",
      "zeta_state",
      "done",
    ]);
  });

  it("preserves the raw status verbatim while labelling it readably", () => {
    const board = buildBoard([recommendation({ id: "a-1", status: "IN_PROGRESS" })], []);
    expect(board.lanes[0]?.status).toBe("IN_PROGRESS");
    expect(board.lanes[0]?.label).toBe("IN PROGRESS");
    expect(board.lanes[0]?.cards[0]?.status).toBe("IN_PROGRESS");
  });

  it("keeps distinct spellings of one concept as distinct lanes but adjacent", () => {
    const board = buildBoard(
      [
        recommendation({ id: "a", status: "in progress" }),
        recommendation({ id: "b", status: "in_progress" }),
        recommendation({ id: "c", status: "open" }),
      ],
      [],
    );
    expect(board.lanes.map((lane) => lane.status)).toEqual(["in progress", "in_progress", "open"]);
  });

  it("folds a blank status into an unknown lane", () => {
    const board = buildBoard([recommendation({ id: "a-1", status: "   " })], []);
    expect(board.lanes[0]?.status).toBe("unknown");
    expect(board.lanes[0]?.label).toBe("unknown");
  });

  it("orders cards by priority, then title, then id", () => {
    const board = buildBoard(
      [
        recommendation({ id: "z-9", priority: null, title: "no priority" }),
        recommendation({ id: "d-4", priority: 2, title: "beta" }),
        recommendation({ id: "c-3", priority: 0, title: "zulu" }),
        recommendation({ id: "b-2", priority: 2, title: "alpha" }),
        recommendation({ id: "a-1", priority: 2, title: "alpha" }),
      ],
      [],
    );
    expect(idsIn(board.lanes, "open")).toEqual(["c-3", "a-1", "b-2", "d-4", "z-9"]);
  });

  it("is deterministic across input permutations", () => {
    const inputs: readonly Recommendation[] = [
      recommendation({ id: "a-1", status: "open", priority: 1 }),
      recommendation({ id: "b-2", status: "blocked", priority: 0 }),
      recommendation({ id: "c-3", status: "weird", priority: 2 }),
    ];
    const forward = buildBoard(inputs, []);
    const reversed = buildBoard([...inputs].reverse(), []);
    expect(reversed.lanes.map((lane) => lane.status)).toEqual(forward.lanes.map((lane) => lane.status));
    expect(reversed.lanes.map((lane) => lane.cards.map((card) => card.id))).toEqual(
      forward.lanes.map((lane) => lane.cards.map((card) => card.id)),
    );
  });
});

describe("degraded and empty inputs", () => {
  it("returns an empty board when both sources are empty", () => {
    const board = buildBoard([], []);
    expect(board).toEqual({ lanes: [], surfaced: 0, hasRecommendations: false, hasTracks: false });
  });

  it("reports only tracks when triage is unavailable", () => {
    const board = buildBoard([], [track("track-1", [item({ id: "a-1" })])]);
    expect(board.hasRecommendations).toBe(false);
    expect(board.hasTracks).toBe(true);
    expect(board.surfaced).toBe(1);
  });

  it("reports only recommendations when the plan is unavailable", () => {
    const board = buildBoard([recommendation({ id: "a-1" })], []);
    expect(board.hasRecommendations).toBe(true);
    expect(board.hasTracks).toBe(false);
  });

  it("tolerates tracks with no items", () => {
    const board = buildBoard([], [track("track-1", []), track("track-2", [])]);
    expect(board.lanes).toEqual([]);
    expect(board.hasTracks).toBe(false);
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
