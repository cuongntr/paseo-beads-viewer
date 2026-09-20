import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { BoardCard, BoardLane, BoardModel } from "./board";
import { priorityLabel, priorityTone, statusIconName, statusLabel, toneColor } from "./format";
import { accessibilityFacts, Empty, Facet, IdentFacet, PriorityFacet } from "./rows";
import type { PanelStyles } from "./styles";

/**
 * Read-only project board.
 *
 * Lanes come from `bv --robot-graph`, so every issue in the project has a lane,
 * including in-progress and closed work. Closed lanes start collapsed because a
 * mature project has far more finished issues than live ones; the count is
 * always visible, and one press expands them. There is no drag, drop, or
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
}: {
  readonly styles: PanelStyles;
  readonly theme: PluginTheme;
  readonly board: BoardModel;
  readonly compact: boolean;
  /** Names of the `bv` sections that could not be read, e.g. `["plan"]`. */
  readonly missingSources: readonly string[];
  readonly selectedId: string | null;
  readonly onSelect: (issueId: string) => void;
}) {
  const [expanded, setExpanded] = useState<readonly string[]>([]);
  const toggleLane = (status: string) =>
    setExpanded((current) =>
      current.includes(status) ? current.filter((entry) => entry !== status) : [...current, status],
    );

  const provenance = board.complete
    ? `${board.surfaced} of ${board.total} issues  ·  whole project  ·  read-only`
    : `${board.surfaced} surfaced  ·  bv working set  ·  read-only`;
  const scope = board.complete
    ? board.truncated
      ? "Every open issue is here; some closed issues were left out to bound the payload. Search still reaches them."
      : "Every issue bv reported, grouped by its own status. Closed lanes start collapsed."
    : "The whole-project graph is unavailable, so only issues surfaced by triage picks and execution tracks appear here.";
  const gap =
    missingSources.length === 0
      ? null
      : `${missingSources.join(" and ")} unavailable, so those issues are missing from this board.`;

  const header = (
    <View style={compact ? styles.boardHeaderStacked : styles.boardHeader}>
      <Text style={styles.sectionTitle}>Board</Text>
      <Text style={styles.sectionMeta} accessibilityLabel={`Board shows ${provenance}`}>
        {provenance}
      </Text>
      <Text style={styles.muted}>{scope}</Text>
      {gap === null ? null : <Text style={styles.danger}>{gap}</Text>}
    </View>
  );

  if (board.lanes.length === 0) {
    return (
      <View style={compact ? styles.boardStack : styles.boardPane}>
        {header}
        <View style={compact ? styles.stateBlock : styles.paneContent}>
          <Empty
            styles={styles}
            theme={theme}
            message={
              board.complete
                ? "bv reported no issues in this project, so there is nothing to lay out."
                : "bv surfaced no triage pick and no track item, so there is nothing to lay out."
            }
          />
        </View>
      </View>
    );
  }

  const laneBody = (lane: BoardLane) => {
    const open = !lane.closed || expanded.includes(lane.status);
    if (!open) return null;
    return (
      <View style={styles.boardLaneBody}>
        {lane.cards.map((card) => (
          <Card
            key={card.id}
            styles={styles}
            theme={theme}
            card={card}
            selected={selectedId === card.id}
            onSelect={onSelect}
          />
        ))}
        {lane.hidden === 0 ? null : (
          <Text style={styles.muted}>
            +{lane.hidden} more in this lane. Use search to reach a specific issue.
          </Text>
        )}
      </View>
    );
  };

  if (compact) {
    // Compact stacks full-width lane sections; narrow horizontal columns would be
    // unreadable on a phone. The panel's own page scroll owns the vertical axis,
    // so nothing here nests a second vertical scroll region.
    return (
      <View style={styles.boardStack}>
        {header}
        {board.lanes.map((lane) => (
          <View key={lane.status} style={styles.boardLaneStacked}>
            <LaneHeader
              styles={styles}
              theme={theme}
              lane={lane}
              expanded={expanded.includes(lane.status)}
              onToggle={toggleLane}
            />
            {laneBody(lane)}
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={styles.boardPane}>
      {header}
      <ScrollView style={styles.boardScroll}>
        <ScrollView horizontal contentContainerStyle={styles.boardLaneRow}>
          {board.lanes.map((lane) => (
            <View key={lane.status} style={styles.boardLane}>
              <LaneHeader
                styles={styles}
                theme={theme}
                lane={lane}
                expanded={expanded.includes(lane.status)}
                onToggle={toggleLane}
              />
              {laneBody(lane)}
            </View>
          ))}
        </ScrollView>
      </ScrollView>
    </View>
  );
}

function LaneHeader({
  styles,
  theme,
  lane,
  expanded,
  onToggle,
}: {
  readonly styles: PanelStyles;
  readonly theme: PluginTheme;
  readonly lane: BoardLane;
  readonly expanded: boolean;
  readonly onToggle: (status: string) => void;
}) {
  const plural = lane.total === 1 ? "" : "s";
  const content = (
    <>
      <Icon
        name={lane.closed ? (expanded ? "ChevronDown" : "ChevronRight") : statusIconName(lane.status)}
        size={13}
        color={theme.colors.foregroundMuted}
      />
      <Text style={styles.boardLaneTitle}>{statusLabel(lane.status)}</Text>
      <Text style={styles.boardLaneCount}>{lane.total}</Text>
    </>
  );

  // Only closed lanes are collapsible, so only they get a button role.
  if (!lane.closed) {
    return (
      <View
        style={styles.boardLaneHeader}
        accessibilityRole="header"
        accessibilityLabel={`${statusLabel(lane.status)}, ${lane.total} issue${plural}`}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={`${statusLabel(lane.status)}, ${lane.total} issue${plural}, ${expanded ? "collapse" : "expand"}`}
      onPress={() => onToggle(lane.status)}
      style={({ pressed }) => [styles.boardLaneHeader, pressed ? styles.boardCardSelected : null]}
    >
      {content}
    </Pressable>
  );
}

function Card({
  styles,
  theme,
  card,
  selected,
  onSelect,
}: {
  readonly styles: PanelStyles;
  readonly theme: PluginTheme;
  readonly card: BoardCard;
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
          <Facet
            styles={styles}
            theme={theme}
            value={card.assignee === null ? null : `@${card.assignee}`}
          />
          <Facet styles={styles} theme={theme} value={card.type} />
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
