import { defineAttachmentSource, defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import {
  AlertSchema,
  AlertSummarySchema,
  ATTACHMENT_RESULT_LIMIT,
  BlockerSchema,
  BoardSnapshotSchema,
  CommandErrorSchema,
  IssueDetailSchema,
  IssueIdSchema,
  PlanSummarySchema,
  ProjectCountsSchema,
  ProjectHealthSchema,
  RecommendationSchema,
  SearchLimitSchema,
  SearchQuerySchema,
  SearchResultSchema,
  SectionStateSchema,
  SourceSnapshotSchema,
  ToolStateSchema,
  TrackSchema,
  TrackerStateSchema,
} from "./beads";

const WorkspaceInputSchema = z.object({ workspaceId: z.string().min(1) });

const DashboardInputSchema = WorkspaceInputSchema.extend({
  /** Set by an explicit user refresh so the short-lived cache is bypassed. */
  refresh: z.boolean().optional(),
});

/**
 * The dashboard always resolves: an unreachable `bv`, a workspace without Beads,
 * and an empty-but-healthy project are three distinct, representable states.
 */
export const dashboardRpc = defineRpc({
  name: "beads.dashboard",
  input: DashboardInputSchema,
  output: z.object({
    workspaceId: z.string(),
    directory: z.string().nullable(),
    tool: ToolStateSchema,
    tracker: TrackerStateSchema,
    /** `ready` = bv analysed a project here (possibly empty), `missing` = no Beads source, `error` = the read failed. */
    projectState: z.enum(["ready", "missing", "error"]),
    source: SourceSnapshotSchema.nullable(),
    counts: ProjectCountsSchema.nullable(),
    health: ProjectHealthSchema.nullable(),
    recommendations: z.array(RecommendationSchema),
    blockers: z.array(BlockerSchema),
    /** Every issue `bv --robot-graph` reported, which is what the board lays out. */
    board: BoardSnapshotSchema,
    tracks: z.array(TrackSchema),
    planSummary: PlanSummarySchema.nullable(),
    alerts: z.array(AlertSchema),
    alertSummary: AlertSummarySchema.nullable(),
    sections: z.object({
      triage: SectionStateSchema,
      plan: SectionStateSchema,
      alerts: SectionStateSchema,
      graph: SectionStateSchema,
    }),
    fetchedAt: z.string(),
    cached: z.boolean(),
  }),
});

export const searchRpc = defineRpc({
  name: "beads.search",
  input: z.object({
    workspaceId: z.string().min(1),
    query: SearchQuerySchema,
    limit: SearchLimitSchema.optional(),
  }),
  output: z.object({
    query: z.string(),
    limit: z.number(),
    results: z.array(SearchResultSchema),
    error: CommandErrorSchema.nullable(),
  }),
});

export const issueRpc = defineRpc({
  name: "beads.issue",
  input: z.object({ workspaceId: z.string().min(1), issueId: IssueIdSchema }),
  output: z.object({
    issueId: z.string(),
    tracker: TrackerStateSchema,
    issue: IssueDetailSchema.nullable(),
    error: CommandErrorSchema.nullable(),
  }),
});

/**
 * Attachment search has no workspace context, so the handler discovers Beads-enabled
 * workspaces itself and returns at most {@link ATTACHMENT_RESULT_LIMIT} items.
 */
export const attachmentSearchRpc = defineRpc({
  name: "beads.attachments.search",
  input: z.object({ query: z.string() }),
  output: z.object({
    items: z
      .array(
        z.object({
          id: z.string(),
          identifier: z.string(),
          title: z.string(),
          subtitle: z.string().optional(),
          url: z.url(),
          text: z.string(),
          resourceType: z.string(),
        }),
      )
      .max(ATTACHMENT_RESULT_LIMIT),
  }),
});

export const beadsAttachmentSource = defineAttachmentSource({
  id: "beads-issue",
  title: "Beads issue",
  icon: "CircleDot",
  pickerTitle: "Attach Beads issue",
  searchPlaceholder: "Search Beads issues by id or keyword",
  search: attachmentSearchRpc,
});

/** Client-facing dashboard shape: what the panel receives after output validation. */
export type DashboardResult = z.output<typeof dashboardRpc.output>;
