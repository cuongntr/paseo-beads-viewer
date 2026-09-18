import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { TrackerKind, TrackerState } from "../shared/beads";
import { runBvJson } from "./bv";
import { ExpiringCache } from "./cache";
import { normalizeSource } from "./normalize";
import { detectTracker, readTrackerMetadata, UNKNOWN_TRACKER } from "./workspace";

const TRACKER_TTL_MS = 120_000;

/** Exact live tracker route established from bv's selected source and metadata. */
export interface TrackerRoute {
  readonly kind: TrackerKind;
  readonly beadsDirectory: string;
  readonly database: string;
}

export interface TrackerResolution {
  readonly state: TrackerState;
  readonly route: TrackerRoute | null;
}

const UNKNOWN_RESOLUTION: TrackerResolution = { state: UNKNOWN_TRACKER, route: null };
const trackerCache = new ExpiringCache<TrackerResolution>(TRACKER_TTL_MS);
const trackerReads = new Map<string, Promise<TrackerResolution>>();

export function clearTrackerCache(): void {
  trackerCache.clear();
  trackerReads.clear();
}

function trackerCacheKey(workspaceId: string, directory: string): string {
  return `${workspaceId}\0${directory}`;
}

export function rememberTracker(workspaceId: string, directory: string, resolution: TrackerResolution): void {
  if (resolution.state.kind !== null) trackerCache.set(trackerCacheKey(workspaceId, directory), resolution);
}

async function buildTrackerRoute(
  kind: TrackerKind,
  payload: unknown,
  directory: string,
): Promise<TrackerRoute | null> {
  const metadata = await readTrackerMetadata(payload, directory);
  if (metadata === null) return null;

  const source = normalizeSource(payload);
  if (source?.sourcePath === null || source?.sourcePath === undefined || !isAbsolute(source.sourcePath)) return null;
  const selectedSource = resolve(source.sourcePath);
  const resolveMetadataPath = (value: string | null): string | null =>
    value === null ? null : isAbsolute(value) ? resolve(value) : resolve(metadata.beadsDirectory, value);

  let database: string | null;
  if (kind === "bd") {
    if (metadata.backend !== "dolt" || selectedSource !== resolve(metadata.beadsDirectory, "issues.jsonl")) return null;
    database = metadata.beadsDirectory;
  } else {
    if (metadata.backend === "dolt") return null;
    database = resolveMetadataPath(metadata.database);
    const jsonlExport = resolveMetadataPath(metadata.jsonlExport);
    if (database === null || (selectedSource !== database && selectedSource !== jsonlExport)) return null;
  }
  if (database.includes("\0") || !isAbsolute(database)) return null;

  try {
    const info = await stat(database);
    if (kind === "bd" ? !info.isDirectory() : !info.isFile()) return null;
  } catch {
    return null;
  }

  return { kind, beadsDirectory: metadata.beadsDirectory, database };
}

/**
 * Establishes both tracker identity and the exact database route. Detail reads
 * fail closed when metadata cannot bind the CLI to bv's selected live source.
 */
export async function resolveTrackerFromPayload(payload: unknown, directory: string): Promise<TrackerResolution> {
  const detected = await detectTracker(payload, directory);
  if (detected.kind === null || !detected.available) return { state: detected, route: null };

  const route = await buildTrackerRoute(detected.kind, payload, directory);
  if (route === null) {
    return {
      state: {
        kind: detected.kind,
        available: false,
        detail: `The ${detected.kind} CLI is installed, but its exact read-only database route could not be established.`,
      },
      route: null,
    };
  }
  return { state: detected, route };
}

/** Resolves and caches the exact read-only tracker route for one workspace. */
export async function resolveTracker(workspaceId: string, directory: string): Promise<TrackerResolution> {
  const key = trackerCacheKey(workspaceId, directory);
  const cached = trackerCache.get(key);
  if (cached !== null) return cached;

  const active = trackerReads.get(key);
  if (active !== undefined) return await active;

  const read = (async () => {
    const triage = await runBvJson("triage", directory, (payload) => payload);
    if (!triage.ok) {
      return { ...UNKNOWN_RESOLUTION, state: { ...UNKNOWN_TRACKER, detail: triage.error.message } };
    }
    const resolution = await resolveTrackerFromPayload(triage.value, directory);
    rememberTracker(workspaceId, directory, resolution);
    return resolution;
  })();
  trackerReads.set(key, read);
  try {
    return await read;
  } finally {
    trackerReads.delete(key);
  }
}
