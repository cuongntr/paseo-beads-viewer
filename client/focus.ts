/**
 * Lets a slash command or Command Center item pre-select an issue in the panel.
 * Module state is shared inside one client bundle, so the panel can read the
 * request the command wrote just before opening it.
 */
type Listener = () => void;

const listeners = new Set<Listener>();
const requests = new Map<string, string>();
let revision = 0;
const refreshRequests = new Set<string>();
let refreshRevision = 0;

export function requestIssueFocus(workspaceId: string, issueId: string): void {
  requests.set(workspaceId, issueId);
  revision += 1;
  for (const listener of listeners) listener();
}

/** Reads and clears a pending focus request. */
export function takeIssueFocus(workspaceId: string): string | null {
  const issueId = requests.get(workspaceId);
  if (issueId === undefined) return null;
  requests.delete(workspaceId);
  return issueId;
}

export function subscribeIssueFocus(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function requestDashboardRefresh(workspaceId: string): void {
  refreshRequests.add(workspaceId);
  refreshRevision += 1;
  for (const listener of listeners) listener();
}

export function takeDashboardRefresh(workspaceId: string): boolean {
  return refreshRequests.delete(workspaceId);
}

export function dashboardRefreshRevision(): number {
  return refreshRevision;
}

export function issueFocusRevision(): number {
  return revision;
}
