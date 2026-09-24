import { type PluginWorkspacePanelProps, useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import {
  SEARCH_LIMIT_DEFAULT,
  SEARCH_QUERY_MAX_LENGTH,
  type CommandError,
  type IssueDetail,
  type SearchResult,
} from "../shared/beads";
import { dashboardRpc, issueRpc, searchRpc, type DashboardResult } from "../shared/rpc";
import {
  dashboardRefreshRevision,
  issueFocusRevision,
  subscribeIssueFocus,
  takeDashboardRefresh,
  takeIssueFocus,
} from "./focus";
import { buildBoard, type BoardGrouping } from "./board";
import { BoardView } from "./board-view";
import { authorityLabel, authorityTone, errorLabel, relativeAge, toneColor } from "./format";
import { OverviewView } from "./overview-view";
import { buildProject, isParked, workIn, type ProjectModel } from "./project";
import {
  AlertRow,
  BlockerRow,
  Empty,
  IssueDetailView,
  SearchResultRow,
  SectionHeader,
  TrackBlock,
  WorkRow,
} from "./rows";
import { createPanelStyles, type PanelStyles } from "./styles";

const DASHBOARD_STALE_MS = 10_000;

/** Currently inspected issue id, or nothing selected. */
type Selection = string | null;

/** Submitted search text, or nothing submitted yet. */
type SubmittedQuery = string | null;

/** Mutually exclusive operational modes of the master pane. */
type ViewMode = "overview" | "board" | "plan" | "risks";

/** The list-shaped views that share one renderer. */
type ListMode = "plan" | "risks";

interface ViewSpec {
  readonly mode: ViewMode;
  readonly label: string;
  /** `null` when the `bv` section backing this view is unavailable; `undefined` shows no count. */
  readonly count?: number | null;
}

export function BeadsPanel(props: PluginWorkspacePanelProps) {
  return <BeadsWorkspacePanel key={props.workspaceId} {...props} />;
}

function BeadsWorkspacePanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  const styles = useMemo(() => createPanelStyles(theme, layout.compact), [theme, layout.compact]);
  const workspaceName = useWorkspace(workspaceId, (workspace) => workspace.name);
  const forceDashboardRefresh = useRef(false);
  const listScrollRef = useRef<ScrollView | null>(null);
  const listScrollOffset = useRef(0);
  const pendingListRestore = useRef(false);

  const fetchDashboard = useRpc(dashboardRpc);
  const fetchSearch = useRpc(searchRpc);
  const fetchIssue = useRpc(issueRpc);

  const [selectedId, setSelectedId] = useState<Selection>(null);
  const [queryText, setQueryText] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState<SubmittedQuery>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  // The board's own controls: how lanes are grouped, and whether finished work
  // is shown. Done work is hidden by default because a mature project buries
  // its live issues under closed ones.
  const [boardGrouping, setBoardGrouping] = useState<BoardGrouping>("package");
  const [showDone, setShowDone] = useState(false);

  // Slash commands and Command Center actions may target the panel before it mounts.
  const focusRevision = useSyncExternalStore(subscribeIssueFocus, issueFocusRevision, issueFocusRevision);
  const refreshRevision = useSyncExternalStore(
    subscribeIssueFocus,
    dashboardRefreshRevision,
    dashboardRefreshRevision,
  );
  useEffect(() => {
    const requested = takeIssueFocus(workspaceId);
    if (requested !== null) setSelectedId(requested);
  }, [workspaceId, focusRevision]);

  const dashboard = useQuery({
    queryKey: ["beads", "dashboard", workspaceId],
    queryFn: () => {
      const refresh = forceDashboardRefresh.current;
      forceDashboardRefresh.current = false;
      return fetchDashboard({ workspaceId, refresh });
    },
    staleTime: DASHBOARD_STALE_MS,
  });

  useEffect(() => {
    if (!takeDashboardRefresh(workspaceId)) return;
    forceDashboardRefresh.current = true;
    void dashboard.refetch({ cancelRefetch: true });
  }, [workspaceId, refreshRevision, dashboard.refetch]);

  const search = useQuery({
    queryKey: ["beads", "search", workspaceId, submittedQuery],
    queryFn: () => fetchSearch({ workspaceId, query: submittedQuery ?? "", limit: SEARCH_LIMIT_DEFAULT }),
    enabled: submittedQuery !== null && submittedQuery.length > 0,
  });

  const issue = useQuery({
    queryKey: ["beads", "issue", workspaceId, selectedId],
    queryFn: () => fetchIssue({ workspaceId, issueId: selectedId ?? "" }),
    enabled: selectedId !== null && selectedId.length > 0,
  });

  const refresh = useCallback(() => {
    // One refetch owns the query key, so React Query cannot deduplicate away the
    // server-side cache bypass.
    forceDashboardRefresh.current = true;
    void dashboard.refetch({ cancelRefetch: true });
  }, [dashboard]);

  const exitSearch = useCallback(() => {
    setSubmittedQuery(null);
    setQueryText("");
  }, []);

  const submitSearch = useCallback(() => {
    const trimmed = queryText.trim();
    if (trimmed.length === 0) {
      exitSearch();
      return;
    }
    // Re-submitting the same query must still re-read bv; setting identical
    // state would otherwise leave the Search button as a no-op.
    if (trimmed === submittedQuery) {
      void search.refetch({ cancelRefetch: false });
      return;
    }
    setSubmittedQuery(trimmed);
  }, [exitSearch, queryText, search.refetch, submittedQuery]);

  const clearSelection = useCallback(() => {
    if (layout.compact && listScrollOffset.current > 0) pendingListRestore.current = true;
    setSelectedId(null);
  }, [layout.compact]);

  const listIdentity = submittedQuery === null ? `view:${viewMode}` : `search:${submittedQuery}`;
  useEffect(() => {
    // A different operational view or query is a different list and starts at
    // the top. Keeping this ref in sync also prevents compact Back from
    // restoring an offset captured from the previous list.
    listScrollOffset.current = 0;
    pendingListRestore.current = false;
  }, [listIdentity]);

  const data = dashboard.data ?? null;
  const authority = data?.source?.authority ?? null;
  const railTone = data === null ? "neutral" : data.tool.available ? authorityTone(authority) : "danger";

  // Derived above every early return so hook order stays stable across states.
  const project = useMemo(() => projectFor(data), [data]);
  const boardModel = useMemo(
    () => buildBoard(project, boardGrouping, showDone),
    [project, boardGrouping, showDone],
  );
  const boardActive = submittedQuery === null && viewMode === "board";

  const views: readonly ViewSpec[] = useMemo(() => viewSpecs(data, project), [data, project]);
  const activeViewLabel = views.find((view) => view.mode === viewMode)?.label ?? "Overview";
  const searchActive = submittedQuery !== null;

  // One status line: where the project stands, then how fresh that is. Source
  // provenance is for diagnosing the tool, so it appears only when the source
  // is not healthy; the rail colour carries it otherwise.
  const statusLine = useMemo(() => {
    if (dashboard.isPending) return "Reading bv analysis…";
    if (data === null) return workspaceName ?? workspaceId;
    const authority = data.source?.authority ?? null;
    const counts = data.counts;
    const figures = project.complete
      ? [
          `${project.counts.done}/${project.work.length} done`,
          `${project.counts.active} in progress`,
          `${project.counts.ready} ready`,
          `${project.counts.waiting} waiting`,
          project.counts.held === 0 ? null : `${project.counts.held} held`,
        ]
      : counts === null
        ? []
        : [
            `${counts.open} open`,
            `${counts.inProgress} in progress`,
            `${counts.actionable} actionable`,
            counts.waiting === null ? null : `${counts.waiting} waiting`,
          ];
    const age = relativeAge(data.source?.generatedAt ?? null);
    return [
      workspaceName ?? workspaceId,
      ...figures,
      project.truncated ? "some closed issues not loaded" : null,
      age === null ? null : `read ${age}${data.cached ? " (cached)" : ""}`,
      authorityTone(authority) === "success" ? null : `source ${authorityLabel(authority)}`,
    ]
      .filter((part): part is string => part !== null && part.length > 0)
      .join("  ·  ");
  }, [dashboard.isPending, data, project, workspaceName, workspaceId]);

  const refreshButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Refresh Beads analysis"
      accessibilityState={{ busy: dashboard.isFetching }}
      onPress={refresh}
      style={({ pressed }) => [styles.action, pressed ? styles.actionPressed : null]}
    >
      <Text style={styles.actionText}>{dashboard.isFetching ? "Reading…" : "Refresh"}</Text>
    </Pressable>
  );

  /** The panel's only chrome: one control row over one status line. */
  const header = (
    <View style={styles.topBar}>
      <View style={styles.toolbarRow}>
        <View style={[styles.rail, { backgroundColor: toneColor(theme, railTone) }]} />
        <ViewSwitcher styles={styles} views={views} viewMode={viewMode} onSelect={setViewMode} />
        <View style={styles.searchRow}>
          <TextInput
            accessibilityLabel="Search Beads issues"
            placeholder="Search issues"
            placeholderTextColor={theme.colors.foregroundMuted}
            value={queryText}
            onChangeText={setQueryText}
            onSubmitEditing={submitSearch}
            maxLength={SEARCH_QUERY_MAX_LENGTH}
            returnKeyType="search"
            style={styles.input}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Run Beads search"
            onPress={submitSearch}
            style={({ pressed }) => [styles.action, pressed ? styles.actionPressed : null]}
          >
            <Text style={styles.actionText}>Search</Text>
          </Pressable>
        </View>
        {refreshButton}
      </View>
      <Text style={styles.subtitle} numberOfLines={layout.compact ? 2 : 1}>
        {statusLine}
      </Text>
    </View>
  );

  const requestFailure = dashboard.isError ? (
    <View style={styles.banner}>
      <Text style={styles.danger} accessibilityLabel="Beads analysis failed">
        The Beads analysis request failed.{" "}
        {dashboard.error instanceof Error ? dashboard.error.message : "Unknown error."}
      </Text>
    </View>
  ) : null;

  // Compact drill-in: the inspector fully replaces the dashboard screen.
  if (layout.compact && selectedId !== null) {
    return (
      <View style={styles.screen}>
        <View style={styles.topBar}>
          <View style={styles.backRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to the Beads dashboard"
              onPress={clearSelection}
              style={({ pressed }) => [styles.action, pressed ? styles.actionPressed : null]}
            >
              <Text style={styles.actionText}>← Back</Text>
            </Pressable>
            <View style={styles.headerText}>
              <Text style={styles.title}>Issue detail</Text>
              <Text style={styles.subtitle}>{selectedId}</Text>
            </View>
          </View>
        </View>
        <ScrollView key={selectedId} style={styles.paneScroll} contentContainerStyle={styles.detailContent}>
          <IssueInspectorBody styles={styles} theme={theme} issue={issue} />
        </ScrollView>
      </View>
    );
  }

  const notice = data === null ? null : noticeFor(data);
  if (data === null || notice !== null) {
    return (
      <View style={styles.screen}>
        {header}
        {requestFailure}
        <ScrollView style={styles.paneScroll} contentContainerStyle={styles.noticeContent}>
          {notice === null ? (
            dashboard.isPending ? <Empty styles={styles} theme={theme} message="Loading…" /> : null
          ) : (
            <View style={styles.stateBlock}>
              <Text
                style={notice.tone === "danger" ? styles.danger : styles.body}
                accessibilityLabel={notice.accessibilityLabel}
              >
                {notice.headline}
              </Text>
              <Text style={styles.muted}>{notice.detail}</Text>
            </View>
          )}
          {selectedId === null ? null : (
            <View style={styles.stateBlock}>
              <SectionHeader styles={styles} theme={theme} title="Issue detail" meta={selectedId} />
              <IssueInspectorBody styles={styles} theme={theme} issue={issue} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear the selected issue"
                onPress={clearSelection}
                style={({ pressed }) => [styles.action, styles.actionInline, pressed ? styles.actionPressed : null]}
              >
                <Text style={styles.actionText}>Clear selection</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

  const searchNotice = searchActive ? (
    <View style={styles.backRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Leave search results and return to ${activeViewLabel}`}
        onPress={exitSearch}
        style={({ pressed }) => [styles.action, pressed ? styles.actionPressed : null]}
      >
        <Text style={styles.actionText}>← {activeViewLabel}</Text>
      </Pressable>
      <Text style={styles.muted}>Search results for “{submittedQuery}”</Text>
    </View>
  ) : null;

  const board = (
    <BoardView
      styles={styles}
      theme={theme}
      project={project}
      board={boardModel}
      compact={layout.compact}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onGroupingChange={setBoardGrouping}
      onShowDoneChange={setShowDone}
    />
  );

  const masterList = searchActive ? (
    <SearchList
      styles={styles}
      theme={theme}
      search={search}
      submittedQuery={submittedQuery}
      selectedId={selectedId}
      onSelect={setSelectedId}
    />
  ) : viewMode === "board" ? null : viewMode === "overview" ? (
    <OverviewView
      styles={styles}
      theme={theme}
      project={project}
      health={data.health}
      recommendations={data.sections.triage.status === "ok" ? data.recommendations : []}
      selectedId={selectedId}
      onSelect={setSelectedId}
    />
  ) : (
    <ListView
      styles={styles}
      theme={theme}
      data={data}
      project={project}
      viewMode={viewMode}
      selectedId={selectedId}
      onSelect={setSelectedId}
    />
  );

  if (layout.compact) {
    return (
      <View style={styles.screen}>
        {header}
        {requestFailure}
        <ScrollView
          key={listIdentity}
          ref={listScrollRef}
          style={styles.paneScroll}
          contentContainerStyle={styles.paneContent}
          onScroll={(event) => {
            listScrollOffset.current = event.nativeEvent.contentOffset.y;
          }}
          onContentSizeChange={() => {
            if (!pendingListRestore.current) return;
            listScrollRef.current?.scrollTo({ y: listScrollOffset.current, animated: false });
            pendingListRestore.current = false;
          }}
          scrollEventThrottle={16}
        >
          {searchNotice}
          {boardActive ? board : masterList}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {header}
      {requestFailure}
      <View style={styles.workbench}>
        {/* Board view needs the width; operational views favour the working list 5:4. */}
        <View
          style={[
            styles.masterPane,
            boardActive ? styles.masterPaneWide : null,
            selectedId === null ? styles.masterPaneAlone : null,
          ]}
        >
          {boardActive ? (
            board
          ) : (
            <ScrollView
              key={listIdentity}
              style={styles.paneScroll}
              contentContainerStyle={styles.paneContent}
            >
              {searchNotice}
              {masterList}
            </ScrollView>
          )}
        </View>
        {/* An empty inspector is a third of the panel spent on a sentence. The
            pane appears when there is an issue to read and gives the width back
            when there is not. */}
        {selectedId === null ? null : (
          <View style={[styles.detailPane, boardActive ? styles.detailPaneNarrow : null]}>
            <ScrollView key={selectedId} style={styles.paneScroll} contentContainerStyle={styles.detailContent}>
              <>
                <View style={styles.backRow}>
                  <View style={styles.headerText}>
                    <SectionHeader styles={styles} theme={theme} title="Issue detail" meta={selectedId} />
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Clear the selected issue"
                    onPress={clearSelection}
                    style={({ pressed }) => [
                      styles.action,
                      styles.actionInline,
                      pressed ? styles.actionPressed : null,
                    ]}
                  >
                    <Text style={styles.actionText}>Clear</Text>
                  </Pressable>
                </View>
                <IssueInspectorBody styles={styles} theme={theme} issue={issue} />
              </>
            </ScrollView>
          </View>
        )}
      </View>
    </View>
  );
}

/** A whole-panel state that replaces the workbench: no analysis to lay out. */
interface Notice {
  readonly tone: "danger" | "neutral";
  readonly headline: string;
  readonly detail: string;
  readonly accessibilityLabel: string;
}

function noticeFor(data: DashboardResult): Notice | null {
  if (!data.tool.available) {
    return {
      tone: "danger",
      headline: errorLabel(data.tool.error),
      detail:
        (data.tool.error?.code === "unavailable"
          ? "Install the bv CLI on the daemon machine and refresh."
          : "Resolve the workspace path or connection error above, then refresh.") +
        " This panel only runs read-only commands.",
      accessibilityLabel: "bv is unavailable",
    };
  }
  if (data.projectState === "missing") {
    return {
      tone: "neutral",
      headline: "No Beads project in this workspace.",
      detail:
        "bv found no .beads source here. Initialise Beads with br or bd in this directory, then refresh.",
      accessibilityLabel: "No Beads project in this workspace",
    };
  }
  if (data.projectState === "error") {
    return {
      tone: "danger",
      headline: errorLabel(data.sections.triage.error),
      detail: "The Beads source could not be analysed. Nothing was written; retry after fixing the source.",
      accessibilityLabel: "The Beads analysis could not be read",
    };
  }
  return null;
}

function viewSpecs(data: DashboardResult | null, project: ProjectModel): readonly ViewSpec[] {
  if (data === null) {
    return [
      { mode: "overview", label: "Overview" },
      { mode: "board", label: "Board", count: null },
      { mode: "plan", label: "Plan", count: null },
      { mode: "risks", label: "Risks", count: null },
    ];
  }
  const graphOk = data.sections.graph.status === "ok";
  const planOk = data.sections.plan.status === "ok";
  const risks = riskCount(data, project);
  return [
    { mode: "overview", label: "Overview" },
    {
      mode: "board",
      label: "Board",
      // Live work on the board; null only when no source at all could be read.
      count:
        !graphOk && data.sections.triage.status !== "ok" && !planOk
          ? null
          : project.work.length - project.counts.done,
    },
    { mode: "plan", label: "Plan", count: planOk ? planTracks(data, project).length : null },
    { mode: "risks", label: "Risks", count: risks },
  ];
}

/**
 * What the Risks badge counts: stuck work (held, but not deliberately parked),
 * a dependency cycle, and alerts `bv` rated critical or warning. Informational
 * alerts, parked work and keystones are listed but not counted, so the badge is
 * zero when nothing needs a decision. It is unknown, not zero, unless every
 * source it counts was read.
 */
function riskCount(data: DashboardResult, project: ProjectModel): number | null {
  if (!risksKnown(data, project)) return null;
  const serious = data.alerts.filter((alert) => isSerious(alert.severity)).length;
  const stuck = workIn(project, "held").filter((item) => !isParked(item.status)).length;
  return stuck + (hasCycle(data, project) ? 1 : 0) + serious;
}

/** True when the alerts, the cycle check and the whole graph were all read. */
function risksKnown(data: DashboardResult, project: ProjectModel): boolean {
  return data.sections.alerts.status === "ok" && data.health?.hasCycles != null && project.complete;
}

function hasCycle(data: DashboardResult, project: ProjectModel): boolean {
  return data.health?.hasCycles === true || project.chainCycle;
}

function isSerious(severity: string): boolean {
  const normalized = severity.trim().toLowerCase();
  return normalized === "critical" || normalized === "warning";
}

/**
 * Plan tracks with their containers removed: `bv` lists an epic as actionable
 * when nothing blocks it, but nobody works on an epic directly.
 */
function planTracks(data: DashboardResult, project: ProjectModel): DashboardResult["tracks"] {
  return data.tracks
    .map((track) => ({ ...track, items: track.items.filter((item) => project.byId.get(item.id)?.container !== true) }))
    .filter((track) => track.items.length > 0);
}

const EMPTY_PROJECT_INPUT = {
  graphAvailable: false,
  issues: [],
  truncated: false,
  recommendations: [],
  tracks: [],
} as const;

/**
 * The project is the whole issue graph; triage and plan only add score, action
 * and track membership. A degraded section contributes nothing rather than an
 * invented state.
 */
function projectFor(data: DashboardResult | null): ProjectModel {
  if (data === null) return buildProject(EMPTY_PROJECT_INPUT);
  const graphOk = data.sections.graph.status === "ok";
  return buildProject({
    graphAvailable: graphOk,
    issues: graphOk ? data.board.issues : [],
    truncated: graphOk && data.board.truncated,
    recommendations: data.sections.triage.status === "ok" ? data.recommendations : [],
    tracks: data.sections.plan.status === "ok" ? data.tracks : [],
  });
}

function ViewSwitcher({
  styles,
  views,
  viewMode,
  onSelect,
}: {
  styles: PanelStyles;
  views: readonly ViewSpec[];
  viewMode: ViewMode;
  onSelect: (mode: ViewMode) => void;
}) {
  return (
    <View style={styles.switcherRow} accessibilityRole="tablist" accessibilityLabel="Beads operational views">
      {views.map((view) => {
        const selected = view.mode === viewMode;
        return (
          <Pressable
            key={view.mode}
            accessibilityRole="tab"
            accessibilityLabel={
              view.count === undefined
                ? `${view.label} view`
                : view.count === null
                  ? `${view.label} view, unavailable`
                  : `${view.label} view, ${view.count} item${view.count === 1 ? "" : "s"}`
            }
            accessibilityState={{ selected }}
            onPress={() => onSelect(view.mode)}
            style={({ pressed }) => [
              styles.switcherItem,
              selected ? styles.switcherItemSelected : null,
              pressed && !selected ? styles.railRowSelected : null,
            ]}
          >
            <Text style={[styles.switcherLabel, selected ? styles.switcherLabelSelected : null]}>
              {view.label}
            </Text>
            {view.count === undefined ? null : (
              <Text style={styles.switcherCount}>{view.count === null ? "—" : view.count}</Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

function ListView({
  styles,
  theme,
  data,
  project,
  viewMode,
  selectedId,
  onSelect,
}: {
  styles: PanelStyles;
  theme: PluginWorkspacePanelProps["theme"];
  data: DashboardResult;
  project: ProjectModel;
  viewMode: ListMode;
  selectedId: Selection;
  onSelect: (issueId: string) => void;
}) {
  if (viewMode === "plan") {
    const tracks = planTracks(data, project);
    // bv's own count, since the payload caps how many tracks it carries.
    const trackTotal = Math.max(data.planSummary?.totalTracks ?? 0, tracks.length);
    return (
      <View style={styles.listGroup}>
        <SectionHeader
          styles={styles}
          theme={theme}
          title="Execution tracks"
          meta={
            data.sections.plan.status !== "ok"
              ? "unavailable"
              : trackTotal > data.tracks.length
                ? `${trackTotal} parallel · ${tracks.length} shown`
                : `${tracks.length} parallel`
          }
        />
        {data.sections.plan.status !== "ok" ? (
          <Text style={styles.danger}>{errorLabel(data.sections.plan.error)}</Text>
        ) : tracks.length === 0 ? (
          <Empty styles={styles} theme={theme} message="bv found no work that can start, so there is no track." />
        ) : (
          <>
            <Text style={styles.muted}>
              {trackTotal === 1
                ? "One track: everything that can start now shares its dependencies, so a second agent would contend with the first."
                : `${trackTotal} independent tracks: work in different tracks shares no dependency, so agents can take one each.`}
            </Text>
            {tracks.map((track) => (
              <TrackBlock
                key={track.id}
                styles={styles}
                theme={theme}
                track={track}
                selectedId={selectedId}
                onSelect={onSelect}
              />
            ))}
          </>
        )}
      </View>
    );
  }

  return <RisksView styles={styles} theme={theme} data={data} project={project} selectedId={selectedId} onSelect={onSelect} />;
}

/**
 * Risks lead with what needs a decision — held work, a cycle, serious alerts —
 * and keep informational alerts folded, so a heuristic like "potential
 * duplicate" cannot drown the real signal or inflate the badge.
 */
function RisksView({
  styles,
  theme,
  data,
  project,
  selectedId,
  onSelect,
}: {
  styles: PanelStyles;
  theme: PluginWorkspacePanelProps["theme"];
  data: DashboardResult;
  project: ProjectModel;
  selectedId: Selection;
  onSelect: (issueId: string) => void;
}) {
  const [showInfo, setShowInfo] = useState(false);
  const held = workIn(project, "held");
  const stuck = held.filter((item) => !isParked(item.status));
  const alertsOk = data.sections.alerts.status === "ok";
  const serious = alertsOk ? data.alerts.filter((alert) => isSerious(alert.severity)) : [];
  const info = alertsOk ? data.alerts.filter((alert) => !isSerious(alert.severity)) : [];
  const cycles = hasCycle(data, project);
  // An all-clear is only claimed when every source behind it was read.
  const known = risksKnown(data, project);
  const nothing = known && stuck.length === 0 && serious.length === 0 && !cycles;

  return (
    <View style={styles.listGroup}>
      {nothing ? (
        <Text style={styles.body}>
          Nothing needs a decision: no stuck work, no dependency cycle, no serious alert.
          {held.length === 0 ? "" : ` ${held.length} parked issue${held.length === 1 ? " is" : "s are"} listed below.`}
        </Text>
      ) : null}
      {known ? null : (
        <Text style={styles.muted}>
          Some sources could not be read, so this list may be incomplete: {[
            data.sections.alerts.status === "ok" ? null : "alerts",
            data.health?.hasCycles != null ? null : "cycle check",
            project.complete ? null : "whole-project graph",
          ]
            .filter((part): part is string => part !== null)
            .join(", ")}
          .
        </Text>
      )}
      {cycles ? (
        <Text style={styles.danger}>
          bv found a dependency cycle. Work on the cycle can never become ready until one dependency is removed.
        </Text>
      ) : null}
      {held.length === 0 ? null : (
        <>
          <SectionHeader styles={styles} theme={theme} title="Held" meta={`${held.length}`} />
          {held.map((item) => (
            <WorkRow
              key={item.id}
              styles={styles}
              theme={theme}
              item={item}
              showState
              showPriority={project.priorityVaries}
              selected={selectedId === item.id}
              onSelect={onSelect}
            />
          ))}
        </>
      )}

      <SectionHeader
        styles={styles}
        theme={theme}
        title="Alerts"
        meta={alertsOk ? `${serious.length} serious · ${info.length} informational` : "unavailable"}
      />
      {!alertsOk ? (
        <Text style={styles.danger}>{errorLabel(data.sections.alerts.error)}</Text>
      ) : serious.length === 0 && info.length === 0 ? (
        <Empty styles={styles} theme={theme} message="No alert is open." />
      ) : (
        <>
          {serious.map((alert, index) => (
            <AlertRow
              key={`${alert.type}:${alert.issueId ?? index}`}
              styles={styles}
              theme={theme}
              alert={alert}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
          {info.length === 0 ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showInfo }}
              accessibilityLabel={`${showInfo ? "Hide" : "Show"} ${info.length} informational alerts`}
              onPress={() => setShowInfo((current) => !current)}
              style={({ pressed }) => [styles.action, styles.actionInline, pressed ? styles.actionPressed : null]}
            >
              <Text style={styles.actionText}>
                {showInfo ? "Hide" : "Show"} {info.length} informational alert{info.length === 1 ? "" : "s"}
              </Text>
            </Pressable>
          )}
          {!showInfo
            ? null
            : info.map((alert, index) => (
                <AlertRow
                  key={`${alert.type}:${alert.issueId ?? index}`}
                  styles={styles}
                  theme={theme}
                  alert={alert}
                  selectedId={selectedId}
                  onSelect={onSelect}
                />
              ))}
        </>
      )}

      <SectionHeader
        styles={styles}
        theme={theme}
        title="Keystones"
        meta={data.sections.triage.status === "ok" ? `${data.blockers.length}` : "unavailable"}
      />
      {data.sections.triage.status !== "ok" ? (
        <Text style={styles.danger}>{errorLabel(data.sections.triage.error)}</Text>
      ) : data.blockers.length === 0 ? (
        <Empty styles={styles} theme={theme} message="Nothing is holding up downstream work." />
      ) : (
        <>
          <Text style={styles.muted}>Finishing these unblocks the most downstream work, by bv's analysis.</Text>
          {data.blockers.map((blocker) => (
            <BlockerRow
              key={blocker.id}
              styles={styles}
              theme={theme}
              blocker={blocker}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </>
      )}
    </View>
  );
}

/** The slice of a React Query result the presentational bodies actually read. */
interface QueryState<TData> {
  readonly isPending: boolean;
  readonly data: TData | undefined;
}

type SearchQueryState = QueryState<{
  readonly query: string;
  readonly results: readonly SearchResult[];
  readonly error: CommandError | null;
}>;

type IssueQueryState = QueryState<{
  readonly issue: IssueDetail | null;
  readonly error: CommandError | null;
}>;

function SearchList({
  styles,
  theme,
  search,
  submittedQuery,
  selectedId,
  onSelect,
}: {
  styles: PanelStyles;
  theme: PluginWorkspacePanelProps["theme"];
  search: SearchQueryState;
  submittedQuery: SubmittedQuery;
  selectedId: Selection;
  onSelect: (issueId: string) => void;
}) {
  return (
    <View style={styles.listGroup}>
      <SectionHeader
        styles={styles}
        theme={theme}
        title="Search results"
        meta={search.data?.error === null ? `${search.data.results.length} found` : null}
      />
      {submittedQuery === null ? null : search.isPending ? (
        <Empty styles={styles} theme={theme} message="Searching…" />
      ) : search.data === undefined ? (
        <Text style={styles.danger}>The search request failed.</Text>
      ) : search.data.error !== null ? (
        <Text style={styles.danger}>{errorLabel(search.data.error)}</Text>
      ) : search.data.results.length === 0 ? (
        <Empty styles={styles} theme={theme} message={`No issue matched “${search.data.query}”.`} />
      ) : (
        search.data.results.map((result) => (
          <SearchResultRow
            key={result.id}
            styles={styles}
            theme={theme}
            result={result}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))
      )}
    </View>
  );
}

function IssueInspectorBody({
  styles,
  theme,
  issue,
}: {
  styles: PanelStyles;
  theme: PluginWorkspacePanelProps["theme"];
  issue: IssueQueryState;
}) {
  if (issue.isPending) return <Empty styles={styles} theme={theme} message="Reading issue…" />;
  if (issue.data === undefined) return <Text style={styles.danger}>The issue request failed.</Text>;
  if (issue.data.issue === null) return <Text style={styles.danger}>{errorLabel(issue.data.error)}</Text>;
  return <IssueDetailView styles={styles} theme={theme} issue={issue.data.issue} />;
}

