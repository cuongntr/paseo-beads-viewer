import { describe, expect, it } from "vitest";
import { ALL_WORK, BOARD_COLUMN_CARD_LIMIT, boardFilters, buildBoard, parentLabel } from "../client/board";
import { issue, plannedProject, project } from "./work-fixtures";

const ids = (items: readonly { readonly id: string }[]) => items.map((item) => item.id);

describe("board columns", () => {
  it("is one column per work state, with held and other only when non-empty and done only on request", () => {
    const board = buildBoard(project(plannedProject), ALL_WORK, false);
    // Work's own order: not started, in progress, held, finished.
    expect(board.columns.map((column) => column.state)).toEqual(["ready", "waiting", "active"]);
    const busier = buildBoard(
      project([...plannedProject, issue({ id: "h", status: "deferred" }), issue({ id: "o", status: "awaiting_review" })]),
      ALL_WORK,
      true,
    );
    expect(busier.columns.map((column) => column.state)).toEqual(["ready", "waiting", "active", "held", "other", "done"]);
  });

  it("puts every piece of work in exactly one column and never cards a container", () => {
    const board = buildBoard(project(plannedProject), ALL_WORK, true);
    const carded = board.columns.flatMap((column) => ids(column.cards));
    expect([...carded].sort()).toEqual(["p.1.1", "p.1.2", "p.10.1", "p.2.1", "p.2.2", "p.2.3"]);
    expect(new Set(carded).size).toBe(carded.length);
  });

  it("keeps project order inside a column", () => {
    const board = buildBoard(project(plannedProject), ALL_WORK, false);
    expect(ids(board.columns.find((column) => column.state === "waiting")?.cards ?? [])).toEqual(["p.2.2", "p.2.3"]);
  });

  it("caps cards per column while keeping the true count", () => {
    const issues = Array.from({ length: BOARD_COLUMN_CARD_LIMIT + 5 }, (_, index) => issue({ id: `a-${index}` }));
    const ready = buildBoard(project(issues), ALL_WORK, false).columns.find((column) => column.state === "ready");
    expect(ready?.cards).toHaveLength(BOARD_COLUMN_CARD_LIMIT);
    expect(ready?.total).toBe(BOARD_COLUMN_CARD_LIMIT + 5);
    expect(ready?.hidden).toBe(5);
  });
});

describe("board filters", () => {
  it("offers all work, then open parents nested under their top level, then the project's labels", () => {
    const model = project([...plannedProject, issue({ id: "x", labels: ["stack:ops"] })]);
    expect(boardFilters(model).map((option) => [option.key, option.depth, option.live])).toEqual([
      ["all", 0, 6],
      ["parent:p", 0, 5],
      ["parent:p.1", 1, 1],
      ["parent:p.2", 1, 3],
      ["parent:p.10", 1, 1],
      ["label:human-approval", 0, 1],
      ["label:stack:ops", 0, 1],
    ]);
  });

  it("narrows to a parent's whole subtree, a direct parent, or one label", () => {
    const model = project([...plannedProject, issue({ id: "x", labels: ["stack:ops"] })]);
    const cards = (filter: Parameters<typeof buildBoard>[1]) =>
      buildBoard(model, filter, true)
        .columns.flatMap((column) => ids(column.cards))
        .sort();
    expect(cards({ kind: "parent", id: "p" })).toEqual(["p.1.1", "p.1.2", "p.10.1", "p.2.1", "p.2.2", "p.2.3"]);
    expect(cards({ kind: "parent", id: "p.2" })).toEqual(["p.2.1", "p.2.2", "p.2.3"]);
    expect(cards({ kind: "label", label: "stack:ops" })).toEqual(["x"]);
  });

  it("falls back to all work when the chosen filter no longer matches anything", () => {
    const board = buildBoard(project(plannedProject), { kind: "label", label: "gone" }, false);
    expect(board.filter).toEqual(ALL_WORK);
  });

  it("names each card's direct parent as its context", () => {
    const model = project(plannedProject);
    const child = model.byId.get("p.2.1");
    expect(child === undefined ? null : parentLabel(child, model)).toBe("WP-002");
    const loose = project([issue({ id: "loose" })]);
    const item = loose.byId.get("loose");
    expect(item === undefined ? "missing" : parentLabel(item, loose)).toBeNull();
  });
});
