import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { BOARD_AXES, isClosedLane, type BoardAxis, type BoardCard, type BoardGroup, type BoardModel } from "./board";
import { priorityLabel, priorityTone, statusIconName, statusLabel, toneColor } from "./format";
import { accessibilityFacts, Empty, Facet, IdentFacet, PriorityFacet } from "./rows";
import type { PanelStyles } from "./styles";

/**
 * Read-only project board.
 *
 * Grouping is the point: a mature project holds far more finished issues than
 * live ones, so the board defaults to hiding closed work and grouping by the
 * containing epic, and lets the reader switch axis. Groups with nothing live
 * left start collapsed behind their progress count. There is no drag, drop, or
 * mutation affordance anywhere in this file.
 */
export function BoardView({
  styles,
  theme,
  board,
  compact,
  missingSources,
  selectedId,
  onSelect,
  axis,
}: {
  readonly styles: PanelStyles;
  readonly theme: PluginTheme;
  readonly board: BoardModel;
  readonly compact: boolean;
  /** Names of the `bv` sections that could not be read, e.g. `["plan"]`. */
  readonly missingSources: readonly string[];
  readonly selectedId: string | null;
  readonly onSelect: (issueId: string) => void;
  /** The axis the reader asked for, which the model may have overridden. */
  readonly axis: BoardAxis;
}) {
  const [expanded, setExpanded] = useState<readonly string[]>([]);
  const toggleGroup = (key: string) =>
    setExpanded((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    );

  const scope = board.complete
    ? board.truncated
      ? "Every open issue is here; some closed issues were left out to bound the payload. Search still reaches them."
      : null
    : "Whole-project graph unavailable: only triage picks and track items appear here.";
  // The axis the reader asked for is not always the axis they got.
  const axisFallback =
    !board.typed && (axis === "epic" || axis === "type")
      ? "The tracker did not supply issue types, so this board can only group by status or feature."
      : null;
  const gap =
    missingSources.length === 0
      ? null
      : `${missingSources.join(" and ")} unavailable, so those issues are missing from this board.`;

  // No header band: the axis controls live in the panel's single toolbar, and
  // the counts are already on its status line. Only a caveat earns a line here.
  const header =
    scope === null && axisFallback === null && gap === null ? null : (
      <View style={compact ? styles.boardHeaderStacked : styles.boardHeader}>
        {scope === null ? null : <Text style={styles.muted}>{scope}</Text>}
        {axisFallback === null ? null : <Text style={styles.muted}>{axisFallback}</Text>}
        {gap === null ? null : <Text style={styles.danger}>{gap}</Text>}
      </View>
    );

  if (board.groups.length === 0) {
    return (
      <View style={compact ? styles.boardStack : styles.boardPane}>
        {header}
        <View style={compact ? styles.stateBlock : styles.paneContent}>
          <Empty
            styles={styles}
            theme={theme}
            message={
              !board.complete
                ? "bv surfaced no triage pick and no track item, so there is nothing to lay out."
                : board.total === 0
                  ? "bv reported no issues in this project, so there is nothing to lay out."
                  : "Every issue here is closed. Turn off “Live only” to see finished work."
            }
          />
        </View>
      </View>
    );
  }

  const groupBody = (group: BoardGroup) => {
    if (!isOpen(group, expanded, board.axis)) return null;
    return (
      <View style={styles.boardLaneBody}>
        {group.cards.length === 0 ? (
          <Text style={styles.muted}>Nothing live here.</Text>
        ) : (
          group.cards.map((card) => (
            <Card
              key={card.id}
              styles={styles}
              theme={theme}
              card={card}
              axis={board.axis}
              selected={selectedId === card.id}
              onSelect={onSelect}
            />
          ))
        )}
        {group.hidden === 0 ? null : (
          <Text style={styles.muted}>
            +{group.hidden} more in this group. Use search to reach a specific issue.
          </Text>
        )}
      </View>
    );
  };

  const groupHeader = (group: BoardGroup) => (
    <GroupHeader
      styles={styles}
      theme={theme}
      group={group}
      axis={board.axis}
      expanded={isOpen(group, expanded, board.axis)}
      onToggle={toggleGroup}
      onSelect={onSelect}
    />
  );

  if (compact) {
    // Compact stacks full-width sections; narrow horizontal columns would be
    // unreadable on a phone. The panel's own page scroll owns the vertical axis,
    // so nothing here nests a second vertical scroll region.
    return (
      <View style={styles.boardStack}>
        {header}
        {board.groups.map((group) => (
          <View key={group.key} style={styles.boardLaneStacked}>
            {groupHeader(group)}
            {groupBody(group)}
          </View>
        ))}
      </View>
    );
  }

  // Only the status axis reads as columns. Epics, features and types are lists
  // of unequal size, so they stack as full-width sections instead.
  if (board.axis !== "status") {
    return (
      <View style={styles.boardPane}>
        {header}
        <ScrollView style={styles.boardScroll} contentContainerStyle={styles.paneContent}>
          {board.groups.map((group) => (
            <View key={group.key} style={styles.boardLaneStacked}>
              {groupHeader(group)}
              {groupBody(group)}
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.boardPane}>
      {header}
      <ScrollView style={styles.boardScroll}>
        <ScrollView horizontal contentContainerStyle={styles.boardLaneRow}>
          {board.groups.map((group) => (
            <View key={group.key} style={styles.boardLane}>
              {groupHeader(group)}
              {groupBody(group)}
            </View>
          ))}
        </ScrollView>
      </ScrollView>
    </View>
  );
}

/** Settled groups and closed status lanes start collapsed; the rest start open. */
function isOpen(group: BoardGroup, expanded: readonly string[], axis: BoardAxis): boolean {
  const collapsedByDefault = axis === "status" ? isClosedLane(group.key) : group.settled;
  return collapsedByDefault ? expanded.includes(group.key) : true;
}

const AXIS_LABELS: Readonly<Record<BoardAxis, string>> = {
  epic: "Epic",
  feature: "Feature",
  type: "Type",
  status: "Status",
};

export function BoardAxisControls({
  styles,
  axis,
  typed,
  onAxisChange,
  hideClosed,
  onHideClosedChange,
}: {
  readonly styles: PanelStyles;
  readonly axis: BoardAxis;
  readonly typed: boolean;
  readonly onAxisChange: (axis: BoardAxis) => void;
  readonly hideClosed: boolean;
  readonly onHideClosedChange: (hideClosed: boolean) => void;
}) {
  return (
    <View style={styles.switcherRow} accessibilityRole="tablist" accessibilityLabel="Group the board by">
      {BOARD_AXES.map((option) => {
        const selected = option === axis;
        // A disabled control that explains itself beats a control that vanishes.
        const unavailable = !typed && (option === "epic" || option === "type");
        return (
          <Pressable
            key={option}
            accessibilityRole="tab"
            accessibilityState={{ selected, disabled: unavailable }}
            accessibilityLabel={
              unavailable
                ? `Group by ${AXIS_LABELS[option]}, unavailable without tracker issue types`
                : `Group by ${AXIS_LABELS[option]}`
            }
            disabled={unavailable}
            onPress={() => onAxisChange(option)}
            style={({ pressed }) => [
              styles.switcherItem,
              selected ? styles.switcherItemSelected : null,
              pressed ? styles.actionPressed : null,
            ]}
          >
            <Text style={selected ? styles.switcherLabelSelected : styles.switcherLabel}>
              {unavailable ? `${AXIS_LABELS[option]} —` : AXIS_LABELS[option]}
            </Text>
          </Pressable>
        );
      })}
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: hideClosed }}
        accessibilityLabel="Show only issues that are not closed"
        onPress={() => onHideClosedChange(!hideClosed)}
        style={({ pressed }) => [
          styles.switcherItem,
          hideClosed ? styles.switcherItemSelected : null,
          pressed ? styles.actionPressed : null,
        ]}
      >
        <Text style={hideClosed ? styles.switcherLabelSelected : styles.switcherLabel}>
          {hideClosed ? "Live only ✓" : "Live only"}
        </Text>
      </Pressable>
    </View>
  );
}

function GroupHeader({
  styles,
  theme,
  group,
  axis,
  expanded,
  onToggle,
  onSelect,
}: {
  readonly styles: PanelStyles;
  readonly theme: PluginTheme;
  readonly group: BoardGroup;
  readonly axis: BoardAxis;
  readonly expanded: boolean;
  readonly onToggle: (key: string) => void;
  readonly onSelect: (issueId: string) => void;
}) {
  const collapsible = axis === "status" ? isClosedLane(group.key) : group.settled;
  const label = axis === "status" ? statusLabel(group.key) : group.label;
  // Progress is the honest summary of a group: how much of it is already done.
  const progress = axis === "status" ? `${group.total}` : `${group.done}/${group.size}`;
  const description =
    axis === "status"
      ? `${label}, ${group.total} issue${group.total === 1 ? "" : "s"}`
      : `${label}, ${group.done} of ${group.size} closed${group.settled ? ", all done" : ""}`;

  const content = (
    <>
      <Icon
        name={
          collapsible
            ? expanded
              ? "ChevronDown"
              : "ChevronRight"
            : axis === "status"
              ? statusIconName(group.key)
              : "Layers"
        }
        size={13}
        color={theme.colors.foregroundMuted}
      />
      <Text style={styles.boardLaneTitle} numberOfLines={2}>
        {label}
      </Text>
      <Text style={styles.boardLaneCount}>{progress}</Text>
    </>
  );

  if (!collapsible) {
    return (
      <View style={styles.boardLaneHeader} accessibilityRole="header" accessibilityLabel={description}>
        {content}
        {group.headerId === null ? null : (
          <OpenGroupIssue styles={styles} issueId={group.headerId} onSelect={onSelect} />
        )}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={`${description}, ${expanded ? "collapse" : "expand"}`}
      onPress={() => onToggle(group.key)}
      style={({ pressed }) => [styles.boardLaneHeader, pressed ? styles.boardCardSelected : null]}
    >
      {content}
    </Pressable>
  );
}

/** The epic heading a group is itself an issue, so it stays readable. */
function OpenGroupIssue({
  styles,
  issueId,
  onSelect,
}: {
  readonly styles: PanelStyles;
  readonly issueId: string;
  readonly onSelect: (issueId: string) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${issueId}`}
      onPress={() => onSelect(issueId)}
      style={({ pressed }) => [styles.action, pressed ? styles.actionPressed : null]}
    >
      <Text style={styles.actionText}>{issueId}</Text>
    </Pressable>
  );
}

function Card({
  styles,
  theme,
  card,
  axis,
  selected,
  onSelect,
}: {
  readonly styles: PanelStyles;
  readonly theme: PluginTheme;
  readonly card: BoardCard;
  readonly axis: BoardAxis;
  readonly selected: boolean;
  readonly onSelect: (issueId: string) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityFacts([
        `${card.id}, ${card.title}`,
        `status ${statusLabel(card.status)}`,
        priorityLabel(card.priority) === null ? "no priority" : `priority ${priorityLabel(card.priority)}`,
        card.assignee === null ? null : `assigned to ${card.assignee}`,
        card.type,
        card.labels.length === 0 ? null : `labels ${card.labels.join(", ")}`,
        card.blockedByCount === 0 ? null : `blocked by ${card.blockedByCount}`,
        card.unblocksCount === 0 ? null : `unblocks ${card.unblocksCount}`,
        card.trackIds.length === 0 ? null : `in ${card.trackIds.join(", ")}`,
        card.fromRecommendations ? "triage pick" : null,
      ])}
      onPress={() => onSelect(card.id)}
      style={({ pressed }) => [
        styles.boardCard,
        selected || pressed ? styles.boardCardSelected : null,
      ]}
    >
      <View style={[styles.boardCardRail, { backgroundColor: toneColor(theme, priorityTone(card.priority)) }]} />
      <View style={styles.boardCardBody}>
        <Text style={styles.boardCardTitle} numberOfLines={3}>
          {card.title}
        </Text>
        <View style={styles.facetRow}>
          <IdentFacet styles={styles} theme={theme} id={card.id} />
          <PriorityFacet styles={styles} theme={theme} priority={card.priority} />
          {/* Status is the grouping on the status axis, so repeating it there is noise. */}
          <Facet
            styles={styles}
            theme={theme}
            value={axis === "status" ? null : statusLabel(card.status)}
          />
          <Facet
            styles={styles}
            theme={theme}
            value={card.assignee === null ? null : `@${card.assignee}`}
          />
          <Facet styles={styles} theme={theme} value={axis === "type" ? null : card.type} />
          <Facet
            styles={styles}
            theme={theme}
            value={card.blockedByCount === 0 ? null : `blocked by ${card.blockedByCount}`}
          />
          <Facet
            styles={styles}
            theme={theme}
            value={card.unblocksCount === 0 ? null : `unblocks ${card.unblocksCount}`}
          />
          <Facet
            styles={styles}
            theme={theme}
            value={card.trackIds.length === 0 ? null : card.trackIds.join(" ")}
          />
        </View>
      </View>
    </Pressable>
  );
}
