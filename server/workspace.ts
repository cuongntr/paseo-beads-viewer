import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { TrackerKind, TrackerState } from "../shared/beads";
import { failure, resolveExecutable, type CommandResult } from "./command";
import { asRecord, normalizeSource } from "./normalize";

export interface WorkspaceTarget {
  readonly id: string;
  readonly name: string;
  readonly directory: string;
}

/**
 * Every subprocess cwd comes from Paseo's own workspace record, never from
 * client input. A workspace without a usable absolute directory is rejected.
 */
export async function resolveWorkspaceTarget(
  context: PluginHandlerContext,
  workspaceId: string,
): Promise<CommandResult<WorkspaceTarget>> {
  let directory: string | null = null;
  let name: string | null = null;
  try {
    const workspace = await context.paseo.workspaces.ref(workspaceId).refresh();
    if (workspace === null) {
      return failure("workspace_unresolved", `Paseo does not know workspace ${workspaceId}.`);
    }
    directory = workspace.workspaceDirectory;
    name = workspace.title ?? workspace.name;
  } catch (error) {
    const message = error instanceof Error ? error.message : "workspace lookup failed";
    return failure("workspace_unresolved", `Could not resolve workspace ${workspaceId}: ${message}`);
  }

  if (directory === null || directory.length === 0 || !isAbsolute(directory)) {
    return failure("cwd_invalid", `Workspace ${workspaceId} has no absolute directory to run bv in.`);
  }
  try {
    const info = await stat(directory);
    if (!info.isDirectory()) {
      return failure("cwd_invalid", `Workspace path ${directory} is not a directory.`);
    }
  } catch {
    return failure("cwd_invalid", `Workspace path ${directory} is not reachable on the daemon.`);
  }

  return { ok: true, value: { id: workspaceId, name: name ?? workspaceId, directory } };
}

export const UNKNOWN_TRACKER: TrackerState = {
  kind: null,
  available: false,
  detail: "No Beads tracker CLI (br or bd) could be established for this workspace.",
};

/**
 * `bv --robot-triage` names the tracker that owns the project in each
 * recommendation's `actions.tracker`. That is the authoritative signal; the
 * installed-binary check is only a fallback and stays inconclusive when both
 * `br` and `bd` are present.
 */
export function readTrackerFromTriage(payload: unknown): TrackerKind | null {
  const triage = asRecord(asRecord(payload)?.["triage"]);
  if (triage === null) return null;
  const quickRef = asRecord(triage["quick_ref"]);
  const groups: readonly unknown[] = [
    triage["recommendations"],
    quickRef?.["top_picks"],
    triage["quick_wins"],
  ];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const entry of group) {
      const actions = asRecord(asRecord(entry)?.["actions"]);
      const tracker = actions?.["tracker"];
      if (tracker === "br" || tracker === "bd") return tracker;
    }
  }
  return null;
}

export interface TrackerMetadata {
  readonly beadsDirectory: string;
  readonly backend: string;
  readonly database: string | null;
  readonly jsonlExport: string | null;
}

/** Reads only tracker routing metadata, preferring bv's selected source over cwd discovery. */
export async function readTrackerMetadata(payload: unknown, directory: string): Promise<TrackerMetadata | null> {
  const sourcePath = normalizeSource(payload)?.sourcePath ?? null;
  const candidates = [
    sourcePath !== null && isAbsolute(sourcePath) ? dirname(sourcePath) : null,
    join(directory, ".beads"),
  ].filter((candidate): candidate is string => candidate !== null);

  for (const beadsDirectory of [...new Set(candidates)]) {
    try {
      const raw = await readFile(join(beadsDirectory, "metadata.json"), "utf8");
      const record = asRecord(JSON.parse(raw) as unknown);
      if (record === null) continue;
      const backend = typeof record["backend"] === "string" ? record["backend"].trim().toLowerCase() : "";
      const database = typeof record["database"] === "string" ? record["database"].trim() : null;
      const jsonlExport = typeof record["jsonl_export"] === "string" ? record["jsonl_export"].trim() : null;
      return {
        beadsDirectory,
        backend,
        database: database === "" ? null : database,
        jsonlExport: jsonlExport === "" ? null : jsonlExport,
      };
    } catch {
      // Try the cwd fallback. Redirected/worktree sources normally succeed above.
    }
  }
  return null;
}

function trackerFromMetadata(metadata: TrackerMetadata | null): TrackerKind | null {
  if (metadata === null) return null;
  if (metadata.backend === "dolt") return "bd";
  const database = metadata.database?.toLowerCase() ?? "";
  if (metadata.backend === "sqlite" || /\.(db|sqlite|sqlite3)$/.test(database)) return "br";
  return null;
}

export async function detectTracker(payload: unknown, directory?: string): Promise<TrackerState> {
  const metadata = directory === undefined ? null : await readTrackerMetadata(payload, directory);
  const declared = readTrackerFromTriage(payload) ?? trackerFromMetadata(metadata);
  if (declared !== null) {
    const executable = await resolveExecutable(declared);
    if (executable === null) {
      return {
        kind: declared,
        available: false,
        detail: `This project uses ${declared}, but ${declared} is not on the daemon PATH.`,
      };
    }
    return { kind: declared, available: true, detail: null };
  }

  const [br, bd] = await Promise.all([resolveExecutable("br"), resolveExecutable("bd")]);
  if (br !== null && bd === null) return { kind: "br", available: true, detail: "Inferred from the installed CLI." };
  if (bd !== null && br === null) return { kind: "bd", available: true, detail: "Inferred from the installed CLI." };
  if (br !== null && bd !== null) {
    return {
      kind: null,
      available: false,
      detail: "Both br and bd are installed and bv did not name the project tracker, so detail reads are disabled.",
    };
  }
  return UNKNOWN_TRACKER;
}
