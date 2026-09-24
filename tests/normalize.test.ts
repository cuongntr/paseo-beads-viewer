import { describe, expect, it } from "vitest";
import {
  AlertSchema,
  BlockerSchema,
  IssueDetailSchema,
  ProjectCountsSchema,
  RecommendationSchema,
  SearchResultSchema,
  SourceSnapshotSchema,
  TrackSchema,
  buildIssueUrl,
} from "../shared/beads";
import { dashboardRpc } from "../shared/rpc";
import { classifyProject } from "../server/dashboard";
import {
  buildIssueSnapshot,
  EMPTY_FACETS,
  normalizeAlertSummary,
  normalizeAlerts,
  normalizeBlockers,
  normalizeBoardIssues,
  normalizeCounts,
  normalizeHealth,
  normalizeIssueDetail,
  normalizePlanSummary,
  normalizeRecommendations,
  normalizeSearchResults,
  normalizeSource,
  normalizeTracks,
  parseTrackerFacets,
  readCsvRecords,
  readPayloadError,
} from "../server/normalize";
import {
  alertsPayload,
  bdShowPayload,
  brShowPayload,
  facetsCsv,
  graphPayload,
  missingProjectPayload,
  planPayload,
  searchPayload,
  triagePayload,
} from "./fixtures";

describe("source normalization", () => {
  it("keeps provenance and folds per-source staleness and warnings up", () => {
    const source = normalizeSource(triagePayload);
    expect(SourceSnapshotSchema.parse(source)).toEqual(source);
    expect(source?.sourceKind).toBe("jsonl_local");
    expect(source?.toolVersion).toBe("v0.25.0");
    expect(source?.authority?.state).toBe("partial");
    expect(source?.authority?.readiness).toBe("provisional");
    expect(source?.authority?.claimSafe).toBe(false);
    expect(source?.authority?.stale).toBe(true);
    expect(source?.authority?.warnings).toEqual(["bd export failed, using existing issues.jsonl"]);
  });

  it("treats a healthy sqlite snapshot as fresh and proven", () => {
    const source = normalizeSource(planPayload);
    expect(source?.authority?.stale).toBe(false);
    expect(source?.authority?.claimSafe).toBe(true);
    expect(source?.authority?.visible).toBe(213);
    expect(source?.authority?.tombstones).toBe(23);
  });

  it("surfaces a load failure as a payload error with a source error warning", () => {
    expect(readPayloadError(missingProjectPayload)).toMatch(/failed to read beads directory/);
    const source = normalizeSource(missingProjectPayload);
    expect(source?.authority?.failed).toBe(1);
    expect(source?.authority?.warnings).toEqual(["failed to read beads directory"]);
  });

  it("returns null rather than throwing for non-object payloads", () => {
    expect(normalizeSource(null)).toBeNull();
    expect(normalizeSource("not json")).toBeNull();
    expect(normalizeSource([1, 2, 3])).toBeNull();
    expect(readPayloadError(42)).toBeNull();
  });
});

describe("triage normalization", () => {
  it("reads quick_ref counts and the tracked total", () => {
    const counts = normalizeCounts(triagePayload);
    expect(ProjectCountsSchema.parse(counts)).toEqual(counts);
    expect(counts).toEqual({
      open: 3,
      actionable: 2,
      blocked: 0,
      inProgress: 1,
      notClosed: 4,
      notActionable: 2,
      total: 49,
      waiting: 2,
      closed: 45,
    });
  });

  it("reads pace and cycle state from project_health", () => {
    expect(normalizeHealth(triagePayload)).toEqual({
      closedLast7Days: 3,
      closedLast30Days: 12,
      velocityEstimated: true,
      hasCycles: false,
    });
  });

  it("leaves waiting and health unknown when bv omits project_health", () => {
    const bare = { triage: { meta: { issue_count: 1 }, quick_ref: { open_count: 1 } } };
    expect(normalizeCounts(bare)?.waiting).toBeNull();
    expect(normalizeHealth(bare)).toBeNull();
    expect(normalizeHealth(missingProjectPayload)).toBeNull();
  });

  it("distinguishes an empty project from a missing one", () => {
    const empty = { triage: { meta: { issue_count: 0 }, quick_ref: {}, recommendations: [] } };
    expect(normalizeCounts(empty)?.total).toBe(0);
    expect(normalizeRecommendations(empty)).toEqual([]);
    expect(readPayloadError(empty)).toBeNull();
    expect(normalizeCounts(missingProjectPayload)).toBeNull();
  });

  it("falls back to recommendations when top_picks is empty and keeps unknown statuses opaque", () => {
    const recommendations = normalizeRecommendations(triagePayload);
    for (const recommendation of recommendations) {
      expect(RecommendationSchema.parse(recommendation)).toEqual(recommendation);
    }
    expect(recommendations.map((entry) => entry.id)).toEqual(["room-z4e.3", "room-z4e.5"]);
    expect(recommendations[0]?.unblocks).toEqual(["room-z4e.5"]);
    expect(recommendations[0]?.assignee).toBe("Bytes");
    expect(recommendations[1]?.status).toBe("awaiting_review");
    expect(recommendations[1]?.blockedBy).toEqual(["room-z4e.3"]);
    expect(recommendations[1]?.assignee).toBeNull();
  });

  it("prefers top_picks when bv provides them", () => {
    const payload = {
      triage: {
        quick_ref: { top_picks: [{ id: "pick-1", title: "Top pick", status: "open", claimable: true }] },
        recommendations: [{ id: "other", title: "Other", status: "open" }],
      },
    };
    expect(normalizeRecommendations(payload).map((entry) => entry.id)).toEqual(["pick-1"]);
  });

  it("normalizes blockers to clear", () => {
    const blockers = normalizeBlockers(triagePayload);
    expect(blockers.map((blocker) => BlockerSchema.parse(blocker))).toEqual(blockers);
    expect(blockers).toEqual([
      {
        id: "room-z4e.3",
        title: "Close known Peer configuration capabilities",
        unblocksCount: 1,
        unblocks: ["room-z4e.5"],
        actionable: false,
      },
    ]);
  });

  it("drops entries without an id instead of failing the section", () => {
    const payload = {
      triage: {
        recommendations: [{ title: "no id" }, { id: "ok", title: "fine", status: "open" }],
        blockers_to_clear: [{ title: "no id" }],
      },
    };
    expect(normalizeRecommendations(payload).map((entry) => entry.id)).toEqual(["ok"]);
    expect(normalizeBlockers(payload)).toEqual([]);
  });
});

describe("plan normalization", () => {
  it("normalizes tracks and the plan summary", () => {
    const tracks = normalizeTracks(planPayload);
    expect(tracks.map((track) => TrackSchema.parse(track))).toEqual(tracks);
    expect(tracks[0]?.id).toBe("track-A");
    expect(tracks[0]?.items.map((item) => item.id)).toEqual(["pib-cyhm", "pib-x1q9"]);
    expect(tracks[0]?.totalItems).toBe(2);
    expect(normalizePlanSummary(planPayload)).toEqual({
      totalActionable: 4,
      totalBlocked: 14,
      totalTracks: 1,
      highestImpact: "pib-cyhm",
      impactReason: "No downstream dependencies",
    });
  });

  it("returns an empty track list and a null summary when the plan section is missing", () => {
    expect(normalizeTracks(missingProjectPayload)).toEqual([]);
    expect(normalizePlanSummary(missingProjectPayload)).toBeNull();
  });

  it("reports the uncapped track and item totals so a capped plan does not undercount", () => {
    const item = (id: string) => ({ id, title: id, status: "open" });
    const payload = {
      plan: {
        tracks: Array.from({ length: 3 }, (_, index) => ({
          track_id: `track-${index}`,
          items: [item(`a-${index}`), item(`b-${index}`), item(`c-${index}`)],
        })),
      },
    };
    const tracks = normalizeTracks(payload, 2, 2);
    expect(tracks).toHaveLength(2);
    expect(tracks[0]?.items).toHaveLength(2);
    expect(tracks[0]?.totalItems).toBe(3);
    expect(normalizePlanSummary(payload)?.totalTracks).toBe(3);
  });

  it("synthesizes a track id when bv omits one", () => {
    expect(normalizeTracks({ plan: { tracks: [{ items: [] }] } })[0]?.id).toBe("track-1");
  });
});

describe("alert normalization", () => {
  it("sorts by severity and keeps unknown severities last", () => {
    const alerts = normalizeAlerts({
      alerts: [...alertsPayload.alerts, { type: "novel", severity: "notice", message: "New severity" }],
    });
    expect(alerts.map((alert) => AlertSchema.parse(alert))).toEqual(alerts);
    expect(alerts.map((alert) => alert.severity)).toEqual(["critical", "warning", "info", "notice"]);
    expect(alerts[0]?.issueId).toBeNull();
  });

  it("reads the alert summary and tolerates its absence", () => {
    expect(normalizeAlertSummary(alertsPayload)).toEqual({ total: 3, critical: 1, warning: 1, info: 1 });
    expect(normalizeAlertSummary({ alerts: [] })).toBeNull();
    expect(normalizeAlerts({})).toEqual([]);
  });
});

describe("search normalization", () => {
  it("maps issue_id to id and respects the caller limit", () => {
    const results = normalizeSearchResults(searchPayload, 2);
    expect(results.map((result) => SearchResultSchema.parse(result))).toEqual(results);
    expect(results).toEqual([
      { id: "pib-cjo.2", title: "M5.2: Bundle skill", score: 0.204 },
      { id: "pib-yut.1", title: "M0.Q1: Choose execution path", score: 0.091 },
    ]);
  });

  it("returns an empty list for a payload with no results", () => {
    expect(normalizeSearchResults({ results: [] }, 10)).toEqual([]);
    expect(normalizeSearchResults({}, 10)).toEqual([]);
  });
});

describe("issue detail normalization", () => {
  it("accepts the single-element array br returns", () => {
    const issue = normalizeIssueDetail(brShowPayload);
    expect(issue).not.toBeNull();
    expect(IssueDetailSchema.parse(issue)).toEqual(issue);
    expect(issue?.id).toBe("pib-33zb");
    expect(issue?.type).toBe("task");
    expect(issue?.design).toBe("Use a manifest per writer.");
    expect(issue?.acceptanceCriteria).toContain("preflight runs");
    expect(issue?.notes).toContain("invoker approved");
    expect(issue?.parent).toBe("pib-cyhm");
    expect(issue?.dependencies).toEqual([
      { id: "pib-dcip", title: "Build manifests", status: "open", relation: "blocks" },
    ]);
    expect(issue?.dependents[0]?.id).toBe("pib-04hc");
    expect(issue?.comments).toEqual([
      { id: "10", author: "cuongnt", text: "Objective noted.", createdAt: "2026-09-09T00:00:00Z" },
    ]);
  });

  it("accepts the bare object bd returns and keeps an unknown status", () => {
    const issue = normalizeIssueDetail(bdShowPayload);
    expect(issue?.id).toBe("room-z4e.5");
    expect(issue?.status).toBe("awaiting_review");
    expect(issue?.description).toBeNull();
    expect(issue?.comments).toEqual([]);
  });

  it("rejects multi-element arrays, empty arrays, and records without an id", () => {
    expect(normalizeIssueDetail([{ id: "a" }, { id: "b" }])).toBeNull();
    expect(normalizeIssueDetail([])).toBeNull();
    expect(normalizeIssueDetail({ title: "no id" })).toBeNull();
    expect(normalizeIssueDetail(null)).toBeNull();
  });
});

describe("attachment snapshot", () => {
  it("includes workspace, identity, and full detail sections", () => {
    const issue = normalizeIssueDetail(brShowPayload);
    const text = buildIssueSnapshot({
      workspaceName: "pi-blackbytes",
      workspaceDirectory: "/repo",
      issueId: "pib-33zb",
      title: issue?.title ?? "",
      detail: issue,
    });
    expect(text).toContain("Beads issue pib-33zb");
    expect(text).toContain("Paseo workspace: pi-blackbytes");
    expect(text).toContain("Directory: /repo");
    expect(text).toContain("Status: open");
    expect(text).toContain("## Description");
    expect(text).toContain("## Design");
    expect(text).toContain("## Acceptance criteria");
    expect(text).toContain("## Notes");
  });

  it("states plainly when only search metadata is available", () => {
    const text = buildIssueSnapshot({
      workspaceName: "repo",
      workspaceDirectory: null,
      issueId: "pib-1",
      title: "Something",
      detail: null,
    });
    expect(text).toContain("Detail unavailable");
    expect(text).not.toContain("Directory:");
  });

  it("builds a parseable, stable issue url", () => {
    const url = buildIssueUrl("ws 1", "pib-1");
    expect(url).toBe("paseo-beads://workspace/ws%201/issue/pib-1");
    expect(buildIssueUrl("ws 1", "pib-1")).toBe(url);
  });
});

describe("project classification", () => {
  it("reports a healthy project as ready", () => {
    const classification = classifyProject({ ok: true, value: triagePayload });
    expect(classification.projectState).toBe("ready");
    expect(classification.triage).toEqual({ status: "ok", error: null });
  });

  it("reports an empty-but-healthy project as ready", () => {
    const classification = classifyProject({
      ok: true,
      value: { triage: { meta: { issue_count: 0 }, quick_ref: {}, recommendations: [] } },
    });
    expect(classification.projectState).toBe("ready");
  });

  it("reports a directory with no .beads source as missing, from the JSON envelope", () => {
    const classification = classifyProject({ ok: true, value: missingProjectPayload });
    expect(classification.projectState).toBe("missing");
    expect(classification.triage.status).toBe("unavailable");
  });

  it("reports a missing project from a non-zero exit message too", () => {
    const classification = classifyProject({
      ok: false,
      error: { code: "exit", message: "Error loading beads: failed to read beads directory", exitCode: 1 },
    });
    expect(classification.projectState).toBe("missing");
  });

  it("reports a genuine failure as error, not as a missing project", () => {
    for (const error of [
      { code: "unavailable" as const, message: "bv was not found", exitCode: null },
      { code: "timeout" as const, message: "bv --robot-triage timed out.", exitCode: null },
      { code: "invalid_json" as const, message: "bv returned output that is not JSON.", exitCode: 0 },
    ]) {
      expect(classifyProject({ ok: false, error }).projectState).toBe("error");
    }
  });
});

describe("board issues from the dependency graph", () => {
  it("returns every node, whatever its status", () => {
    const board = normalizeBoardIssues(graphPayload);
    expect(board.total).toBe(5);
    expect(board.truncated).toBe(false);
    expect(board.issues.map((entry) => entry.id).sort()).toEqual([
      "pib-blk1",
      "pib-cyhm",
      "pib-old1",
      "pib-old2",
      "pib-x1q9",
    ]);
    expect(board.issues.find((entry) => entry.id === "pib-x1q9")?.status).toBe("in_progress");
    expect(board.issues.filter((entry) => entry.status === "closed")).toHaveLength(2);
  });

  it("reads blocks edges as from-is-blocked-by-to", () => {
    const board = normalizeBoardIssues(graphPayload);
    const byId = new Map(board.issues.map((entry) => [entry.id, entry]));
    // Two issues declare pib-x1q9 as their prerequisite.
    expect(byId.get("pib-x1q9")?.unblocksCount).toBe(2);
    expect(byId.get("pib-x1q9")?.blockedBy).toEqual([]);
    expect(byId.get("pib-blk1")?.blockedBy).toEqual(["pib-x1q9"]);
    expect(byId.get("pib-cyhm")?.blockedBy).toEqual(["pib-x1q9"]);
  });

  it("drops a blocker once it is closed, because bv keeps the edge", () => {
    // Shaped after a real project: three tasks still carried a `blocks` edge
    // to a closed task and rendered "blocked by 1" while bv ranked them ready.
    const board = normalizeBoardIssues({
      adjacency: {
        nodes: [
          { id: "t-1", status: "closed" },
          { id: "t-2", status: "open" },
          { id: "t-3", status: "open" },
          { id: "t-4", status: "closed" },
        ],
        edges: [
          { from: "t-2", to: "t-1", type: "blocks" },
          { from: "t-3", to: "t-1", type: "blocks" },
          { from: "t-3", to: "t-2", type: "blocks" },
          // A closed dependent no longer waits on anything.
          { from: "t-4", to: "t-2", type: "blocks" },
        ],
      },
    });
    const byId = new Map(board.issues.map((entry) => [entry.id, entry]));
    expect(byId.get("t-2")?.blockedBy).toEqual([]);
    expect(byId.get("t-3")?.blockedBy).toEqual(["t-2"]);
    expect(byId.get("t-2")?.unblocksCount).toBe(1);
    expect(byId.get("t-1")?.unblocksCount).toBe(2);
  });

  it("counts a repeated blocks edge once", () => {
    const board = normalizeBoardIssues({
      adjacency: {
        nodes: [{ id: "a", status: "open" }, { id: "b", status: "open" }],
        edges: [
          { from: "a", to: "b", type: "blocks" },
          { from: "a", to: "b", type: "blocks" },
        ],
      },
    });
    const byId = new Map(board.issues.map((entry) => [entry.id, entry]));
    expect(byId.get("a")?.blockedBy).toEqual(["b"]);
    expect(byId.get("b")?.unblocksCount).toBe(1);
  });

  it("counts children, closed ones included, so truncation cannot hide a container", () => {
    const byId = new Map(normalizeBoardIssues(graphPayload).issues.map((entry) => [entry.id, entry]));
    expect(byId.get("pib-old1")?.childCount).toBe(1);
    expect(byId.get("pib-old2")?.childCount).toBe(0);
  });

  it("keeps closed ancestors of open work when truncating, before other closed issues", () => {
    const board = normalizeBoardIssues(
      {
        adjacency: {
          nodes: [
            { id: "old-1", status: "closed" },
            { id: "old-2", status: "closed" },
            { id: "epic", status: "closed" },
            { id: "task", status: "open" },
          ],
          edges: [{ from: "task", to: "epic", type: "parent-child" }],
        },
      },
      EMPTY_FACETS,
      2,
    );
    expect(board.truncated).toBe(true);
    expect(board.issues.map((entry) => entry.id)).toEqual(["task", "epic"]);
  });

  it("keeps a blocker the graph does not list, since it cannot be shown closed", () => {
    const board = normalizeBoardIssues({
      adjacency: { nodes: [{ id: "t-1", status: "open" }], edges: [{ from: "t-1", to: "elsewhere-9", type: "blocks" }] },
    });
    expect(board.issues[0]?.blockedBy).toEqual(["elsewhere-9"]);
  });

  it("reads parent-child as child-to-parent, the opposite way round from blocks", () => {
    const byId = new Map(normalizeBoardIssues(graphPayload).issues.map((e) => [e.id, e]));
    // The edge is `from: pib-old2, to: pib-old1`. Reading it the same way as a
    // `blocks` edge would invert the tree and make the child own its parent.
    expect(byId.get("pib-old2")?.parentId).toBe("pib-old1");
    expect(byId.get("pib-old1")?.parentId).toBeNull();
    // Containment is not blocking: a parent edge must not move either count.
    expect(byId.get("pib-old2")?.blockedBy).toEqual([]);
    expect(byId.get("pib-old1")?.unblocksCount).toBe(0);
  });

  it("keeps open work and drops closed issues first when the cap bites", () => {
    const board = normalizeBoardIssues(graphPayload, EMPTY_FACETS, 3);
    expect(board.total).toBe(5);
    expect(board.truncated).toBe(true);
    expect(board.issues.map((entry) => entry.id)).toEqual(["pib-cyhm", "pib-x1q9", "pib-blk1"]);
  });

  it("never drops an open issue, even below the requested cap", () => {
    const board = normalizeBoardIssues(graphPayload, EMPTY_FACETS, 1);
    expect(board.issues.filter((entry) => entry.status !== "closed")).toHaveLength(3);
    expect(board.truncated).toBe(true);
  });

  it("reports an empty board for a payload with no graph rather than throwing", () => {
    for (const payload of [null, {}, { adjacency: {} }, { adjacency: { nodes: [] } }]) {
      expect(normalizeBoardIssues(payload)).toEqual({
        issues: [],
        typed: false,
        total: 0,
        truncated: false,
      });
    }
  });

  it("skips nodes with no id and deduplicates repeated ids", () => {
    const board = normalizeBoardIssues({
      adjacency: {
        nodes: [{ title: "no id" }, { id: "a-1" }, { id: "a-1", title: "duplicate" }],
        edges: [],
      },
    });
    expect(board.issues).toHaveLength(1);
    expect(board.issues[0]?.id).toBe("a-1");
    // A node with no title falls back to its id rather than rendering blank.
    expect(board.issues[0]?.title).toBe("a-1");
  });
});

describe("tracker facet overlay", () => {
  it("reads id, type and assignee, lowercasing the type and emptying blanks", () => {
    const facets = parseTrackerFacets(facetsCsv);
    expect(facets.ok).toBe(true);
    expect(facets.byId.get("pib-cyhm")).toEqual({ type: "task", assignee: "ada" });
    expect(facets.byId.get("pib-x1q9")).toEqual({ type: "epic", assignee: null });
    expect(facets.byId.get("pib-blk1")?.assignee).toBe("grace");
  });

  it("applies the overlay onto the graph issues", () => {
    const board = normalizeBoardIssues(graphPayload, parseTrackerFacets(facetsCsv));
    expect(board.typed).toBe(true);
    const byId = new Map(board.issues.map((entry) => [entry.id, entry]));
    expect(byId.get("pib-x1q9")?.type).toBe("epic");
    expect(byId.get("pib-cyhm")?.assignee).toBe("ada");
    // The overlay must not disturb anything the graph owns.
    expect(byId.get("pib-x1q9")?.status).toBe("in_progress");
    expect(byId.get("pib-x1q9")?.unblocksCount).toBe(2);
  });

  it("leaves issues untyped when the tracker gave nothing", () => {
    const board = normalizeBoardIssues(graphPayload);
    expect(board.typed).toBe(false);
    expect(board.issues.every((entry) => entry.type === null && entry.assignee === null)).toBe(true);
  });

  it("skips malformed rows rather than mislabelling an issue", () => {
    const facets = parseTrackerFacets(
      [
        "id,issue_type,assignee",
        "good-1,task,ada",
        "too,many,columns,here",
        "short-row",
        "  ,task,ada",
      ].join("\n"),
    );
    expect([...facets.byId.keys()]).toEqual(["good-1"]);
  });

  it("keeps a row whose assignee is quoted free text", () => {
    // `br` quotes any field holding a comma: 167 of 784 rows on a real project.
    // Dropping those rows would silently untype exactly the assigned issues.
    const facets = parseTrackerFacets(
      ['id,issue_type,assignee', 'a-1,task,"Nguyễn, Văn A"', 'a-2,epic,"She said ""hi"""'].join("\n"),
    );
    expect(facets.byId.get("a-1")).toEqual({ type: "task", assignee: "Nguyễn, Văn A" });
    expect(facets.byId.get("a-2")).toEqual({ type: "epic", assignee: 'She said "hi"' });
  });

  it("keeps a row whose quoted field spans a newline", () => {
    const facets = parseTrackerFacets('id,issue_type,assignee\na-1,task,"two\nlines"\na-2,bug,ada');
    expect(facets.byId.get("a-1")?.assignee).toBe("two\nlines");
    expect(facets.byId.get("a-2")?.type).toBe("bug");
  });

  it("reports no overlay at all when the read was truncated", () => {
    // A partial overlay is indistinguishable from genuinely untyped issues, so
    // the board must lose the type axes rather than misgroup silently.
    const rows = Array.from({ length: 30 }, (_, index) => `a-${index},task,`).join("\n");
    const { records, truncated } = readCsvRecords(rows, 10);
    expect(records).toHaveLength(10);
    expect(truncated).toBe(true);

    const long = `a-1,task,${"x".repeat(600)}`;
    expect(parseTrackerFacets(long).ok).toBe(false);
    expect(parseTrackerFacets('a-1,task,"unterminated').ok).toBe(false);
  });

  it("keeps the first row when the tracker omits the header", () => {
    const facets = parseTrackerFacets("a-1,epic,ada\na-2,task,");
    expect(facets.byId.get("a-1")).toEqual({ type: "epic", assignee: "ada" });
    expect(facets.byId.size).toBe(2);
  });

  it("reports an empty overlay rather than claiming success on empty output", () => {
    expect(parseTrackerFacets("").ok).toBe(false);
    expect(parseTrackerFacets("id,issue_type,assignee").ok).toBe(false);
  });
});

describe("dashboard contract", () => {
  it("validates a fully degraded dashboard payload", () => {
    const error = { code: "unavailable" as const, message: "bv was not found", exitCode: null };
    const payload = {
      workspaceId: "ws-1",
      directory: null,
      tool: { available: false, version: null, error },
      tracker: { kind: null, available: false, detail: "unknown" },
      projectState: "error" as const,
      source: null,
      counts: null,
      health: null,
      recommendations: [],
      blockers: [],
      board: { issues: [], typed: false, total: 0, truncated: false },
      tracks: [],
      planSummary: null,
      alerts: [],
      alertSummary: null,
      sections: {
        triage: { status: "unavailable" as const, error },
        plan: { status: "unavailable" as const, error },
        alerts: { status: "unavailable" as const, error },
        graph: { status: "unavailable" as const, error },
      },
      fetchedAt: new Date().toISOString(),
      cached: false,
    };
    expect(() => dashboardRpc.output.parse(payload)).not.toThrow();
  });

  it("accepts a healthy dashboard assembled from the fixtures", () => {
    const payload = {
      workspaceId: "ws-1",
      directory: "/repo",
      tool: { available: true, version: "bv v0.25.0", error: null },
      tracker: { kind: "br" as const, available: true, detail: null },
      projectState: "ready" as const,
      source: normalizeSource(triagePayload),
      counts: normalizeCounts(triagePayload),
      health: normalizeHealth(triagePayload),
      recommendations: normalizeRecommendations(triagePayload),
      blockers: normalizeBlockers(triagePayload),
      board: normalizeBoardIssues(graphPayload, parseTrackerFacets(facetsCsv)),
      tracks: normalizeTracks(planPayload),
      planSummary: normalizePlanSummary(planPayload),
      alerts: normalizeAlerts(alertsPayload),
      alertSummary: normalizeAlertSummary(alertsPayload),
      sections: {
        triage: { status: "ok" as const, error: null },
        plan: { status: "ok" as const, error: null },
        alerts: { status: "ok" as const, error: null },
        graph: { status: "ok" as const, error: null },
      },
      fetchedAt: new Date().toISOString(),
      cached: false,
    };
    expect(() => dashboardRpc.output.parse(payload)).not.toThrow();
  });
});
