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
import { buildBoard, type BoardModel } from "./board";
import { BoardView } from "./board-view";
import { authorityLabel, authorityTone, errorLabel, relativeAge, shortHash, toneColor } from "./format";
import {
  AlertRow,
  BlockerRow,
  Empty,
  IssueDetailView,
  RailRow,
  RecommendationRow,
  SearchResultRow,
  SectionHeader,
  TrackBlock,
} from "./rows";
import { createPanelStyles, type PanelStyles } from "./styles";

const DASHBOARD_STALE_MS = 10_000;

/** Currently inspected issue id, or nothing selected. */
type Selection = string | null;

/** Submitted search text, or nothing submitted yet. */
type SubmittedQuery = string | null;

/** Mutually exclusive operational modes of the master pane. */
type ViewMode = "next" | "plan" | "risks" | "board";

/** The list-shaped views; `board` has its own component and pane proportions. */
type OperationalMode = Exclude<ViewMode, "board">;

interface ViewSpec {
  readonly mode: ViewMode;
  readonly label: string;
  /** `null` when the `bv` section backing this view is unavailable. */
  readonly count: number | null;
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
  const [viewMode, setViewMode] = useState<ViewMode>("next");

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

  const headerSubtitle = useMemo(() => {
    if (dashboard.isPending) return "Reading bv analysis…";
    if (data === null) return workspaceName ?? workspaceId;
    const parts = [
      workspaceName ?? workspaceId,
      data.tool.version,
      data.tracker.kind === null ? "tracker unknown" : `tracker ${data.tracker.kind}`,
      data.cached ? "cached" : null,
    ].filter((part): part is string => part !== null && part.length > 0);
    return parts.join("  ·  ");
  }, [dashboard.isPending, data, workspaceName, workspaceId]);

  // Derived above every early return so hook order stays stable across states.
  const boardModel = useMemo(() => boardFor(data), [data]);
  const boardMissingSources = useMemo(() => boardGaps(data), [data]);
  const boardActive = submittedQuery === null && viewMode === "board";

  const views: readonly ViewSpec[] = useMemo(() => viewSpecs(data), [data]);
  const activeViewLabel = views.find((view) => view.mode === viewMode)?.label ?? "Next up";
  const searchActive = submittedQuery !== null;

  const header = (
    <View style={styles.topBar}>
      <View style={styles.headerRow}>
        <View style={[styles.rail, { backgroundColor: toneColor(theme, railTone) }]} />
        <View style={styles.headerText}>
          <Text style={styles.title}>Beads</Text>
          <Text style={styles.subtitle}>{headerSubtitle}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh Beads analysis"
          accessibilityState={{ busy: dashboard.isFetching }}
          onPress={refresh}
          style={({ pressed }) => [styles.action, pressed ? styles.actionPressed : null]}
        >
          <Text style={styles.actionText}>{dashboard.isFetching ? "Reading…" : "Refresh"}</Text>
        </Pressable>
      </View>
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

  const summary = <ProjectSummary styles={styles} theme={theme} data={data} />;

  const masterControls = (
    <>
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
      {searchActive ? (
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
      ) : (
        <ViewSwitcher styles={styles} views={views} viewMode={viewMode} onSelect={setViewMode} />
      )}
    </>
  );

  const board = (
    <BoardView
      styles={styles}
      theme={theme}
      board={boardModel}
      compact={layout.compact}
      totalTracked={data.counts?.total ?? null}
      missingSources={boardMissingSources}
      selectedId={selectedId}
      onSelect={setSelectedId}
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
  ) : viewMode === "board" ? null : (
    <OperationalView
      styles={styles}
      theme={theme}
      data={data}
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
          {summary}
          <View style={styles.divider} />
          <View style={styles.controlStack}>{masterControls}</View>
          {boardActive ? board : masterList}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {header}
      {requestFailure}
      <View style={styles.summaryBar}>{summary}</View>
      <View style={styles.workbench}>
        {/* Board view needs the width; operational views favour the working list 5:4. */}
        <View style={[styles.masterPane, boardActive ? styles.masterPaneWide : null]}>
          <View style={styles.masterHeader}>{masterControls}</View>
          {boardActive ? (
            board
          ) : (
            <ScrollView
              key={listIdentity}
              style={styles.paneScroll}
              contentContainerStyle={styles.paneContent}
            >
              {masterList}
            </ScrollView>
          )}
        </View>
        <View style={[styles.detailPane, boardActive ? styles.detailPaneNarrow : null]}>
          <ScrollView key={selectedId ?? "empty"} style={styles.paneScroll} contentContainerStyle={styles.detailContent}>
            {selectedId === null ? (
              <View style={styles.stateBlock}>
                <SectionHeader styles={styles} theme={theme} title="Issue inspector" />
                <Empty
                  styles={styles}
                  theme={theme}
                  message="Select an issue on the left to read its detail here."
                />
              </View>
            ) : (
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
            )}
          </ScrollView>
        </View>
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

function viewSpecs(data: DashboardResult | null): readonly ViewSpec[] {
  if (data === null) {
    return [
      { mode: "next", label: "Next up", count: null },
      { mode: "plan", label: "Plan", count: null },
      { mode: "risks", label: "Risks", count: null },
      { mode: "board", label: "Board", count: null },
    ];
  }
  const triageOk = data.sections.triage.status === "ok";
  const alertsOk = data.sections.alerts.status === "ok";
  const riskCount =
    !triageOk && !alertsOk ? null : (triageOk ? data.blockers.length : 0) + (alertsOk ? data.alerts.length : 0);
  return [
    { mode: "next", label: "Next up", count: triageOk ? data.recommendations.length : null },
    { mode: "plan", label: "Plan", count: data.sections.plan.status === "ok" ? data.tracks.length : null },
    { mode: "risks", label: "Risks", count: riskCount },
    {
      mode: "board",
      label: "Board",
      // The board is a working set: its count is the deduplicated union of the
      // sections that actually loaded, not the project total.
      count: !triageOk && data.sections.plan.status !== "ok" ? null : boardFor(data).surfaced,
    },
  ];
}

/**
 * The board's working set: the deduplicated union of the sections that actually
 * loaded. A degraded section contributes nothing rather than an invented lane.
 */
function boardFor(data: DashboardResult | null): BoardModel {
  if (data === null) return buildBoard([], []);
  return buildBoard(
    data.sections.triage.status === "ok" ? data.recommendations : [],
    data.sections.plan.status === "ok" ? data.tracks : [],
  );
}

/** Human-readable names of the board sources `bv` could not provide. */
function boardGaps(data: DashboardResult | null): readonly string[] {
  if (data === null) return [];
  return [
    data.sections.triage.status === "ok" ? null : "triage picks",
    data.sections.plan.status === "ok" ? null : "execution tracks",
  ].filter((part): part is string => part !== null);
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
              view.count === null
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
            <Text style={styles.switcherCount}>{view.count === null ? "—" : view.count}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ProjectSummary({
  styles,
  theme,
  data,
}: {
  styles: PanelStyles;
  theme: PluginWorkspacePanelProps["theme"];
  data: DashboardResult;
}) {
  const authority = data.source?.authority ?? null;
  const counts = data.counts;
  const provenance = [
    authorityLabel(authority),
    data.source?.sourceKind ?? null,
    shortHash(data.source?.dataHash ?? null) === null ? null : `hash ${shortHash(data.source?.dataHash ?? null)}`,
    relativeAge(data.source?.generatedAt ?? null),
  ]
    .filter((part): part is string => part !== null)
    .join("  ·  ");

  return (
    <View style={styles.stateBlock}>
      <RailRow
        styles={styles}
        theme={theme}
        tone={authorityTone(authority)}
        title={authorityLabel(authority)}
        meta={provenance}
        note={
          authority === null
            ? null
            : authority.warnings.length === 0
              ? `${authority.visible} visible · ${authority.valid} valid · ${authority.tombstones} tombstones`
              : authority.warnings[0]
        }
      />
      {counts === null ? (
        <Empty styles={styles} theme={theme} message="bv returned no counts for this project." />
      ) : (
        <View style={styles.pulseRow}>
          <Pulse styles={styles} label="open" value={counts.open} />
          <Pulse styles={styles} label="ready" value={counts.actionable} />
          <Pulse styles={styles} label="blocked" value={counts.blocked} />
          <Pulse styles={styles} label="active" value={counts.inProgress} />
          <Pulse styles={styles} label="tracked" value={counts.total} />
        </View>
      )}
    </View>
  );
}

function OperationalView({
  styles,
  theme,
  data,
  viewMode,
  selectedId,
  onSelect,
}: {
  styles: PanelStyles;
  theme: PluginWorkspacePanelProps["theme"];
  data: DashboardResult;
  viewMode: OperationalMode;
  selectedId: Selection;
  onSelect: (issueId: string) => void;
}) {
  if (viewMode === "next") {
    return (
      <View style={styles.listGroup}>
        <SectionHeader
          styles={styles}
          theme={theme}
          title="Triage picks"
          meta={data.sections.triage.status === "ok" ? `${data.recommendations.length} shown` : "unavailable"}
        />
        {data.sections.triage.status !== "ok" ? (
          <Text style={styles.danger}>{errorLabel(data.sections.triage.error)}</Text>
        ) : data.recommendations.length === 0 ? (
          <Empty styles={styles} theme={theme} message="bv returned no triage recommendation for this scope." />
        ) : (
          data.recommendations.map((recommendation) => (
            <RecommendationRow
              key={recommendation.id}
              styles={styles}
              theme={theme}
              recommendation={recommendation}
              selected={selectedId === recommendation.id}
              onSelect={onSelect}
            />
          ))
        )}
      </View>
    );
  }

  if (viewMode === "plan") {
    return (
      <View style={styles.listGroup}>
        <SectionHeader
          styles={styles}
          theme={theme}
          title="Execution tracks"
          meta={
            data.sections.plan.status !== "ok"
              ? "unavailable"
              : data.planSummary === null
                ? `${data.tracks.length} tracks`
                : `${data.tracks.length} tracks · ${data.planSummary.totalActionable ?? 0} actionable · ${data.planSummary.totalBlocked ?? 0} blocked`
          }
        />
        {data.sections.plan.status !== "ok" ? (
          <Text style={styles.danger}>{errorLabel(data.sections.plan.error)}</Text>
        ) : data.tracks.length === 0 ? (
          <Empty styles={styles} theme={theme} message="bv found no parallel execution track." />
        ) : (
          data.tracks.map((track) => (
            <TrackBlock
              key={track.id}
              styles={styles}
              theme={theme}
              track={track}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))
        )}
      </View>
    );
  }

  return (
    <View style={styles.listGroup}>
      <SectionHeader styles={styles} theme={theme} title="Blockers" meta={`${data.blockers.length}`} />
      {data.sections.triage.status !== "ok" ? (
        <Text style={styles.danger}>{errorLabel(data.sections.triage.error)}</Text>
      ) : data.blockers.length === 0 ? (
        <Empty styles={styles} theme={theme} message="Nothing is blocking downstream work." />
      ) : (
        data.blockers.map((blocker) => (
          <BlockerRow
            key={blocker.id}
            styles={styles}
            theme={theme}
            blocker={blocker}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))
      )}

      <SectionHeader
        styles={styles}
        theme={theme}
        title="Alerts"
        meta={
          data.sections.alerts.status !== "ok"
            ? "unavailable"
            : data.alertSummary === null
              ? `${data.alerts.length}`
              : `${data.alertSummary.critical} critical · ${data.alertSummary.warning} warning · ${data.alertSummary.info} info`
        }
      />
      {data.sections.alerts.status !== "ok" ? (
        <Text style={styles.danger}>{errorLabel(data.sections.alerts.error)}</Text>
      ) : data.alerts.length === 0 ? (
        <Empty styles={styles} theme={theme} message="No alert is open." />
      ) : (
        data.alerts.map((alert, index) => (
          <AlertRow
            key={`${alert.type}:${alert.issueId ?? index}`}
            styles={styles}
            theme={theme}
            alert={alert}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))
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

function Pulse({
  styles,
  label,
  value,
}: {
  styles: PanelStyles;
  label: string;
  value: number;
}) {
  return (
    <View style={styles.pulseCell} accessibilityLabel={`${value} ${label}`}>
      <Text style={styles.pulseValue}>{value}</Text>
      <Text style={styles.pulseLabel}>{label}</Text>
    </View>
  );
}
