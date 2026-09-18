import type { PluginClientContext } from "@getpaseo/plugin/client";
import { BeadsPanel } from "./client/panel";
import { requestDashboardRefresh, requestIssueFocus } from "./client/focus";
import { IssueIdSchema } from "./shared/beads";
import { beadsAttachmentSource } from "./shared/rpc";

const PANEL_ID = "beads";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: PANEL_ID,
    title: "Beads",
    icon: "GitFork",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: BeadsPanel,
  });

  client.addCommandCenterItem({
    id: "beads-open",
    title: "Open Beads",
    icon: "GitFork",
    keywords: ["beads", "issues", "dependencies", "triage", "ready"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel(PANEL_ID);
    },
  });

  client.addCommandCenterItem({
    id: "beads-refresh-triage",
    title: "Refresh Beads triage",
    icon: "RefreshCw",
    keywords: ["beads", "triage", "refresh", "bv"],
    context: "workspace",
    onSelect({ openPanel, workspace }) {
      requestDashboardRefresh(workspace.id);
      openPanel(PANEL_ID);
    },
  });

  client.addSlashCommand({
    name: "beads",
    description: "Open the read-only Beads console for this workspace",
    argumentHint: "",
    context: "workspace",
    onSubmit({ openPanel }) {
      openPanel(PANEL_ID);
    },
  });

  client.addSlashCommand({
    name: "bead",
    description: "Open the Beads console focused on one issue id",
    argumentHint: "<issue-id>",
    context: "workspace",
    onSubmit({ args, openPanel, workspace }) {
      const parsed = IssueIdSchema.safeParse(args.trim());
      if (parsed.success) requestIssueFocus(workspace.id, parsed.data);
      // Without a valid id the panel simply opens; nothing is mutated either way.
      openPanel(PANEL_ID);
    },
  });

  client.addAttachmentSource(beadsAttachmentSource);

  return () => {};
}
