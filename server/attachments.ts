import type { PluginAttachmentItem, RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { access, constants } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  ATTACHMENT_RESOURCE_TYPE,
  ATTACHMENT_RESULT_LIMIT,
  buildIssueUrl,
  type SearchResult,
} from "../shared/beads";
import { attachmentSearchRpc } from "../shared/rpc";
import { clampSearchLimit, runBvJson, sanitizeSearchQuery } from "./bv";
import { buildIssueSnapshot, normalizeSearchResults } from "./normalize";
import { readIssueDetail } from "./issue";

type AttachmentOutput = RpcOutput<typeof attachmentSearchRpc>;

/**
 * Attachment search runs without workspace context, so it discovers candidates
 * itself. Every bound below exists to keep subprocess fanout finite: at most
 * WORKSPACE_SCAN_LIMIT workspaces are inspected, WORKSPACE_SEARCH_LIMIT of them
 * are searched, and at most ATTACHMENT_RESULT_LIMIT detail reads follow.
 */
const WORKSPACE_SCAN_LIMIT = 12;
const WORKSPACE_SEARCH_LIMIT = 4;
const PER_WORKSPACE_SEARCH_LIMIT = 5;
const SEARCH_CONCURRENCY = 2;
const DETAIL_CONCURRENCY = 3;

interface Candidate {
  readonly id: string;
  readonly name: string;
  readonly directory: string;
}

/** Presence of a `.beads` directory. The plugin never reads its contents. */
async function hasBeadsDirectory(directory: string): Promise<boolean> {
  try {
    await access(join(directory, ".beads"), constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function mapWithConcurrency<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  run: (input: Input) => Promise<Output>,
): Promise<Output[]> {
  const results: Output[] = new Array<Output>(inputs.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, inputs.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= inputs.length) return;
      const input = inputs[index];
      if (input === undefined) return;
      results[index] = await run(input);
    }
  });
  await Promise.all(workers);
  return results;
}

async function findCandidates(context: PluginHandlerContext): Promise<Candidate[]> {
  let entries: Awaited<ReturnType<PluginHandlerContext["paseo"]["workspaces"]["list"]>>["entries"];
  try {
    const listed = await context.paseo.workspaces.list({
      page: { limit: WORKSPACE_SCAN_LIMIT },
      sort: [{ key: "activity_at", direction: "desc" }],
    });
    entries = listed.entries;
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const unique: Candidate[] = [];
  for (const entry of entries) {
    const directory = entry.workspaceDirectory;
    if (typeof directory !== "string" || !isAbsolute(directory)) continue;
    if (seen.has(directory)) continue;
    seen.add(directory);
    unique.push({ id: entry.id, name: entry.title ?? entry.name, directory });
  }

  const enabled = await mapWithConcurrency(unique, DETAIL_CONCURRENCY, async (candidate) => ({
    candidate,
    enabled: await hasBeadsDirectory(candidate.directory),
  }));
  return enabled
    .filter((entry) => entry.enabled)
    .map((entry) => entry.candidate)
    .slice(0, WORKSPACE_SEARCH_LIMIT);
}

interface Hit {
  readonly candidate: Candidate;
  readonly result: SearchResult;
}

export async function searchAttachments(
  input: RpcInput<typeof attachmentSearchRpc>,
  context: PluginHandlerContext,
): Promise<AttachmentOutput> {
  const query = sanitizeSearchQuery(input.query);
  if (query === null) return { items: [] };

  const candidates = await findCandidates(context);
  if (candidates.length === 0) return { items: [] };

  const limit = clampSearchLimit(PER_WORKSPACE_SEARCH_LIMIT);
  // One failing workspace must never remove the other workspaces' results.
  const perWorkspace = await mapWithConcurrency(candidates, SEARCH_CONCURRENCY, async (candidate) => {
    const result = await runBvJson(
      "search",
      candidate.directory,
      (payload) => normalizeSearchResults(payload, limit),
      { query, limit },
    );
    return result.ok ? result.value.map((entry) => ({ candidate, result: entry })) : [];
  });

  const seen = new Set<string>();
  const hits: Hit[] = [];
  for (const group of perWorkspace) {
    for (const hit of group) {
      const key = `${hit.candidate.id}:${hit.result.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(hit);
      if (hits.length >= ATTACHMENT_RESULT_LIMIT) break;
    }
    if (hits.length >= ATTACHMENT_RESULT_LIMIT) break;
  }
  if (hits.length === 0) return { items: [] };

  const items = await mapWithConcurrency(hits, DETAIL_CONCURRENCY, async (hit): Promise<PluginAttachmentItem> => {
    const detail = await readIssueDetail({
      workspaceId: hit.candidate.id,
      directory: hit.candidate.directory,
      issueId: hit.result.id,
    });
    const issue = detail.result.ok ? detail.result.value : null;
    const title = issue?.title ?? hit.result.title;
    return {
      id: `${hit.candidate.id}:${hit.result.id}`,
      identifier: hit.result.id,
      title,
      subtitle: `${hit.candidate.name}${issue === null ? "" : ` · ${issue.status}`}`,
      url: buildIssueUrl(hit.candidate.id, hit.result.id),
      text: buildIssueSnapshot({
        workspaceName: hit.candidate.name,
        workspaceDirectory: hit.candidate.directory,
        issueId: hit.result.id,
        title,
        detail: issue,
      }),
      resourceType: ATTACHMENT_RESOURCE_TYPE,
    };
  });

  return { items };
}
