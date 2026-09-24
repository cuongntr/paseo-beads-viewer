import type { PluginTheme } from "@getpaseo/plugin";
import { Pressable, Text, View } from "react-native";
import type { ProjectHealth, Recommendation } from "../shared/beads";
import { percentDone, toneColor } from "./format";
import { workIn, type ProjectModel, type WorkPackage, type WorkRoot } from "./project";
import { Empty, facetContext, ProgressBar, RecommendationRow, SectionHeader, WorkRow } from "./rows";
import type { PanelStyles } from "./styles";

/** Rows per work list before the rest is left to the Board. */
const LIST_LIMIT = 8;

/** Labels listed before the rest is summarised. */
const LABEL_LIMIT = 12;

/** Steps of the critical chain listed before it is summarised. */
const CHAIN_LIMIT = 12;

/**
 * The default view, built around the questions a reader opens the panel with:
 * how far along is this, what is moving, what can start now, how the project's
 * own labels spread over open work, and how long the remaining chain of
 * dependencies is.
 */
export function OverviewView({
  styles,
  theme,
  project,
  health,
  recommendations,
  selectedId,
  onSelect,
}: {
  readonly styles: PanelStyles;
  readonly theme: PluginTheme;
  readonly project: ProjectModel;
  readonly health: ProjectHealth | null;
  readonly recommendations: readonly Recommendation[];
  readonly selectedId: string | null;
  readonly onSelect: (issueId: string) => void;
}) {
  if (!project.complete) {
    // Without the graph there is no structure to report progress against, so
    // the view says so and falls back to bv's own picks.
    return (
      <View style={styles.listGroup}>
        <Text style={styles.muted}>
          The whole-project graph could not be read, so progress and groups are unavailable. These are bv's
          triage picks.
        </Text>
        <SectionHeader styles={styles} theme={theme} title="Triage picks" meta={`${recommendations.length}`} />
        {recommendations.length === 0 ? (
          <Empty styles={styles} theme={theme} message="bv returned no triage recommendation." />
        ) : (
          recommendations.map((recommendation) => (
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

  if (project.work.length === 0) {
    return (
      <Empty
        styles={styles}
        theme={theme}
        message={
          project.byId.size === 0
            ? "bv reported no issues in this project yet."
            : "Every issue here contains others, so there is no work item to report on."
        }
      />
    );
  }

  const active = workIn(project, "active");
  const held = workIn(project, "held");
  const ready = workIn(project, "ready");
  const context = facetContext(project);

  const list = (title: string, items: typeof ready, empty: string | null, showState: boolean) =>
    items.length === 0 && empty === null ? null : (
      <View style={styles.listGroup}>
        <SectionHeader styles={styles} theme={theme} title={title} meta={`${items.length}`} />
        {items.length === 0 && empty !== null ? <Empty styles={styles} theme={theme} message={empty} /> : null}
        {items.slice(0, LIST_LIMIT).map((item) => (
          <WorkRow
            key={item.id}
            styles={styles}
            theme={theme}
            item={item}
            showState={showState}
            context={context}
            note={item.state === "ready" ? item.action : null}
            selected={selectedId === item.id}
            onSelect={onSelect}
          />
        ))}
        {items.length > LIST_LIMIT ? (
          <Text style={styles.muted}>+{items.length - LIST_LIMIT} more on the Board.</Text>
        ) : null}
      </View>
    );

  return (
    <View style={styles.overviewColumns}>
      <View style={styles.overviewColumn}>
        <Summary styles={styles} theme={theme} project={project} health={health} />
        <Groups styles={styles} theme={theme} project={project} selectedId={selectedId} onSelect={onSelect} />
      </View>
      <View style={styles.overviewColumn}>
        {list("In progress", active, null, false)}
        {list("Held", held, null, true)}
        {list(
          "Ready now",
          ready,
          project.counts.done === project.work.length
            ? "All work is done."
            : active.length > 0
              ? "Nothing else can start until current work lands."
              : "Nothing can start right now.",
          false,
        )}
        {list("Other status", workIn(project, "other"), null, true)}
        <Labels styles={styles} project={project} />
        <Chain styles={styles} theme={theme} project={project} selectedId={selectedId} onSelect={onSelect} />
      </View>
    </View>
  );
}

function Summary({
  styles,
  theme,
  project,
  health,
}: {
  readonly styles: PanelStyles;
  readonly theme: PluginTheme;
  readonly project: ProjectModel;
  readonly health: ProjectHealth | null;
}) {
  const { counts } = project;
  const total = project.work.length;
  const pace =
    health?.closedLast7Days == null
      ? null
      : `${health.closedLast7Days} closed in the last 7 days${
          health.closedLast30Days == null ? "" : `, ${health.closedLast30Days} in 30`
        }${health.velocityEstimated ? " (bv estimate)" : ""}`;
  const figures: readonly { readonly label: string; readonly value: number; readonly color: string }[] = [
    { label: "in progress", value: counts.active, color: toneColor(theme, "accent") },
    { label: "ready", value: counts.ready, color: toneColor(theme, "success") },
    { label: "waiting", value: counts.waiting, color: theme.colors.foregroundMuted },
    ...(counts.held === 0 ? [] : [{ label: "held", value: counts.held, color: toneColor(theme, "danger") }]),
  ];
  return (
    <View style={styles.summaryBlock}>
      <View style={styles.summaryHeadRow}>
        <Text style={styles.summaryHeadline}>
          {counts.done} of {total} done
        </Text>
        <Text style={styles.summaryPercent}>{percentDone(counts.done, total)}%</Text>
      </View>
      <ProgressBar styles={styles} theme={theme} done={counts.done} total={total} wide />
      <View style={styles.summaryFigures}>
        {figures.map((figure) => (
          <View key={figure.label} style={styles.summaryFigure}>
            <Text style={[styles.summaryFigureValue, { color: figure.value === 0 ? theme.colors.foregroundMuted : figure.color }]}>
              {figure.value}
            </Text>
            <Text style={styles.summaryFigureLabel}>{figure.label}</Text>
          </View>
        ))}
      </View>
      {pace === null ? null : <Text style={styles.muted}>{pace}</Text>}
      {project.truncated ? (
        <Text style={styles.muted}>Some closed issues were left out to bound the payload, so “done” undercounts.</Text>
      ) : null}
    </View>
  );
}

function Groups({
  styles,
  theme,
  project,
  selectedId,
  onSelect,
}: {
  readonly styles: PanelStyles;
  readonly theme: PluginTheme;
  readonly project: ProjectModel;
  readonly selectedId: string | null;
  readonly onSelect: (issueId: string) => void;
}) {
  const live = project.roots.filter((root) => !root.settled);
  const finished = project.roots.length - live.length;
  if (live.length === 0 && finished === 0) return null;
  return (
    <View style={styles.listGroup}>
      <SectionHeader
        styles={styles}
        theme={theme}
        title="Progress by group"
        meta={finished === 0 ? `${live.length}` : `${live.length} open · ${finished} finished`}
      />
      {live.map((root) => (
        <RootBlock key={root.key} styles={styles} theme={theme} root={root} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </View>
  );
}

/**
 * An outermost container and its packages. When the container holds its work
 * directly there is nothing to break down, so it is a single row.
 */
function RootBlock({
  styles,
  theme,
  root,
  selectedId,
  onSelect,
}: {
  readonly styles: PanelStyles;
  readonly theme: PluginTheme;
  readonly root: WorkRoot;
  readonly selectedId: string | null;
  readonly onSelect: (issueId: string) => void;
}) {
  const only = root.packages.length === 1 ? root.packages[0] : undefined;
  const flat = only !== undefined && only.id === root.id;
  return (
    <View style={styles.rootBlock}>
      <GroupRow
        styles={styles}
        theme={theme}
        id={root.id}
        title={root.title}
        done={root.done}
        total={root.total}
        counts={root.counts}
        strong
        selected={root.id !== null && selectedId === root.id}
        onSelect={onSelect}
      />
      {flat
        ? null
        : root.packages.map((pkg) => (
            <PackageRow key={pkg.key} styles={styles} theme={theme} pkg={pkg} root={root} selectedId={selectedId} onSelect={onSelect} />
          ))}
    </View>
  );
}

function PackageRow({
  styles,
  theme,
  pkg,
  root,
  selectedId,
  onSelect,
}: {
  readonly styles: PanelStyles;
  readonly theme: PluginTheme;
  readonly pkg: WorkPackage;
  readonly root: WorkRoot;
  readonly selectedId: string | null;
  readonly onSelect: (issueId: string) => void;
}) {
  return (
    <View style={styles.packageIndent}>
      <GroupRow
        styles={styles}
        theme={theme}
        id={pkg.id}
        // Work filed directly on the top-level issue, beside its sub-groups.
        title={pkg.id !== null && pkg.id === root.id ? `Directly under ${root.id}` : pkg.title}
        done={pkg.done}
        total={pkg.total}
        counts={pkg.counts}
        strong={false}
        selected={pkg.id !== null && selectedId === pkg.id}
        onSelect={onSelect}
      />
    </View>
  );
}

function GroupRow({
  styles,
  theme,
  id,
  title,
  done,
  total,
  counts,
  strong,
  selected,
  onSelect,
}: {
  readonly styles: PanelStyles;
  readonly theme: PluginTheme;
  readonly id: string | null;
  readonly title: string;
  readonly done: number;
  readonly total: number;
  readonly counts: WorkPackage["counts"];
  readonly strong: boolean;
  readonly selected: boolean;
  readonly onSelect: (issueId: string) => void;
}) {
  const detail = [
    counts.active === 0 ? null : `${counts.active} in progress`,
    counts.ready === 0 ? null : `${counts.ready} ready`,
    counts.waiting === 0 ? null : `${counts.waiting} waiting`,
    counts.held === 0 ? null : `${counts.held} held`,
    done === total ? "all done" : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
  const body = (
    <>
      <View style={styles.groupRowHead}>
        <Text style={strong ? styles.groupTitleStrong : styles.groupTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.laneProgressText}>
          {done}/{total}
        </Text>
      </View>
      <ProgressBar styles={styles} theme={theme} done={done} total={total} wide />
      <Text style={styles.boardLaneCount}>{[id, detail].filter((part) => part !== null && part.length > 0).join("  ·  ")}</Text>
    </>
  );
  if (id === null) return <View style={styles.groupRow}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}, ${done} of ${total} done${detail.length === 0 ? "" : `, ${detail}`}`}
      onPress={() => onSelect(id)}
      style={({ pressed }) => [styles.groupRow, selected || pressed ? styles.railRowSelected : null]}
    >
      {body}
    </Pressable>
  );
}

function Chain({
  styles,
  theme,
  project,
  selectedId,
  onSelect,
}: {
  readonly styles: PanelStyles;
  readonly theme: PluginTheme;
  readonly project: ProjectModel;
  readonly selectedId: string | null;
  readonly onSelect: (issueId: string) => void;
}) {
  const { chain } = project;
  if (project.chainCycle) {
    return (
      <View style={styles.listGroup}>
        <SectionHeader styles={styles} theme={theme} title="Critical chain" meta="unmeasurable" />
        <Text style={styles.danger}>
          Open work depends on itself in a cycle, so no order of work can finish it. See Risks.
        </Text>
      </View>
    );
  }
  if (chain.length === 0) return null;
  return (
    <View style={styles.listGroup}>
      <SectionHeader
        styles={styles}
        theme={theme}
        title="Critical chain"
        meta={`${chain.length} steps in sequence`}
      />
      <Text style={styles.muted}>
        The longest run of open dependencies: however many agents work in parallel, at least this many issues
        must land one after another.
      </Text>
      {chain.slice(0, CHAIN_LIMIT).map((item) => (
        <WorkRow
          key={item.id}
          styles={styles}
          theme={theme}
          item={{ ...item, critical: false }}
          showState
          context={{ ...facetContext(project), showPriority: false }}
          selected={selectedId === item.id}
          onSelect={onSelect}
        />
      ))}
      {chain.length > CHAIN_LIMIT ? (
        <Text style={styles.muted}>+{chain.length - CHAIN_LIMIT} more steps.</Text>
      ) : null}
    </View>
  );
}

/**
 * The project's own labels over open work, as written. What a label means is
 * the project's business, so each is only counted: how much open work carries
 * it and how much of that can start now.
 */
function Labels({ styles, project }: { readonly styles: PanelStyles; readonly project: ProjectModel }) {
  if (project.labels.length === 0) return null;
  const common = [...project.commonLabels].sort();
  return (
    <View style={styles.listGroup}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Labels on open work</Text>
        <Text style={styles.sectionMeta}>{project.labels.length}</Text>
      </View>
      {project.labels.slice(0, LABEL_LIMIT).map((stat) => (
        <View
          key={stat.label}
          style={styles.labelRow}
          accessibilityLabel={`label ${stat.label}, ${stat.live} open, ${stat.ready} ready`}
        >
          <Text style={styles.labelFacet}>{stat.label}</Text>
          <Text style={styles.boardLaneCount}>
            {stat.live} open{stat.ready === 0 ? "" : ` · ${stat.ready} ready`}
          </Text>
        </View>
      ))}
      {project.labels.length > LABEL_LIMIT ? (
        <Text style={styles.muted}>+{project.labels.length - LABEL_LIMIT} more; group the Board by label to see them.</Text>
      ) : null}
      {common.length === 0 ? null : (
        <Text style={styles.muted}>On every open item, so not listed: {common.join(", ")}.</Text>
      )}
    </View>
  );
}
