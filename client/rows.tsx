import type { PluginTheme } from "@getpaseo/plugin";
import { type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type { Alert, Blocker, IssueDetail, Recommendation, SearchResult, Track } from "../shared/beads";
import {
  alertHeadline,
  priorityLabel,
  severityTone,
  statusTone,
  toneColor,
  type Tone,
} from "./format";
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

/**
 * The one shared row shape: a coloured status rail plus dense text. Every list in
 * the panel uses it so state reads vertically at a glance.
 */
export function RailRow({
  styles,
  theme,
  tone,
  title,
  meta,
  note,
  selected,
  accessibilityLabel,
  onPress,
  children,
}: Common & {
  tone: Tone;
  title: string;
  meta?: string | null;
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
  const meta = [
    recommendation.id,
    recommendation.status,
    priorityLabel(recommendation.priority),
    recommendation.assignee === null ? null : `@${recommendation.assignee}`,
    recommendation.claimable ? "claimable" : "not claimable",
  ]
    .filter((part): part is string => part !== null)
    .join("  ·  ");

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
      tone={recommendation.blockedBy.length > 0 ? "warning" : statusTone(recommendation.status)}
      title={recommendation.title}
      meta={meta}
      note={note.length === 0 ? null : note}
      selected={selected}
      accessibilityLabel={`Show details for ${recommendation.id}, ${recommendation.title}, status ${recommendation.status}`}
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
    <View>
      <Text style={styles.sectionMeta}>
        {track.id} · {track.items.length} item{track.items.length === 1 ? "" : "s"}
        {track.reason === null ? "" : ` · ${track.reason}`}
      </Text>
      {track.items.map((item) => (
        <RailRow
          key={`${track.id}:${item.id}`}
          styles={styles}
          theme={theme}
          tone={statusTone(item.status)}
          title={item.title}
          meta={[item.id, item.status, priorityLabel(item.priority)]
            .filter((part): part is string => part !== null)
            .join("  ·  ")}
          selected={selectedId === item.id}
          accessibilityLabel={`Show details for ${item.id} in ${track.id}`}
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
      tone={blocker.actionable ? "warning" : "danger"}
      title={blocker.title}
      meta={`${blocker.id}  ·  unblocks ${blocker.unblocksCount}  ·  ${blocker.actionable ? "actionable" : "not actionable"}`}
      note={blocker.unblocks.length === 0 ? null : blocker.unblocks.join(", ")}
      selected={selectedId === blocker.id}
      accessibilityLabel={`Show details for blocker ${blocker.id}`}
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
  const tone = severityTone(alert.severity);
  const meta = `${alert.severity}  ·  ${alert.type}`;
  if (alert.issueId === null) {
    return (
      <RailRow
        styles={styles}
        theme={theme}
        tone={tone}
        title={alert.message}
        meta={meta}
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
      meta={meta}
      note={alert.suggestedAction}
      selected={selectedId === alert.issueId}
      accessibilityLabel={`Show details for ${alert.issueId}, ${alert.severity} alert`}
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
      tone="accent"
      title={result.title}
      meta={[result.id, result.score === null ? null : `score ${result.score.toFixed(3)}`]
        .filter((part): part is string => part !== null)
        .join("  ·  ")}
      selected={selectedId === result.id}
      accessibilityLabel={`Show details for search result ${result.id}`}
      onPress={() => onSelect(result.id)}
    />
  );
}

function DetailBlock({ styles, label, value }: Common & { label: string; value: string | null }) {
  if (value === null) return null;
  return (
    <View style={styles.detailBlock}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailText}>{value}</Text>
    </View>
  );
}

export function IssueDetailView({ styles, theme, issue }: Common & { issue: IssueDetail }) {
  const facts = [
    issue.id,
    issue.status,
    issue.type,
    priorityLabel(issue.priority),
    issue.assignee === null ? null : `@${issue.assignee}`,
  ]
    .filter((part): part is string => part !== null)
    .join("  ·  ");

  return (
    <View style={{ gap: 4 }}>
      <RailRow styles={styles} theme={theme} tone={statusTone(issue.status)} title={issue.title} meta={facts} />
      {issue.labels.length === 0 ? null : (
        <Text style={styles.tagText}>labels: {issue.labels.join(", ")}</Text>
      )}
      {issue.parent === null ? null : <Text style={styles.tagText}>parent: {issue.parent}</Text>}
      {issue.dependencies.length === 0 ? null : (
        <Text style={styles.tagText}>
          depends on: {issue.dependencies.map((ref) => `${ref.id}${ref.status === null ? "" : ` (${ref.status})`}`).join(", ")}
        </Text>
      )}
      {issue.dependents.length === 0 ? null : (
        <Text style={styles.tagText}>
          blocks: {issue.dependents.map((ref) => `${ref.id}${ref.status === null ? "" : ` (${ref.status})`}`).join(", ")}
        </Text>
      )}
      <DetailBlock styles={styles} theme={theme} label="Description" value={issue.description} />
      <DetailBlock styles={styles} theme={theme} label="Design" value={issue.design} />
      <DetailBlock styles={styles} theme={theme} label="Acceptance criteria" value={issue.acceptanceCriteria} />
      <DetailBlock styles={styles} theme={theme} label="Notes" value={issue.notes} />
      {issue.comments.length === 0 ? null : (
        <View style={styles.detailBlock}>
          <Text style={styles.detailLabel}>Comments ({issue.comments.length})</Text>
          {issue.comments.slice(0, 5).map((comment) => (
            <Text key={comment.id} style={styles.detailText}>
              {comment.author ?? "unknown"}: {comment.text}
            </Text>
          ))}
        </View>
      )}
      <Text style={styles.monoMeta}>
        {[
          issue.createdAt === null ? null : `created ${issue.createdAt}`,
          issue.updatedAt === null ? null : `updated ${issue.updatedAt}`,
          issue.closedAt === null ? null : `closed ${issue.closedAt}`,
        ]
          .filter((part): part is string => part !== null)
          .join("  ·  ")}
      </Text>
    </View>
  );
}
