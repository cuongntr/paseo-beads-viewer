import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { IssueDetail } from "../shared/beads";
import { issueRpc } from "../shared/rpc";
import { runTrackerShow } from "./bv";
import { failure, type CommandResult } from "./command";
import { normalizeIssueDetail } from "./normalize";
import { resolveTracker } from "./tracker";
import { resolveWorkspaceTarget } from "./workspace";

type IssueOutput = RpcOutput<typeof issueRpc>;

function parseDetail(payload: unknown): IssueDetail {
  const detail = normalizeIssueDetail(payload);
  if (detail === null) throw new Error("no issue record in the response");
  return detail;
}

/** Read-only detail read. There is no mutation path in this plugin. */
export async function readIssueDetail(input: {
  readonly workspaceId: string;
  readonly directory: string;
  readonly issueId: string;
}): Promise<{ readonly tracker: IssueOutput["tracker"]; readonly result: CommandResult<IssueDetail> }> {
  const resolution = await resolveTracker(input.workspaceId, input.directory);
  const tracker = resolution.state;
  if (resolution.route === null || tracker.kind === null || !tracker.available) {
    return {
      tracker,
      result: failure(
        "tracker_unknown",
        tracker.detail ?? "The Beads tracker CLI for this workspace could not be established.",
      ),
    };
  }
  const result = await runTrackerShow(resolution.route, input.directory, input.issueId, parseDetail);
  return { tracker, result };
}

export async function getIssue(
  input: RpcInput<typeof issueRpc>,
  context: PluginHandlerContext,
): Promise<IssueOutput> {
  const workspace = await resolveWorkspaceTarget(context, input.workspaceId);
  if (!workspace.ok) {
    return { issueId: input.issueId, tracker: { kind: null, available: false, detail: null }, issue: null, error: workspace.error };
  }

  const { tracker, result } = await readIssueDetail({
    workspaceId: input.workspaceId,
    directory: workspace.value.directory,
    issueId: input.issueId,
  });

  if (!result.ok) {
    return { issueId: input.issueId, tracker, issue: null, error: result.error };
  }
  return { issueId: input.issueId, tracker, issue: result.value, error: null };
}
