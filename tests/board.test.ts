import { describe, expect, it } from "vitest";
import { ALL_WORK, BOARD_COLUMN_CARD_LIMIT, boardFilters, buildBoard, parentLabel, searchFilters, toggleFilter } from "../client/board";
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
  it("offers open parents nested under their top level, then the project's labels", () => {
    const model = project([...plannedProject, issue({ id: "x", labels: ["stack:ops"] })]);
    expect(boardFilters(model).map((option) => [option.kind, option.value, option.depth, option.live])).toEqual([
      ["parent", "p", 0, 5],
      ["parent", "p.1", 1, 1],
      ["parent", "p.2", 1, 3],
      ["parent", "p.10", 1, 1],
      ["label", "human-approval", 0, 1],
      ["label", "stack:ops", 0, 1],
    ]);
  });

  it("widens within parents and within labels, and narrows across the two", () => {
    const model = project([
      ...plannedProject,
      issue({ id: "p.2.9", parentId: "p.2", labels: ["stack:be"] }),
      issue({ id: "p.10.9", parentId: "p.10", labels: ["stack:fe"] }),
    ]);
    const cards = (filter: Parameters<typeof buildBoard>[1]) =>
      buildBoard(model, filter, true)
        .columns.flatMap((column) => ids(column.cards))
        .sort();
    // Any chosen parent's whole subtree.
    expect(cards({ parents: ["p.2", "p.10"], labels: [] })).toEqual(["p.10.1", "p.10.9", "p.2.1", "p.2.2", "p.2.3", "p.2.9"]);
    // Any chosen label.
    expect(cards({ parents: [], labels: ["stack:be", "stack:fe"] })).toEqual(["p.10.9", "p.2.9"]);
    // Both kinds: under a chosen parent AND carrying a chosen label.
    expect(cards({ parents: ["p.2"], labels: ["stack:be", "stack:fe"] })).toEqual(["p.2.9"]);
  });

  it("drops choices that no longer match anything, and keeps the rest", () => {
    const board = buildBoard(project(plannedProject), { parents: ["p.2", "gone"], labels: ["gone"] }, false);
    expect(board.filter).toEqual({ parents: ["p.2"], labels: [] });
    expect(buildBoard(project(plannedProject), { parents: ["gone"], labels: [] }, false).filter).toEqual(ALL_WORK);
  });

  it("toggles one choice in or out without touching the other kind", () => {
    const once = toggleFilter(ALL_WORK, "parent", "p.2");
    expect(once).toEqual({ parents: ["p.2"], labels: [] });
    const both = toggleFilter(once, "label", "stack:be");
    expect(both).toEqual({ parents: ["p.2"], labels: ["stack:be"] });
    expect(toggleFilter(both, "parent", "p.2")).toEqual({ parents: [], labels: ["stack:be"] });
  });

  it("finds options by id, title, label, or the title of their top level", () => {
    const options = boardFilters(project([...plannedProject, issue({ id: "x", labels: ["stack:ops"] })]));
    const found = (query: string) => searchFilters(options, query).map((option) => option.value);
    expect(found("")).toHaveLength(options.length);
    expect(found("wp-002")).toEqual(["p.2"]);
    expect(found("p.10")).toEqual(["p.10"]);
    expect(found("stack")).toEqual(["stack:ops"]);
    // A package is found through its epic's title, so an epic search lists its packages too.
    expect(found("feat-001")).toEqual(["p", "p.1", "p.2", "p.10"]);
    expect(found("nothing like this")).toEqual([]);
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
