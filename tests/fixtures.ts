/**
 * Payload fixtures shaped after real `bv v0.25` and `br 0.5` output. Tests never
 * touch a Beads repository; they only assert how the plugin reshapes payloads.
 */

export const triagePayload = {
  generated_at: "2026-09-17T23:52:12Z",
  data_hash: "fb16468338fecf3768198cbe6a2fc083b226028beb9830277a2fd47815d7984c",
  output_format: "json",
  version: "v0.25.0",
  source_path: "/repo/.beads/issues.jsonl",
  source_kind: "jsonl_local",
  source_authority: {
    state: "partial",
    claim_safe: false,
    readiness: "provisional",
    loaded: 1,
    failed: 0,
    valid: 49,
    visible: 49,
    tombstones: 0,
    warning_count: 1,
    sources: [
      {
        source_path: "/repo/.beads/issues.jsonl",
        source_kind: "jsonl_local",
        status: "loaded",
        stale: true,
        warnings: ["bd export failed, using existing issues.jsonl"],
      },
    ],
  },
  triage: {
    meta: { version: "1.0.0", issue_count: 49 },
    quick_ref: {
      open_count: 3,
      actionable_count: 2,
      blocked_count: 0,
      in_progress_count: 1,
      not_closed_count: 4,
      not_actionable_count: 2,
      top_picks: [],
    },
    recommendations: [
      {
        id: "room-z4e.3",
        title: "Close known Peer configuration capabilities",
        type: "task",
        status: "in_progress",
        assignee: "Bytes",
        priority: 1,
        labels: ["change:security"],
        score: 0.19,
        action: "Inspect source diagnostics before claiming work",
        reasons: ["Unblocks 1 item(s)", "Claimed by Bytes"],
        unblocks_ids: ["room-z4e.5"],
        claimable: false,
        actions: { working_directory: "/repo", local_id: "room-z4e.3", tracker: "bd" },
      },
      {
        id: "room-z4e.5",
        title: "Add contract provenance and bounded diagnostics",
        // A newer bv could emit a status this plugin has never seen.
        status: "awaiting_review",
        priority: 2,
        labels: [],
        blocked_by: ["room-z4e.3"],
        claimable: false,
      },
    ],
    blockers_to_clear: [
      {
        id: "room-z4e.3",
        title: "Close known Peer configuration capabilities",
        unblocks_count: 1,
        unblocks_ids: ["room-z4e.5"],
        actionable: false,
      },
    ],
  },
} as const;

export const planPayload = {
  generated_at: "2026-09-17T23:52:19Z",
  data_hash: "cc7a3c49f134246c318b3e3d45292f144cef1c689d047ce051c6c668433cdb59",
  version: "v0.25.0",
  source_path: "/repo/.beads/beads.db",
  source_kind: "sqlite",
  source_authority: {
    state: "complete",
    claim_safe: true,
    readiness: "proven",
    loaded: 1,
    failed: 0,
    valid: 236,
    visible: 213,
    tombstones: 23,
    sources: [{ source_path: "/repo/.beads/beads.db", status: "loaded", stale: false }],
  },
  plan: {
    tracks: [
      {
        track_id: "track-A",
        reason: "Independent work stream",
        items: [
          { id: "pib-cyhm", title: "WP-004: Recover instructions", priority: 2, status: "open", unblocks: [] },
          { id: "pib-x1q9", title: "WP-003: Admit writers", priority: 2, status: "in_progress", unblocks: ["pib-1"] },
        ],
      },
    ],
    total_actionable: 4,
    total_blocked: 14,
    summary: { highest_impact: "pib-cyhm", impact_reason: "No downstream dependencies", unblocks_count: 0 },
  },
} as const;

/**
 * `bv --robot-graph --graph-format json`. The two edge kinds run opposite ways,
 * as verified against `br show --json`: a `blocks` edge runs `from` → `to`
 * where `from` is blocked by `to`, while `parent-child` runs `child` → `parent`.
 */
export const graphPayload = {
  generated_at: "2026-09-17T23:52:21Z",
  version: "v0.25.0",
  source_path: "/repo/.beads/beads.db",
  source_kind: "sqlite",
  format: "json",
  nodes: 5,
  edges: 3,
  adjacency: {
    nodes: [
      { id: "pib-cyhm", title: "WP-004: Recover instructions", status: "open", priority: 2, labels: ["core"] },
      { id: "pib-x1q9", title: "WP-003: Admit writers", status: "in_progress", priority: 1, labels: [] },
      { id: "pib-blk1", title: "WP-005: Await review", status: "blocked", priority: 3, labels: [] },
      { id: "pib-old1", title: "WP-001: Package foundation", status: "closed", priority: 2, labels: [] },
      { id: "pib-old2", title: "WP-002: Stable contracts", status: "closed", priority: null, labels: [] },
    ],
    edges: [
      { from: "pib-blk1", to: "pib-x1q9", type: "blocks" },
      { from: "pib-cyhm", to: "pib-x1q9", type: "blocks" },
      // pib-old2 is a child of pib-old1, written the way bv emits it.
      { from: "pib-old2", to: "pib-old1", type: "parent-child" },
    ],
  },
} as const;

/** `br list --status all --fields id,issue_type,assignee --format csv`. */
export const facetsCsv = [
  "id,issue_type,assignee",
  "pib-cyhm,task,ada",
  "pib-x1q9,epic,",
  "pib-blk1,bug,grace",
  "pib-old1,epic,",
  "pib-old2,task,",
].join("\n");

export const alertsPayload = {
  generated_at: "2026-09-17T23:52:19Z",
  version: "v0.25.0",
  alerts: [
    {
      type: "stale_issue",
      severity: "info",
      message: "Issue pib-a inactive for 3 days",
      issue_id: "pib-a",
      detected_at: "2026-09-17T23:52:19Z",
      labels: ["service:x"],
      suggested_action: "Re-triage the issue",
    },
    {
      type: "cycle",
      severity: "critical",
      message: "Dependency cycle detected",
      detected_at: "2026-09-17T23:52:19Z",
    },
    {
      type: "stale_issue",
      severity: "warning",
      message: "Issue pib-b inactive for 10 days",
      issue_id: "pib-b",
    },
  ],
  summary: { total: 3, critical: 1, warning: 1, info: 1 },
} as const;

export const searchPayload = {
  generated_at: "2026-09-17T23:52:24Z",
  version: "v0.25.0",
  query: "plugin",
  limit: 3,
  results: [
    { issue_id: "pib-cjo.2", score: 0.204, title: "M5.2: Bundle skill" },
    { issue_id: "pib-yut.1", score: 0.091, title: "M0.Q1: Choose execution path" },
    { issue_id: "pib-cikr.2", score: 0.047, title: "Status Diagnostics" },
  ],
} as const;

/** `bv` reports a missing project through a top-level `error` plus exit code 1. */
export const missingProjectPayload = {
  generated_at: "2026-09-17T23:53:41Z",
  data_hash: "",
  version: "v0.25.0",
  source_authority: {
    state: "unknown",
    claim_safe: false,
    readiness: "provisional",
    loaded: 0,
    failed: 1,
    sources: [{ source_kind: "unknown", status: "failed", error: "failed to read beads directory" }],
  },
  actionable: false,
  error: "failed to read beads directory: open /tmp/x/.beads: no such file or directory",
} as const;

/** `br show --json` answers with a single-element array. */
export const brShowPayload = [
  {
    id: "pib-33zb",
    title: "Require recoverable instruction preflight",
    description: "## Objective\nInject mandatory recovery policy.",
    design: "Use a manifest per writer.",
    acceptance_criteria: "- preflight runs\n- escalation fires",
    notes: "2026-09-09 invoker approved delta",
    status: "open",
    priority: 2,
    issue_type: "task",
    assignee: "cmc-admin",
    created_at: "2026-09-08T10:14:18Z",
    updated_at: "2026-09-08T23:23:53Z",
    labels: ["change:001", "service:pi-blackbytes"],
    parent: "pib-cyhm",
    dependencies: [{ id: "pib-dcip", title: "Build manifests", status: "open", dependency_type: "blocks" }],
    dependents: [{ id: "pib-04hc", title: "Document limits", status: "open", dependency_type: "parent-child" }],
    comments: [{ id: 10, issue_id: "pib-33zb", author: "cuongnt", text: "Objective noted.", created_at: "2026-09-09T00:00:00Z" }],
  },
] as const;

/** `bd show --json` answers with a bare object. */
export const bdShowPayload = {
  id: "room-z4e.5",
  title: "Add contract provenance",
  status: "awaiting_review",
  priority: 2,
  labels: [],
} as const;
