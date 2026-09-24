import { describe, expect, it } from "vitest";
import { BOARD_CELL_CARD_LIMIT, buildBoard } from "../client/board";
import { issue, plannedProject, project } from "./work-fixtures";

describe("board columns", () => {
  it("uses derived work state, with held only when something is held and done only on request", () => {
    const board = buildBoard(project(plannedProject), "package", false);
    expect(board.columns).toEqual(["active", "ready", "waiting"]);
    const withHeld = buildBoard(project([...plannedProject, issue({ id: "h", status: "deferred" })]), "package", true);
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
  it("defaults to work packages in id order, naming the outer epic as context", () => {
    const board = buildBoard(project(plannedProject), "package", false);
    expect(board.lanes.map((lane) => [lane.key, lane.done, lane.total, lane.context])).toEqual([
      ["p.1", 1, 2, "p"],
      ["p.2", 0, 3, "p"],
      ["p.10", 0, 1, "p"],
    ]);
    expect(board.lanes[1]?.cells.waiting.cards.map((item) => item.id)).toEqual(["p.2.2", "p.2.3"]);
  });

  it("groups by the outermost epic on the epic grouping", () => {
    const board = buildBoard(project(plannedProject), "epic", false);
    expect(board.lanes.map((lane) => [lane.key, lane.total])).toEqual([["p", 6]]);
  });

  it("keeps an issue in every feature it is labelled with and sinks unlabelled work", () => {
    const board = buildBoard(
      project([
        issue({ id: "a", labels: ["feature:x", "feature:y"] }),
        issue({ id: "b", labels: ["feature:y"] }),
        issue({ id: "c" }),
      ]),
      "feature",
      false,
    );
    expect(board.lanes.map((lane) => [lane.label, lane.total])).toEqual([
      ["x", 1],
      ["y", 2],
      ["No feature label", 1],
    ]);
  });

  it("hides finished lanes unless done work is shown, and says how many", () => {
    const issues = [
      issue({ id: "e", type: "epic" }),
      issue({ id: "e.1", parentId: "e", status: "closed" }),
      issue({ id: "f", type: "epic" }),
      issue({ id: "f.1", parentId: "f" }),
    ];
    const hidden = buildBoard(project(issues), "package", false);
    expect(hidden.lanes.map((lane) => lane.key)).toEqual(["f"]);
    expect(hidden.settledHidden).toBe(1);
    const shown = buildBoard(project(issues), "package", true);
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
    const board = buildBoard(project([issue({ id: "a", labels: ["feature:x", "feature:x"] })]), "feature", false);
    expect(board.lanes.map((lane) => [lane.label, lane.total])).toEqual([["x", 1]]);
  });
});
