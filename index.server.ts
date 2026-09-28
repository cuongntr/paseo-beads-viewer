import type { PluginServerContext } from "@getpaseo/plugin/server";
import { searchAttachments } from "./server/attachments";
import { clearChangeState, getChanges } from "./server/changes";
import { killActiveProcesses } from "./server/command";
import { clearDashboardCache, getDashboard } from "./server/dashboard";
import { getIssue } from "./server/issue";
import { searchIssues } from "./server/search";
import { clearTrackerCache } from "./server/tracker";
import { attachmentSearchRpc, changesRpc, dashboardRpc, issueRpc, searchRpc } from "./shared/rpc";

export default function contribute(server: PluginServerContext) {
  server.handle(dashboardRpc, getDashboard);
  server.handle(searchRpc, searchIssues);
  server.handle(issueRpc, getIssue);
  server.handle(attachmentSearchRpc, searchAttachments);
  server.handle(changesRpc, getChanges);

  return () => {
    killActiveProcesses();
    clearDashboardCache();
    clearTrackerCache();
    clearChangeState();
  };
}
