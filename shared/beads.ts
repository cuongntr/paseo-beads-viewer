import { z } from "zod";

/** Fixed set of command failure codes surfaced to the client. */
export const CommandErrorCodeSchema = z.enum([
  "unavailable",
  "timeout",
  "exit",
  "output_limit",
  "invalid_json",
  "cwd_invalid",
  "workspace_unresolved",
  "tracker_unknown",
  "internal",
]);
export type CommandErrorCode = z.output<typeof CommandErrorCodeSchema>;

export const CommandErrorSchema = z.object({
  code: CommandErrorCodeSchema,
  message: z.string(),
  exitCode: z.number().nullable(),
});
export type CommandError = z.output<typeof CommandErrorSchema>;

/** Per-section degradation so one missing analysis never fails the dashboard. */
export const SectionStateSchema = z.object({
  status: z.enum(["ok", "unavailable"]),
  error: CommandErrorSchema.nullable(),
});
export type SectionState = z.output<typeof SectionStateSchema>;

/**
 * Beads statuses, readiness, and authority states are treated as opaque strings.
 * Unknown values from a newer `bv` must render, not fail validation.
 */
export const SourceAuthoritySchema = z.object({
  state: z.string(),
  readiness: z.string(),
  claimSafe: z.boolean(),
  stale: z.boolean(),
  loaded: z.number(),
  failed: z.number(),
  valid: z.number(),
  visible: z.number(),
  tombstones: z.number(),
  warnings: z.array(z.string()),
});
export type SourceAuthority = z.output<typeof SourceAuthoritySchema>;

export const SourceSnapshotSchema = z.object({
  generatedAt: z.string().nullable(),
  dataHash: z.string().nullable(),
  sourcePath: z.string().nullable(),
  sourceKind: z.string().nullable(),
  toolVersion: z.string().nullable(),
  authority: SourceAuthoritySchema.nullable(),
});
export type SourceSnapshot = z.output<typeof SourceSnapshotSchema>;

export const ProjectCountsSchema = z.object({
  open: z.number(),
  actionable: z.number(),
  blocked: z.number(),
  inProgress: z.number(),
  notClosed: z.number(),
  notActionable: z.number(),
  total: z.number(),
});
export type ProjectCounts = z.output<typeof ProjectCountsSchema>;

export const RecommendationSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  type: z.string().nullable(),
  priority: z.number().nullable(),
  assignee: z.string().nullable(),
  labels: z.array(z.string()),
  score: z.number().nullable(),
  action: z.string().nullable(),
  reasons: z.array(z.string()),
  blockedBy: z.array(z.string()),
  unblocks: z.array(z.string()),
  claimable: z.boolean(),
});
export type Recommendation = z.output<typeof RecommendationSchema>;

export const BlockerSchema = z.object({
  id: z.string(),
  title: z.string(),
  unblocksCount: z.number(),
  unblocks: z.array(z.string()),
  actionable: z.boolean(),
});
export type Blocker = z.output<typeof BlockerSchema>;

export const TrackItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  priority: z.number().nullable(),
  unblocks: z.array(z.string()),
});

export const TrackSchema = z.object({
  id: z.string(),
  reason: z.string().nullable(),
  items: z.array(TrackItemSchema),
});
export type Track = z.output<typeof TrackSchema>;

export const PlanSummarySchema = z.object({
  totalActionable: z.number().nullable(),
  totalBlocked: z.number().nullable(),
  highestImpact: z.string().nullable(),
  impactReason: z.string().nullable(),
});
export type PlanSummary = z.output<typeof PlanSummarySchema>;

export const AlertSchema = z.object({
  type: z.string(),
  severity: z.string(),
  message: z.string(),
  issueId: z.string().nullable(),
  detectedAt: z.string().nullable(),
  suggestedAction: z.string().nullable(),
  labels: z.array(z.string()),
});
export type Alert = z.output<typeof AlertSchema>;

export const AlertSummarySchema = z.object({
  total: z.number(),
  critical: z.number(),
  warning: z.number(),
  info: z.number(),
});
export type AlertSummary = z.output<typeof AlertSummarySchema>;

/** `bv` is required; the per-project tracker is either `br` or `bd`. */
export const TrackerKindSchema = z.enum(["br", "bd"]);
export type TrackerKind = z.output<typeof TrackerKindSchema>;

export const ToolStateSchema = z.object({
  available: z.boolean(),
  version: z.string().nullable(),
  error: CommandErrorSchema.nullable(),
});

export const TrackerStateSchema = z.object({
  kind: TrackerKindSchema.nullable(),
  available: z.boolean(),
  detail: z.string().nullable(),
});
export type TrackerState = z.output<typeof TrackerStateSchema>;

export const IssueRefSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  status: z.string().nullable(),
  relation: z.string().nullable(),
});

export const IssueCommentSchema = z.object({
  id: z.string(),
  author: z.string().nullable(),
  text: z.string(),
  createdAt: z.string().nullable(),
});

export const IssueDetailSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  type: z.string().nullable(),
  priority: z.number().nullable(),
  assignee: z.string().nullable(),
  description: z.string().nullable(),
  design: z.string().nullable(),
  acceptanceCriteria: z.string().nullable(),
  notes: z.string().nullable(),
  labels: z.array(z.string()),
  parent: z.string().nullable(),
  dependencies: z.array(IssueRefSchema),
  dependents: z.array(IssueRefSchema),
  comments: z.array(IssueCommentSchema),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  closeReason: z.string().nullable(),
});
export type IssueDetail = z.output<typeof IssueDetailSchema>;

export const SearchResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  score: z.number().nullable(),
});
export type SearchResult = z.output<typeof SearchResultSchema>;

/** Bounds shared by the client and the server so both agree on limits. */
export const SEARCH_QUERY_MAX_LENGTH = 120;
export const SEARCH_LIMIT_MIN = 1;
export const SEARCH_LIMIT_MAX = 25;
export const SEARCH_LIMIT_DEFAULT = 10;
export const ISSUE_ID_MAX_LENGTH = 128;
export const ATTACHMENT_RESULT_LIMIT = 8;

export const SearchQuerySchema = z.string().min(1).max(SEARCH_QUERY_MAX_LENGTH);
export const SearchLimitSchema = z.number().int().min(SEARCH_LIMIT_MIN).max(SEARCH_LIMIT_MAX);
export const IssueIdSchema = z
  .string()
  .min(1)
  .max(ISSUE_ID_MAX_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Beads issue ids are alphanumeric with . _ -");

export const ATTACHMENT_URL_SCHEME = "paseo-beads:";
export const ATTACHMENT_RESOURCE_TYPE = "beads_issue";

/** Stable, parseable identity for an issue inside one Paseo workspace. */
export function buildIssueUrl(workspaceId: string, issueId: string): string {
  return `${ATTACHMENT_URL_SCHEME}//workspace/${encodeURIComponent(workspaceId)}/issue/${encodeURIComponent(issueId)}`;
}
