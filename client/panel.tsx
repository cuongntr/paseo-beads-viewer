import { type PluginWorkspacePanelProps, useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SEARCH_LIMIT_DEFAULT, SEARCH_QUERY_MAX_LENGTH } from "../shared/beads";
import { dashboardRpc, issueRpc, searchRpc, type DashboardResult } from "../shared/rpc";
import {
  dashboardRefreshRevision,
  issueFocusRevision,
  subscribeIssueFocus,
  takeDashboardRefresh,
  takeIssueFocus,
} from "./focus";
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

export function BeadsPanel(props: PluginWorkspacePanelProps) {
  return <BeadsWorkspacePanel key={props.workspaceId} {...props} />;
}

function BeadsWorkspacePanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  const styles = useMemo(() => createPanelStyles(theme, layout.compact), [theme, layout.compact]);
  const workspaceName = useWorkspace(workspaceId, (workspace) => workspace.name);
  const forceDashboardRefresh = useRef(false);

  const fetchDashboard = useRpc(dashboardRpc);
  const fetchSearch = useRpc(searchRpc);
  const fetchIssue = useRpc(issueRpc);

  const [selectedId, setSelectedId] = useState<Selection>(null);
  const [queryText, setQueryText] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState<SubmittedQuery>(null);

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

  const submitSearch = useCallback(() => {
    const trimmed = queryText.trim();
    setSubmittedQuery(trimmed.length === 0 ? null : trimmed);
  }, [queryText]);

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

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
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

        {dashboard.isError ? (
          <Text style={styles.danger} accessibilityLabel="Beads analysis failed">
            The Beads analysis request failed.{" "}
            {dashboard.error instanceof Error ? dashboard.error.message : "Unknown error."}
          </Text>
        ) : null}

        {data === null ? (
          dashboard.isPending ? <Empty styles={styles} theme={theme} message="Loading…" /> : null
        ) : (
          <BeadsBody
            data={data}
            styles={styles}
            theme={theme}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        )}

        {data !== null && data.tool.available && data.projectState === "ready" ? (
          <>
            <SectionHeader styles={styles} theme={theme} title="Search" meta={`max ${SEARCH_QUERY_MAX_LENGTH} chars`} />
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
                  onSelect={setSelectedId}
                />
              ))
            )}
          </>
        ) : null}

        {selectedId === null ? null : (
          <>
            <SectionHeader styles={styles} theme={theme} title="Issue detail" meta={selectedId} />
            {issue.isPending ? (
              <Empty styles={styles} theme={theme} message="Reading issue…" />
            ) : issue.data === undefined ? (
              <Text style={styles.danger}>The issue request failed.</Text>
            ) : issue.data.issue === null ? (
              <Text style={styles.danger}>{errorLabel(issue.data.error)}</Text>
            ) : (
              <IssueDetailView styles={styles} theme={theme} issue={issue.data.issue} />
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear the selected issue"
              onPress={() => setSelectedId(null)}
              style={({ pressed }) => [styles.action, { alignSelf: "flex-start" }, pressed ? styles.actionPressed : null]}
            >
              <Text style={styles.actionText}>Clear selection</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function BeadsBody({
  data,
  styles,
  theme,
  selectedId,
  onSelect,
}: {
  data: DashboardResult;
  styles: PanelStyles;
  theme: PluginWorkspacePanelProps["theme"];
  selectedId: Selection;
  onSelect: (issueId: string) => void;
}) {
  const authority = data.source?.authority ?? null;

  if (!data.tool.available) {
    return (
      <View style={{ gap: 6 }}>
        <Text style={styles.danger} accessibilityLabel="bv is unavailable">
          {errorLabel(data.tool.error)}
        </Text>
        <Text style={styles.muted}>
          {data.tool.error?.code === "unavailable"
            ? "Install the bv CLI on the daemon machine and refresh."
            : "Resolve the workspace path or connection error above, then refresh."} This panel only runs read-only commands.
        </Text>
      </View>
    );
  }

  if (data.projectState === "missing") {
    return (
      <View style={{ gap: 6 }}>
        <Text style={styles.body} accessibilityLabel="No Beads project in this workspace">
          No Beads project in this workspace.
        </Text>
        <Text style={styles.muted}>
          bv found no .beads source here. Initialise Beads with br or bd in this directory, then refresh.
        </Text>
      </View>
    );
  }

  if (data.projectState === "error") {
    return (
      <View style={{ gap: 6 }}>
        <Text style={styles.danger} accessibilityLabel="The Beads analysis could not be read">
          {errorLabel(data.sections.triage.error)}
        </Text>
        <Text style={styles.muted}>
          The Beads source could not be analysed. Nothing was written; retry after fixing the source.
        </Text>
      </View>
    );
  }

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
    <View style={{ gap: 6 }}>
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

      <View style={styles.divider} />

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
