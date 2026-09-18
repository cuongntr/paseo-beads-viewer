import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { searchRpc } from "../shared/rpc";
import { clampSearchLimit, runBvJson, sanitizeSearchQuery } from "./bv";
import { normalizeSearchResults } from "./normalize";
import { resolveWorkspaceTarget } from "./workspace";

type SearchOutput = RpcOutput<typeof searchRpc>;

export async function searchIssues(
  input: RpcInput<typeof searchRpc>,
  context: PluginHandlerContext,
): Promise<SearchOutput> {
  const limit = clampSearchLimit(input.limit);
  const query = sanitizeSearchQuery(input.query);
  if (query === null) {
    return {
      query: "",
      limit,
      results: [],
      error: { code: "internal", message: "Enter at least one searchable character.", exitCode: null },
    };
  }

  const workspace = await resolveWorkspaceTarget(context, input.workspaceId);
  if (!workspace.ok) {
    return { query, limit, results: [], error: workspace.error };
  }

  const result = await runBvJson(
    "search",
    workspace.value.directory,
    (payload) => normalizeSearchResults(payload, limit),
    { query, limit },
  );
  if (!result.ok) {
    return { query, limit, results: [], error: result.error };
  }
  return { query, limit, results: result.value, error: null };
}
