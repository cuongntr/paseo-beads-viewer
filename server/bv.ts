import {
  ISSUE_ID_MAX_LENGTH,
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
  SEARCH_LIMIT_MIN,
  SEARCH_QUERY_MAX_LENGTH,
} from "../shared/beads";
import {
  DEFAULT_LIMITS,
  failure,
  runJsonCommand,
  runTextCommand,
  type CommandLimits,
  type CommandResult,
  type JsonCommandRequest,
} from "./command";
import { parseTrackerFacets, parseTrackerFacetsJson, type TrackerFacets } from "./normalize";
import type { TrackerRoute } from "./tracker";

export const BV_EXECUTABLE = "bv";
const JSON_FORMAT_ARGS = ["--format", "json"] as const;
const CLEAN_BEADS_ENV = { BEADS_DIR: null, BEADS_DB: null, BEADS_JSONL: null, BD_DB: null } as const;

/**
 * Only these read-only `bv` invocations exist in the plugin. Every argv is
 * literal; nothing is templated from user input except the bounded search
 * query and limit below, which are passed as separate argv values.
 */
export type BvRobotCommand = "version" | "triage" | "plan" | "alerts" | "graph" | "search";

interface BvInvocation {
  readonly label: string;
  readonly args: readonly string[];
}

// `bv` refreshes the compatibility export in bd/Dolt workspaces. Serialize
// invocations per workspace so dashboard and attachment reads cannot race on it.
const workspaceCommandTails = new Map<string, Promise<void>>();

async function serializeWorkspaceCommand<Value>(cwd: string, run: () => Promise<Value>): Promise<Value> {
  const previous = workspaceCommandTails.get(cwd) ?? Promise.resolve();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => {}).then(() => gate);
  workspaceCommandTails.set(cwd, tail);
  await previous.catch(() => {});
  try {
    return await run();
  } finally {
    release();
    if (workspaceCommandTails.get(cwd) === tail) workspaceCommandTails.delete(cwd);
  }
}

export interface BvSearchParams {
  readonly query: string;
  readonly limit: number;
}

/** Collapses whitespace and enforces the shared query bound. */
export function sanitizeSearchQuery(raw: string): string | null {
  const collapsed = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return null;
  return collapsed.slice(0, SEARCH_QUERY_MAX_LENGTH);
}

export function clampSearchLimit(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return SEARCH_LIMIT_DEFAULT;
  const rounded = Math.trunc(raw);
  return Math.min(SEARCH_LIMIT_MAX, Math.max(SEARCH_LIMIT_MIN, rounded));
}

export function bvInvocation(command: BvRobotCommand, params?: BvSearchParams): BvInvocation {
  switch (command) {
    case "version":
      return { label: "bv --version", args: ["--version"] };
    case "triage":
      return { label: "bv --robot-triage", args: ["--robot-triage", ...JSON_FORMAT_ARGS] };
    case "plan":
      return { label: "bv --robot-plan", args: ["--robot-plan", ...JSON_FORMAT_ARGS] };
    case "alerts":
      return { label: "bv --robot-alerts", args: ["--robot-alerts", ...JSON_FORMAT_ARGS] };
    case "graph":
      // The only read that returns every issue, which is what the board needs;
      // triage and plan both hand back analysis-selected subsets.
      return {
        label: "bv --robot-graph",
        args: ["--robot-graph", "--graph-format", "json", ...JSON_FORMAT_ARGS],
      };
    case "search": {
      if (params === undefined) {
        throw new Error("bv --robot-search requires search parameters");
      }
      return {
        label: "bv --robot-search",
        args: [
          "--robot-search",
          `--search=${params.query}`,
          `--search-limit=${clampSearchLimit(params.limit)}`,
          ...JSON_FORMAT_ARGS,
        ],
      };
    }
  }
}

export function bvCommandRequest(
  command: BvRobotCommand,
  cwd: string,
  params?: BvSearchParams,
): JsonCommandRequest {
  const invocation = bvInvocation(command, params);
  return {
    label: invocation.label,
    executableName: BV_EXECUTABLE,
    args: invocation.args,
    cwd,
    env: CLEAN_BEADS_ENV,
  };
}

/** Runs one allowlisted `bv` robot command in a fixed workspace directory. */
export async function runBvJson<Value>(
  command: Exclude<BvRobotCommand, "version">,
  cwd: string,
  parse: (payload: unknown) => Value,
  params?: BvSearchParams,
): Promise<CommandResult<Value>> {
  const request = bvCommandRequest(command, cwd, params);
  return await serializeWorkspaceCommand(cwd, async () => await runJsonCommand(request, parse));
}

export async function runBvVersion(cwd: string): Promise<CommandResult<string>> {
  const request = bvCommandRequest("version", cwd);
  return await serializeWorkspaceCommand(cwd, async () => await runTextCommand(request));
}

function trackerEnvironment(route: TrackerRoute) {
  return {
    BEADS_DIR: route.beadsDirectory,
    BEADS_DB: route.database,
    BEADS_JSONL: null,
    BD_DB: route.database,
  } as const;
}

export function trackerShowInvocation(route: TrackerRoute, issueId: string) {
  if (issueId.length > ISSUE_ID_MAX_LENGTH || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(issueId)) return null;
  const safetyArgs = route.kind === "br" ? ["--no-auto-import", "--no-auto-flush"] : [];
  return {
    args: ["--db", route.database, ...safetyArgs, "show", "--json", "--", issueId],
    env: trackerEnvironment(route),
  } as const;
}

/**
 * The issue facets `bv --robot-graph` does not carry: type and assignee. CSV
 * with an explicit `--fields` list is the only compact shape `br` offers; its
 * JSON form embeds every description and measured 2.5 MB for the same 778
 * issues this returns in 24 KB. The argv is literal and takes no user input,
 * and the selected columns hold no free text, so no quoted field or embedded
 * newline can appear.
 */
/**
 * Columns asked of the tracker. The timestamps come first in preference; a
 * tracker that rejects them still answers the base columns, so types and
 * assignees never depend on the timestamps being supported.
 */
export const FACET_FIELDS_WITH_TIMES = "id,issue_type,assignee,updated_at,closed_at";
export const FACET_FIELDS_BASE = "id,issue_type,assignee";

export function trackerFacetsInvocation(route: TrackerRoute, fields: string = FACET_FIELDS_WITH_TIMES) {
  const safetyArgs = route.kind === "br" ? ["--no-auto-import", "--no-auto-flush"] : [];
  return {
    args: [
      "--db",
      route.database,
      ...safetyArgs,
      "list",
      "--status",
      "all",
      "--fields",
      fields,
      "--format",
      "csv",
    ],
    env: trackerEnvironment(route),
  } as const;
}

/**
 * `bd` 1.3 dropped `--fields` and `--format csv`. Its compact read is JSON with
 * `--brief`, which omits descriptions, design, notes and acceptance criteria;
 * titles remain and are discarded by the parser. `--skip-labels` avoids label
 * hydration, and the `--include-*` flags keep issues the graph may still show
 * from being left untyped. `--readonly` makes bd refuse any write.
 */
export function trackerFacetsJsonInvocation(route: TrackerRoute) {
  return {
    args: [
      "--db",
      route.database,
      "--readonly",
      "list",
      "--all",
      "--flat",
      "--limit",
      "0",
      "--brief",
      "--skip-labels",
      "--include-infra",
      "--include-gates",
      "--include-templates",
      "--json",
    ],
    env: trackerEnvironment(route),
  } as const;
}

/**
 * Measured at about 375 bytes per issue on bd 1.3 (4003 issues in 1.5 MB), so
 * this admits roughly as many issues as the facet parser accepts rows.
 */
const FACET_JSON_LIMITS: CommandLimits = { timeoutMs: DEFAULT_LIMITS.timeoutMs, maxOutputBytes: 8 * 1024 * 1024 };

/**
 * Runs the facet read. `bd` is asked for brief JSON first; a `bd` that rejects
 * it (an older release) and `br` take the CSV route, with timestamps when the
 * tracker supports them and without when it rejects the columns. A tracker
 * that rejects every form degrades to no overlay.
 */
export async function runTrackerFacets(route: TrackerRoute, cwd: string): Promise<CommandResult<TrackerFacets>> {
  if (route.kind === "bd") {
    const invocation = trackerFacetsJsonInvocation(route);
    const json = await runJsonCommand(
      {
        label: "bd list --brief --json",
        executableName: route.kind,
        args: invocation.args,
        cwd,
        env: invocation.env,
        limits: FACET_JSON_LIMITS,
      },
      parseTrackerFacetsJson,
    );
    if (json.ok || json.error.code !== "exit") return json;
  }
  const read = async (fields: string) => {
    const invocation = trackerFacetsInvocation(route, fields);
    return await runTextCommand({
      label: `${route.kind} list --format csv`,
      executableName: route.kind,
      args: invocation.args,
      cwd,
      env: invocation.env,
    });
  };
  let csv = await read(FACET_FIELDS_WITH_TIMES);
  if (!csv.ok && csv.error.code === "exit") csv = await read(FACET_FIELDS_BASE);
  return csv.ok ? { ok: true, value: parseTrackerFacets(csv.value) } : csv;
}

/**
 * The only tracker invocation the plugin performs for one issue: a read-only
 * detail read. `--` separates the id so an id can never be read as a flag.
 */
export async function runTrackerShow<Value>(
  route: TrackerRoute,
  cwd: string,
  issueId: string,
  parse: (payload: unknown) => Value,
): Promise<CommandResult<Value>> {
  const invocation = trackerShowInvocation(route, issueId);
  if (invocation === null) {
    return failure("internal", "Refusing to query an issue id with unexpected characters.");
  }
  return await runJsonCommand(
    {
      label: `${route.kind} show --json`,
      executableName: route.kind,
      args: invocation.args,
      cwd,
      env: invocation.env,
    },
    parse,
  );
}
