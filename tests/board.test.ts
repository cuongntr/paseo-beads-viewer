import { describe, expect, it } from "vitest";
import { BOARD_CELL_CARD_LIMIT, boardGroupings, buildBoard } from "../client/board";
import { issue, plannedProject, project } from "./work-fixtures";

describe("board columns", () => {
  it("uses derived work state, with held only when something is held and done only on request", () => {
    const board = buildBoard(project(plannedProject), "parent", false);
    expect(board.columns).toEqual(["active", "ready", "waiting"]);
    const withHeld = buildBoard(project([...plannedProject, issue({ id: "h", status: "deferred" })]), "parent", true);
    expect(withHeld.columns).toEqual(["active", "ready", "waiting", "held", "done"]);
  });

  it("never cards a container", () => {
    const board = buildBoard(project(plannedProject), "none", true);
    const carded = board.lanes.flatMap((lane) => Object.values(lane.cells).flatMap((cell) => cell.cards));
    expect(carded.map((item) => item.id)).not.toContain("p.1");
    expect(carded).toHaveLength(6);
  });
});

describe("board lanes", () => {
  it("defaults to the direct parent in id order, naming the top-level issue as context", () => {
    const board = buildBoard(project(plannedProject), "parent", false);
    expect(board.lanes.map((lane) => [lane.key, lane.done, lane.total, lane.context])).toEqual([
      ["p.1", 1, 2, "p"],
      ["p.2", 0, 3, "p"],
      ["p.10", 0, 1, "p"],
    ]);
    expect(board.lanes[1]?.cells.waiting.cards.map((item) => item.id)).toEqual(["p.2.2", "p.2.3"]);
  });

  it("groups by the top-level issue on the root grouping", () => {
    const board = buildBoard(project(plannedProject), "root", false);
    expect(board.lanes.map((lane) => [lane.key, lane.total])).toEqual([["p", 6]]);
  });

  it("groups by a label family discovered from the data and keeps multi-labelled work in each lane", () => {
    const model = project([
      issue({ id: "a", labels: ["stack:be", "stack:fe"] }),
      issue({ id: "b", labels: ["stack:fe"] }),
      issue({ id: "c" }),
    ]);
    expect(boardGroupings(model)).toEqual(["parent", "root", "none", "labels", "ns:stack"]);
    const board = buildBoard(model, "ns:stack", false);
    expect(board.lanes.map((lane) => [lane.label, lane.total])).toEqual([
      ["be", 1],
      ["fe", 2],
      ["No stack: label", 1],
    ]);
  });

  it("offers no label grouping to a project without labels", () => {
    expect(boardGroupings(project([issue({ id: "a" })]))).toEqual(["parent", "root", "none"]);
  });

  it("shows a custom status in its own column instead of guessing it is ready", () => {
    const board = buildBoard(project([issue({ id: "a", status: "awaiting_review" }), issue({ id: "b" })]), "none", false);
    expect(board.columns).toEqual(["active", "ready", "waiting", "other"]);
    expect(board.lanes[0]?.cells.other.cards.map((item) => item.id)).toEqual(["a"]);
  });

  it("hides finished lanes unless done work is shown, and says how many", () => {
    const issues = [
      issue({ id: "e", type: "epic" }),
      issue({ id: "e.1", parentId: "e", status: "closed" }),
      issue({ id: "f", type: "epic" }),
      issue({ id: "f.1", parentId: "f" }),
    ];
    const hidden = buildBoard(project(issues), "parent", false);
    expect(hidden.lanes.map((lane) => lane.key)).toEqual(["f"]);
    expect(hidden.settledHidden).toBe(1);
    const shown = buildBoard(project(issues), "parent", true);
    expect(shown.lanes.map((lane) => lane.key)).toEqual(["e", "f"]);
    expect(shown.settledHidden).toBe(0);
  });

  it("caps cards per cell while the lane keeps the true count", () => {
    const issues = Array.from({ length: BOARD_CELL_CARD_LIMIT + 5 }, (_, index) => issue({ id: `a-${index}` }));
    const lane = buildBoard(project(issues), "none", false).lanes[0];
    expect(lane?.cells.ready.cards).toHaveLength(BOARD_CELL_CARD_LIMIT);
    expect(lane?.cells.ready.hidden).toBe(5);
    expect(lane?.total).toBe(BOARD_CELL_CARD_LIMIT + 5);
  });
});

describe("board edge cases", () => {
  it("places an issue once in a feature lane even when the label repeats", () => {
    const board = buildBoard(project([issue({ id: "a", labels: ["f:x", "f:x"] })]), "ns:f", false);
    expect(board.lanes.map((lane) => [lane.label, lane.total])).toEqual([["x", 1]]);
  });
});
