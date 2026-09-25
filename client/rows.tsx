import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { isClosedStatus, type Alert, type Blocker, type IssueDetail, type Recommendation, type SearchResult, type Track } from "../shared/beads";
import {
  activityLabel,
  alertHeadline,
  percentDone,
  priorityLabel,
  priorityTone,
  severityTone,
  stateIconName,
  stateLabel,
  stateTone,
  statusIconName,
  statusLabel,
  toneColor,
  waitsOnLabel,
  type Tone,
} from "./format";
import { MarkdownView } from "./markdown-view";
import { groupRelations } from "./relations";
import type { ProjectModel, WorkItem, WorkState } from "./project";
import type { PanelStyles } from "./styles";

interface Common {
  readonly styles: PanelStyles;
  readonly theme: PluginTheme;
}

export function SectionHeader({ styles, title, meta }: Common & { title: string; meta?: string | null }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {meta === undefined || meta === null ? null : <Text style={styles.sectionMeta}>{meta}</Text>}
    </View>
  );
}

/** The issue identifier: the one facet that gets a container so it anchors a row. */
export function IdentFacet({ styles, id }: Common & { id: string }) {
  return (
    <View style={styles.facetIdent}>
      <Text style={styles.facetIdentText}>{id}</Text>
    </View>
  );
}

/**
 * Status as icon plus text. Status never carries colour — priority owns the
 * colour channel — so the icon is drawn in the muted foreground.
 */
export function StatusFacet({ styles, theme, status }: Common & { status: string }) {
  return (
    <View style={styles.statusChip}>
      <Icon name={statusIconName(status)} size={12} color={theme.colors.foregroundMuted} />
      <Text style={styles.statusChipText}>{statusLabel(status)}</Text>
    </View>
  );
}

/** Priority as its tone colour plus its label; renders nothing when absent. */
export function PriorityFacet({ styles, theme, priority }: Common & { priority: number | null }) {
  const label = priorityLabel(priority);
  if (label === null) return null;
  return (
    <View style={styles.facet}>
      <View style={[styles.facetDot, { backgroundColor: toneColor(theme, priorityTone(priority)) }]} />
      <Text style={styles.facetStrongText}>{label}</Text>
    </View>
  );
}

/** A plain `label value` facet. Renders nothing when the value is absent. */
export function Facet({
  styles,
  label,
  value,
  strong,
}: Common & { label?: string; value: string | null; strong?: boolean }) {
  if (value === null || value.length === 0) return null;
  return (
    <View style={styles.facet}>
      {label === undefined ? null : <Text style={styles.facetLabel}>{label}</Text>}
      <Text style={strong === true ? styles.facetStrongText : styles.facetText}>{value}</Text>
    </View>
  );
}

/** Wrapping container for facets; keeps every list row on the same metadata grid. */
export function FacetRow({ styles, children }: Common & { children: ReactNode }) {
  return <View style={styles.facetRow}>{children}</View>;
}

/**
 * The one shared row shape: a coloured rail plus a bold title, a structured facet
 * row, and an optional note. The rail encodes priority for issue rows and
 * severity/risk where no priority exists.
 */
export function RailRow({
  styles,
  theme,
  tone,
  title,
  meta,
  facets,
  note,
  selected,
  accessibilityLabel,
  onPress,
  children,
}: Common & {
  tone: Tone;
  title: string;
  meta?: string | null;
  /** Structured facets; preferred over `meta` for issue-shaped rows. */
  facets?: ReactNode;
  note?: string | null;
  selected?: boolean;
  accessibilityLabel?: string;
  onPress?: () => void;
  children?: ReactNode;
}) {
  const body = (
    <View style={styles.railBody}>
      <Text style={styles.rowTitle} numberOfLines={2}>
        {title}
      </Text>
      {facets === undefined || facets === null ? null : <View style={styles.facetRow}>{facets}</View>}
      {meta === undefined || meta === null ? null : <Text style={styles.rowMeta}>{meta}</Text>}
      {note === undefined || note === null ? null : (
        <Text style={styles.rowNote} numberOfLines={2}>
          {note}
        </Text>
      )}
      {children}
    </View>
  );
  const rail = <View style={[styles.rail, { backgroundColor: toneColor(theme, tone) }]} />;

  if (onPress === undefined) {
    return (
      <View style={styles.railRow}>
        {rail}
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ selected: selected === true }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.railRow,
        selected === true || pressed ? styles.railRowSelected : null,
      ]}
    >
      {rail}
      {body}
    </Pressable>
  );
}

/** Derived work state as icon plus text, drawn in the state's own tone. */
export function WorkStateFacet({ styles, theme, state }: Common & { state: WorkState }) {
  const tone = stateTone(state);
  const color = tone === "neutral" ? theme.colors.foregroundMuted : toneColor(theme, tone);
  return (
    <View style={styles.statusChip}>
      <Icon name={stateIconName(state)} size={12} color={color} />
      <Text style={styles.statusChipText}>{stateLabel(state)}</Text>
    </View>
  );
}

/** Raw statuses that the derived state already says, so repeating them is noise. */
const PLAIN_STATUSES: readonly string[] = ["open", "in_progress", "closed"];

/**
 * What the whole project has in common, so a facet row can leave it out: a
 * priority, type or label that every live item shares tells nothing apart.
 */
export interface FacetContext {
  readonly showPriority: boolean;
  readonly showType: boolean;
  readonly commonLabels: ReadonlySet<string>;
  /** The clock "updated 9m ago" is measured against. */
  readonly now: number;
}

export function facetContext(project: ProjectModel, now: number): FacetContext {
  return {
    showPriority: project.priorityVaries,
    showType: project.typeVaries,
    commonLabels: project.commonLabels,
    now,
  };
}

/** Labels shown per row before the rest is summarised as `+N`. */
const ROW_LABEL_LIMIT = 3;

/**
 * The facets that tell one piece of work from another. Whatever the whole
 * project shares is left out. Labels are the project's own vocabulary, so they
 * appear exactly as written and are never interpreted.
 */
export function WorkFacets({
  styles,
  theme,
  item,
  showState,
  context,
  onOpen,
}: Common & {
  item: WorkItem;
  showState: boolean;
  context: FacetContext;
  /** Opens a related issue; when set, the issues this one waits on are links. */
  onOpen?: (issueId: string) => void;
}) {
  const rawStatus = item.status.trim().toLowerCase();
  const labels = [...new Set(item.labels)].filter((label) => !context.commonLabels.has(label));
  return (
    <>
      <IdentFacet styles={styles} theme={theme} id={item.id} />
      {showState ? <WorkStateFacet styles={styles} theme={theme} state={item.state} /> : null}
      {context.showPriority ? <PriorityFacet styles={styles} theme={theme} priority={item.priority} /> : null}
      <Facet
        styles={styles}
        theme={theme}
        value={PLAIN_STATUSES.includes(rawStatus) ? null : statusLabel(item.status)}
      />
      <Facet styles={styles} theme={theme} value={item.assignee === null ? null : `@${item.assignee}`} />
      <Facet styles={styles} theme={theme} value={activityLabel(item, context.now)} />
      {item.critical ? <Text style={styles.facetAccentText}>critical chain</Text> : null}
      <Facet styles={styles} theme={theme} value={context.showType ? item.type : null} />
      {labels.slice(0, ROW_LABEL_LIMIT).map((label) => (
        <Text key={label} style={styles.labelFacet}>
          {label}
        </Text>
      ))}
      {labels.length > ROW_LABEL_LIMIT ? (
        <Text style={styles.facetText}>+{labels.length - ROW_LABEL_LIMIT}</Text>
      ) : null}
      {item.state === "done" ? null : onOpen === undefined ? (
        <Facet
          styles={styles}
          theme={theme}
          value={
            item.blockedBy.length > 0
              ? waitsOnLabel(item.blockedBy)
              : item.heldVia === null
                ? null
                : `${waitsOnLabel(item.inheritedBlockedBy)} via ${item.heldVia}`
          }
        />
      ) : (
        <WaitsOn styles={styles} theme={theme} item={item} onOpen={onOpen} />
      )}
      <Facet
        styles={styles}
        theme={theme}
        value={item.unblocksCount === 0 || item.state === "done" ? null : `unblocks ${item.unblocksCount}`}
      />
    </>
  );
}

/** Blocker ids shown as links before the rest is summarised as `+N`. */
const WAITS_ON_LINK_LIMIT = 2;

/** "waits on a, b +3" with each id a link to that issue. */
function WaitsOn({
  styles,
  theme,
  item,
  onOpen,
}: Common & { item: WorkItem; onOpen: (issueId: string) => void }) {
  const own = item.blockedBy.length > 0;
  const ids = own ? item.blockedBy : item.inheritedBlockedBy;
  if (ids.length === 0) return null;
  const rest = ids.length - WAITS_ON_LINK_LIMIT;
  return (
    <View style={styles.facet}>
      <Text style={styles.facetText}>waits on</Text>
      {ids.slice(0, WAITS_ON_LINK_LIMIT).map((id) => (
        <IssueLink key={id} styles={styles} theme={theme} id={id} onOpen={onOpen} />
      ))}
      {rest > 0 ? <Text style={styles.facetText}>+{rest}</Text> : null}
      {own || item.heldVia === null ? null : (
        <>
          <Text style={styles.facetText}>via</Text>
          <IssueLink styles={styles} theme={theme} id={item.heldVia} onOpen={onOpen} />
        </>
      )}
    </View>
  );
}

/** An issue id that opens the issue. */
export function IssueLink({
  styles,
  id,
  onOpen,
}: Common & { id: string; onOpen: (issueId: string) => void }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Open ${id}`}
      onPress={() => onOpen(id)}
      hitSlop={6}
      style={({ pressed }) => (pressed ? styles.actionPressed : null)}
    >
      <Text style={styles.issueLink}>{id}</Text>
    </Pressable>
  );
}

/** Spoken form of a work item: every fact the facets show, in words. */
export function workAccessibility(item: WorkItem): string {
  return accessibilityFacts([
    `${item.id}, ${item.title}`,
    stateLabel(item.state),
    priorityLabel(item.priority) === null ? null : `priority ${priorityLabel(item.priority)}`,
    item.assignee === null ? null : `assigned to ${item.assignee}`,
    item.labels.length === 0 ? null : `labels ${item.labels.join(", ")}`,
    item.critical ? "on the critical chain" : null,
    item.blockedBy.length === 0 ? null : `waits on ${item.blockedBy.join(", ")}`,
    item.heldVia === null ? null : `its parent ${item.heldVia} waits on ${item.inheritedBlockedBy.join(", ")}`,
    item.unblocksCount === 0 ? null : `unblocks ${item.unblocksCount}`,
  ]);
}

/** One piece of work as a list row, coloured by its derived state. */
export function WorkRow({
  styles,
  theme,
  item,
  showState,
  context,
  note,
  selected,
  onSelect,
}: Common & {
  item: WorkItem;
  showState: boolean;
  context: FacetContext;
  note?: string | null;
  selected: boolean;
  onSelect: (issueId: string) => void;
}) {
  return (
    <RailRow
      styles={styles}
      theme={theme}
      tone={stateTone(item.state)}
      title={item.title}
      facets={
        <WorkFacets
          styles={styles}
          theme={theme}
          item={item}
          showState={showState}
          context={context}
          onOpen={onSelect}
        />
      }
      note={note ?? null}
      selected={selected}
      accessibilityLabel={workAccessibility(item)}
      onPress={() => onSelect(item.id)}
    />
  );
}

/** A thin done/total bar; the numbers beside it stay the source of truth. */
export function ProgressBar({
  styles,
  theme,
  done,
  total,
  wide,
}: Common & { done: number; total: number; wide?: boolean }) {
  const percent = percentDone(done, total);
  return (
    <View
      style={[styles.progressTrack, wide === true ? styles.progressTrackWide : null]}
      accessibilityRole="progressbar"
      accessibilityLabel={`${done} of ${total} done`}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
    >
      <View style={[styles.progressFill, { width: `${percent}%`, backgroundColor: theme.colors.statusSuccess }]} />
    </View>
  );
}

export function Empty({ styles, message }: Common & { message: string }) {
  return <Text style={styles.muted}>{message}</Text>;
}

export function RecommendationRow({
  styles,
  theme,
  recommendation,
  selected,
  onSelect,
}: Common & {
  recommendation: Recommendation;
  selected: boolean;
  onSelect: (issueId: string) => void;
}) {
  const note = [
    recommendation.blockedBy.length === 0 ? null : `blocked by ${recommendation.blockedBy.join(", ")}`,
    recommendation.unblocks.length === 0 ? null : `unblocks ${recommendation.unblocks.join(", ")}`,
    recommendation.reasons[0] ?? null,
  ]
    .filter((part): part is string => part !== null)
    .join("  ·  ");

  return (
    <RailRow
      styles={styles}
      theme={theme}
      tone={priorityTone(recommendation.priority)}
      title={recommendation.title}
      facets={
        <>
          <IdentFacet styles={styles} theme={theme} id={recommendation.id} />
          <StatusFacet styles={styles} theme={theme} status={recommendation.status} />
          <PriorityFacet styles={styles} theme={theme} priority={recommendation.priority} />
          <Facet
            styles={styles}
            theme={theme}
            value={recommendation.assignee === null ? null : `@${recommendation.assignee}`}
          />
          <Facet styles={styles} theme={theme} value={recommendation.type} />
          <Facet
            styles={styles}
            theme={theme}
            value={recommendation.claimable ? "claimable" : "not claimable"}
          />
        </>
      }
      note={note.length === 0 ? null : note}
      selected={selected}
      accessibilityLabel={accessibilityFacts([
        `${recommendation.id}, ${recommendation.title}`,
        `status ${statusLabel(recommendation.status)}`,
        priorityLabel(recommendation.priority) === null
          ? "no priority"
          : `priority ${priorityLabel(recommendation.priority)}`,
        recommendation.assignee === null ? null : `assigned to ${recommendation.assignee}`,
        recommendation.type,
        recommendation.claimable ? "claimable" : "not claimable",
        recommendation.blockedBy.length === 0 ? null : `blocked by ${recommendation.blockedBy.length}`,
        recommendation.unblocks.length === 0 ? null : `unblocks ${recommendation.unblocks.length}`,
      ])}
      onPress={() => onSelect(recommendation.id)}
    />
  );
}

export function TrackBlock({
  styles,
  theme,
  track,
  selectedId,
  onSelect,
}: Common & { track: Track; selectedId: string | null; onSelect: (issueId: string) => void }) {
  return (
    <View style={styles.trackBlock}>
      <Text style={styles.sectionMeta}>
        {track.id} · {track.totalItems} item{track.totalItems === 1 ? "" : "s"}
        {track.totalItems > track.items.length ? ` (${track.items.length} shown)` : ""}
        {track.reason === null ? "" : ` · ${track.reason}`}
      </Text>
      {track.items.map((item) => (
        <RailRow
          key={`${track.id}:${item.id}`}
          styles={styles}
          theme={theme}
          tone={priorityTone(item.priority)}
          title={item.title}
          facets={
            <>
              <IdentFacet styles={styles} theme={theme} id={item.id} />
              <StatusFacet styles={styles} theme={theme} status={item.status} />
              <PriorityFacet styles={styles} theme={theme} priority={item.priority} />
              <Facet
                styles={styles}
                theme={theme}
                value={item.unblocks.length === 0 ? null : `unblocks ${item.unblocks.length}`}
              />
            </>
          }
          selected={selectedId === item.id}
          accessibilityLabel={accessibilityFacts([
            `${item.id}, ${item.title}`,
            `in ${track.id}`,
            `status ${statusLabel(item.status)}`,
            priorityLabel(item.priority) === null ? "no priority" : `priority ${priorityLabel(item.priority)}`,
            item.unblocks.length === 0 ? null : `unblocks ${item.unblocks.length}`,
          ])}
          onPress={() => onSelect(item.id)}
        />
      ))}
    </View>
  );
}

export function BlockerRow({
  styles,
  theme,
  blocker,
  selectedId,
  onSelect,
}: Common & { blocker: Blocker; selectedId: string | null; onSelect: (issueId: string) => void }) {
  return (
    <RailRow
      styles={styles}
      theme={theme}
      // A Blocker carries no priority and no status, so risk keeps the colour here.
      tone={blocker.actionable ? "warning" : "danger"}
      title={blocker.title}
      facets={
        <>
          <IdentFacet styles={styles} theme={theme} id={blocker.id} />
          <Facet styles={styles} theme={theme} value={`unblocks ${blocker.unblocksCount}`} strong />
          <Facet
            styles={styles}
            theme={theme}
            value={blocker.actionable ? "actionable" : "not actionable"}
          />
          {blocker.unblocks.length === 0 ? null : (
            <View style={styles.facet}>
              <Text style={styles.facetText}>→</Text>
              {blocker.unblocks.map((id) => (
                <IssueLink key={id} styles={styles} theme={theme} id={id} onOpen={onSelect} />
              ))}
            </View>
          )}
        </>
      }
      selected={selectedId === blocker.id}
      accessibilityLabel={accessibilityFacts([
        `blocker ${blocker.id}, ${blocker.title}`,
        `unblocks ${blocker.unblocksCount}`,
        blocker.actionable ? "actionable" : "not actionable",
      ])}
      onPress={() => onSelect(blocker.id)}
    />
  );
}

export function AlertRow({
  styles,
  theme,
  alert,
  selectedId,
  onSelect,
}: Common & { alert: Alert; selectedId: string | null; onSelect: (issueId: string) => void }) {
  // Alerts have severity but no priority, so severity keeps the colour channel.
  const tone = severityTone(alert.severity);
  const facets = (
    <>
      {alert.issueId === null ? null : <IdentFacet styles={styles} theme={theme} id={alert.issueId} />}
      <Facet styles={styles} theme={theme} value={alert.severity} strong />
      <Facet styles={styles} theme={theme} value={alert.type} />
    </>
  );
  if (alert.issueId === null) {
    return (
      <RailRow
        styles={styles}
        theme={theme}
        tone={tone}
        title={alert.message}
        facets={facets}
        note={alert.suggestedAction}
      />
    );
  }
  return (
    <RailRow
      styles={styles}
      theme={theme}
      tone={tone}
      title={alertHeadline(alert)}
      facets={facets}
      note={alert.suggestedAction}
      selected={selectedId === alert.issueId}
      accessibilityLabel={accessibilityFacts([
        `${alert.issueId}, ${alert.message}`,
        `${alert.severity} alert`,
        alert.type,
        alert.suggestedAction,
      ])}
      onPress={() => onSelect(alert.issueId ?? "")}
    />
  );
}

export function SearchResultRow({
  styles,
  theme,
  result,
  selectedId,
  onSelect,
}: Common & { result: SearchResult; selectedId: string | null; onSelect: (issueId: string) => void }) {
  return (
    <RailRow
      styles={styles}
      theme={theme}
      // Search results carry neither priority nor status; accent marks relevance.
      tone="accent"
      title={result.title}
      facets={
        <>
          <IdentFacet styles={styles} theme={theme} id={result.id} />
          <Facet
            styles={styles}
            theme={theme}
            label="score"
            value={result.score === null ? null : result.score.toFixed(3)}
          />
        </>
      }
      selected={selectedId === result.id}
      accessibilityLabel={accessibilityFacts([
        `search result ${result.id}, ${result.title}`,
        result.score === null ? null : `score ${result.score.toFixed(3)}`,
      ])}
      onPress={() => onSelect(result.id)}
    />
  );
}

/** A titled inspector section whose body is rendered as bounded Markdown. */
function DetailSection({ styles, theme, label, value }: Common & { label: string; value: string | null }) {
  if (value === null || value.trim().length === 0) return null;
  return (
    <View style={styles.detailSection}>
      <Text style={styles.detailSectionLabel}>{label}</Text>
      <MarkdownView styles={styles} theme={theme} source={value} />
    </View>
  );
}

export function IssueDetailView({
  styles,
  theme,
  issue,
  onOpen,
}: Common & { issue: IssueDetail; onOpen: (issueId: string) => void }) {
  const relations = groupRelations(issue);

  const timestamps = [
    issue.createdAt === null ? null : `created ${issue.createdAt}`,
    issue.updatedAt === null ? null : `updated ${issue.updatedAt}`,
    issue.closedAt === null ? null : `closed ${issue.closedAt}`,
    issue.closeReason === null ? null : `reason ${issue.closeReason}`,
  ]
    .filter((part): part is string => part !== null)
    .join("  ·  ");

  return (
    <View style={styles.detailStack}>
      <View style={styles.detailHeadBlock}>
        <Text
          style={styles.detailTitle}
          accessibilityRole="header"
          accessibilityLabel={accessibilityFacts([
            issue.title,
            issue.id,
            `status ${statusLabel(issue.status)}`,
            priorityLabel(issue.priority) === null ? "no priority" : `priority ${priorityLabel(issue.priority)}`,
            issue.type,
            issue.assignee === null ? null : `assigned to ${issue.assignee}`,
          ])}
        >
          {issue.title}
        </Text>
        <View style={styles.facetRow}>
          <IdentFacet styles={styles} theme={theme} id={issue.id} />
          <StatusFacet styles={styles} theme={theme} status={issue.status} />
          <PriorityFacet styles={styles} theme={theme} priority={issue.priority} />
          <Facet styles={styles} theme={theme} value={issue.type} />
          <Facet
            styles={styles}
            theme={theme}
            value={issue.assignee === null ? null : `@${issue.assignee}`}
          />
        </View>
        {issue.labels.length === 0 ? null : (
          <View style={styles.metaRow}>
            {issue.labels.map((label) => (
              <Text key={label} style={styles.labelFacet}>
                {label}
              </Text>
            ))}
          </View>
        )}
      </View>
      {relations.length === 0 ? null : (
        <View style={styles.detailSection}>
          {relations.map((group) => (
            <View key={group.key} style={styles.relationGroup}>
              <Text style={styles.detailSectionLabel}>
                {group.title.toUpperCase()} · {group.refs.length}
              </Text>
              {group.refs.map((ref) => (
                <RelationRow key={ref.id} styles={styles} theme={theme} relation={ref} onOpen={onOpen} />
              ))}
            </View>
          ))}
        </View>
      )}
      <DetailSection styles={styles} theme={theme} label="Description" value={issue.description} />
      <DetailSection styles={styles} theme={theme} label="Design" value={issue.design} />
      <DetailSection
        styles={styles}
        theme={theme}
        label="Acceptance criteria"
        value={issue.acceptanceCriteria}
      />
      <DetailSection styles={styles} theme={theme} label="Notes" value={issue.notes} />
      {issue.comments.length === 0 ? null : (
        <View style={styles.detailSection}>
          <Text style={styles.detailSectionLabel}>Comments ({issue.comments.length})</Text>
          {issue.comments.slice(0, 5).map((comment) => (
            <View key={comment.id} style={styles.commentBlock}>
              <Text style={styles.commentByline}>
                {comment.author ?? "unknown"}
                {comment.createdAt === null ? "" : ` · ${comment.createdAt}`}
              </Text>
              <MarkdownView styles={styles} theme={theme} source={comment.text} />
            </View>
          ))}
        </View>
      )}
      {timestamps.length === 0 ? null : <Text style={styles.monoMeta}>{timestamps}</Text>}
    </View>
  );
}

/** One related issue: status, id and title, opening that issue on press. Finished ones recede. */
function RelationRow({
  styles,
  theme,
  relation,
  onOpen,
}: Common & { relation: IssueDetail["dependencies"][number]; onOpen: (issueId: string) => void }) {
  const closed = relation.status !== null && isClosedStatus(relation.status);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={accessibilityFacts([
        `Open ${relation.id}`,
        relation.title,
        relation.status === null ? null : statusLabel(relation.status),
      ])}
      onPress={() => onOpen(relation.id)}
      style={({ pressed }) => [styles.relationRow, pressed ? styles.railRowSelected : null]}
    >
      <Icon
        name={relation.status === null ? "CircleDashed" : statusIconName(relation.status)}
        size={13}
        color={theme.colors.foregroundMuted}
      />
      <IdentFacet styles={styles} theme={theme} id={relation.id} />
      <Text style={closed ? styles.relationTitleDone : styles.relationTitle} numberOfLines={1}>
        {relation.title ?? relation.id}
      </Text>
    </Pressable>
  );
}

/** Joins accessibility facts into one comma-separated label, dropping absent ones. */
export function accessibilityFacts(parts: readonly (string | null)[]): string {
  return parts.filter((part): part is string => part !== null && part.length > 0).join(", ");
}
