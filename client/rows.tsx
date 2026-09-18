import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type { Alert, Blocker, IssueDetail, Recommendation, SearchResult, Track } from "../shared/beads";
import {
  alertHeadline,
  priorityLabel,
  priorityTone,
  severityTone,
  statusIconName,
  statusLabel,
  toneColor,
  type Tone,
} from "./format";
import { MarkdownView } from "./markdown-view";
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
        {track.id} · {track.items.length} item{track.items.length === 1 ? "" : "s"}
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
        </>
      }
      note={blocker.unblocks.length === 0 ? null : blocker.unblocks.join(", ")}
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

export function IssueDetailView({ styles, theme, issue }: Common & { issue: IssueDetail }) {
  const relations = [
    issue.parent === null ? null : `parent ${issue.parent}`,
    issue.labels.length === 0 ? null : `labels ${issue.labels.join(", ")}`,
    issue.dependencies.length === 0
      ? null
      : `depends on ${issue.dependencies.map(refLabel).join(", ")}`,
    issue.dependents.length === 0 ? null : `blocks ${issue.dependents.map(refLabel).join(", ")}`,
  ].filter((part): part is string => part !== null);

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
        {relations.length === 0 ? null : (
          <View style={styles.metaRow}>
            {relations.map((relation) => (
              <Text key={relation} style={styles.tagText}>
                {relation}
              </Text>
            ))}
          </View>
        )}
      </View>
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

function refLabel(ref: IssueDetail["dependencies"][number]): string {
  return `${ref.id}${ref.status === null ? "" : ` (${ref.status})`}`;
}

/** Joins accessibility facts into one comma-separated label, dropping absent ones. */
export function accessibilityFacts(parts: readonly (string | null)[]): string {
  return parts.filter((part): part is string => part !== null && part.length > 0).join(", ");
}
