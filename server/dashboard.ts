import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { CommandError, SectionState } from "../shared/beads";
import { dashboardRpc } from "../shared/rpc";
import { runBvJson, runBvVersion, runTrackerFacets } from "./bv";
import { ExpiringCache } from "./cache";
import type { CommandResult } from "./command";
import {
  EMPTY_FACETS,
  normalizeAlertSummary,
  normalizeAlerts,
  normalizeBlockers,
  normalizeBoardIssues,
  normalizeCounts,
  normalizeHealth,
  normalizePlanSummary,
  normalizeRecommendations,
  normalizeSource,
  normalizeTracks,
  parseTrackerFacets,
  readPayloadError,
  type TrackerFacets,
} from "./normalize";
import { rememberTracker, resolveTrackerFromPayload, type TrackerResolution } from "./tracker";
import { resolveWorkspaceTarget, UNKNOWN_TRACKER } from "./workspace";

type DashboardOutput = RpcOutput<typeof dashboardRpc>;

const DASHBOARD_TTL_MS = 15_000;
const dashboardCache = new ExpiringCache<DashboardOutput>(DASHBOARD_TTL_MS);
const dashboardGenerations = new ExpiringCache<number>(300_000);

export function clearDashboardCache(): void {
  dashboardCache.clear();
  dashboardGenerations.clear();
}

const OK_SECTION: SectionState = { status: "ok", error: null };

/** No graph read happened, so the board has nothing rather than a guess. */
function emptyBoard(): DashboardOutput["board"] {
  return { issues: [], typed: false, total: 0, truncated: false };
}

function degraded(error: CommandError): SectionState {
  return { status: "unavailable", error };
}

function sectionOf(result: CommandResult<unknown>): SectionState {
  if (!result.ok) return degraded(result.error);
  const payloadError = readPayloadError(result.value);
  return payloadError === null
    ? OK_SECTION
    : degraded({ code: "exit", message: payloadError, exitCode: null });
}

function identity(payload: unknown): unknown {
  return payload;
}

/**
 * A directory without a Beads project makes `bv` exit non-zero while still
 * printing a valid JSON envelope carrying a top-level `error`. When it cannot
 * even print JSON, the exit message is matched instead. Either way this is an
 * ordinary, representable state rather than a plugin failure.
 */
function isMissingProject(error: CommandError): boolean {
  if (error.code !== "exit") return false;
  return /beads directory|br init|bd init|no such file|not initialized/i.test(error.message);
}

export type ProjectState = "ready" | "missing" | "error";

export interface ProjectClassification {
  readonly projectState: ProjectState;
  readonly triage: SectionState;
}

/**
 * Separates "no Beads project here" and "the triage read failed" from
 * "healthy project that happens to be empty".
 */
export function classifyProject(triage: CommandResult<unknown>): ProjectClassification {
  if (!triage.ok) {
    return {
      projectState: isMissingProject(triage.error) ? "missing" : "error",
      triage: degraded(triage.error),
    };
  }
  const loadError = readPayloadError(triage.value);
  if (loadError !== null) {
    const error: CommandError = { code: "exit", message: loadError, exitCode: null };
    return { projectState: isMissingProject(error) ? "missing" : "error", triage: degraded(error) };
  }
  return { projectState: "ready", triage: OK_SECTION };
}

export async function getDashboard(
  input: RpcInput<typeof dashboardRpc>,
  context: PluginHandlerContext,
): Promise<DashboardOutput> {
  const previousGeneration = dashboardGenerations.get(input.workspaceId) ?? 0;
  const requestGeneration = input.refresh === true ? previousGeneration + 1 : previousGeneration;
  if (input.refresh === true) dashboardGenerations.set(input.workspaceId, requestGeneration);

  const fetchedAt = new Date().toISOString();
  const workspace = await resolveWorkspaceTarget(context, input.workspaceId);
  if (!workspace.ok) {
    return {
      workspaceId: input.workspaceId,
      directory: null,
      tool: { available: false, version: null, error: workspace.error },
      tracker: UNKNOWN_TRACKER,
      projectState: "error",
      source: null,
      counts: null,
      health: null,
      recommendations: [],
      blockers: [],
      board: emptyBoard(),
      tracks: [],
      planSummary: null,
      alerts: [],
      alertSummary: null,
      sections: {
        triage: degraded(workspace.error),
        plan: degraded(workspace.error),
        alerts: degraded(workspace.error),
        graph: degraded(workspace.error),
      },
      fetchedAt,
      cached: false,
    };
  }

  const { directory } = workspace.value;
  const cacheKey = `${input.workspaceId}\0${directory}`;
  if (input.refresh === true) {
    dashboardCache.delete(cacheKey);
  } else {
    const cached = dashboardCache.get(cacheKey);
    if (cached !== null) return { ...cached, cached: true };
  }

  const version = await runBvVersion(directory);
  if (!version.ok) {
    return {
      workspaceId: input.workspaceId,
      directory,
      tool: { available: false, version: null, error: version.error },
      tracker: UNKNOWN_TRACKER,
      projectState: "error",
      source: null,
      counts: null,
      health: null,
      recommendations: [],
      blockers: [],
      board: emptyBoard(),
      tracks: [],
      planSummary: null,
      alerts: [],
      alertSummary: null,
      sections: {
        triage: degraded(version.error),
        plan: degraded(version.error),
        alerts: degraded(version.error),
        graph: degraded(version.error),
      },
      fetchedAt,
      cached: false,
    };
  }

  // These analyses are logically independent; server/bv serializes their subprocesses per workspace to avoid bd export races.
  const [triage, plan, alerts, graph] = await Promise.all([
    runBvJson("triage", directory, identity),
    runBvJson("plan", directory, identity),
    runBvJson("alerts", directory, identity),
    runBvJson("graph", directory, identity),
  ]);

  const triagePayload = triage.ok ? triage.value : null;
  const planPayload = plan.ok ? plan.value : null;
  const alertsPayload = alerts.ok ? alerts.value : null;
  const graphSection = sectionOf(graph);
  const graphPayload = graphSection.status === "ok" && graph.ok ? graph.value : null;

  const classification = classifyProject(triage);
  const projectState = classification.projectState;

  const source = normalizeSource(triagePayload) ?? normalizeSource(planPayload) ?? normalizeSource(alertsPayload);
  const trackerResolution: TrackerResolution =
    projectState === "ready"
      ? await resolveTrackerFromPayload(triagePayload, directory)
      : { state: UNKNOWN_TRACKER, route: null };
  const tracker = trackerResolution.state;
  if (tracker.kind !== null) rememberTracker(input.workspaceId, directory, trackerResolution);

  // The graph carries no type or assignee, so the board's epic and type axes
  // depend on this overlay. A tracker that is absent or rejects the flags costs
  // those two axes and nothing else; it never fails the dashboard.
  let facets: TrackerFacets = EMPTY_FACETS;
  if (trackerResolution.route !== null && graphPayload !== null) {
    const csv = await runTrackerFacets(trackerResolution.route, directory);
    if (csv.ok) facets = parseTrackerFacets(csv.value);
  }

  const triageSection = classification.triage;

  const output: DashboardOutput = {
    workspaceId: input.workspaceId,
    directory,
    tool: { available: true, version: version.value, error: null },
    tracker,
    projectState,
    source,
    counts: normalizeCounts(triagePayload),
    health: normalizeHealth(triagePayload),
    recommendations: normalizeRecommendations(triagePayload),
    blockers: normalizeBlockers(triagePayload),
    board: normalizeBoardIssues(graphPayload, facets),
    tracks: normalizeTracks(planPayload),
    planSummary: normalizePlanSummary(planPayload),
    alerts: normalizeAlerts(alertsPayload),
    alertSummary: normalizeAlertSummary(alertsPayload),
    sections: {
      triage: triageSection,
      plan: sectionOf(plan),
      alerts: sectionOf(alerts),
      graph: graphSection,
    },
    fetchedAt,
    cached: false,
  };

  // Only a fully readable, non-superseded snapshot is worth reusing.
  if (
    triageSection.status === "ok" &&
    (dashboardGenerations.get(input.workspaceId) ?? 0) === requestGeneration
  ) {
    dashboardCache.set(cacheKey, output);
  }
  return output;
}
