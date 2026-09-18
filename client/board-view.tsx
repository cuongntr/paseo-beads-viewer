import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { BoardCard, BoardLane, BoardModel } from "./board";
import { priorityLabel, priorityTone, statusIconName, statusLabel, toneColor } from "./format";
import { accessibilityFacts, Empty, Facet, IdentFacet, PriorityFacet } from "./rows";
import type { PanelStyles } from "./styles";

/**
 * Read-only working-set board.
 *
 * This is deliberately *not* a project Kanban. `bv` caps triage at 12 picks and
 * the plan at 8 tracks of 10 items, so the board can only ever show issues that
 * one of those two analyses surfaced. The header says so, and there is no drag,
 * drop, or mutation affordance anywhere in this file.
 */
export function BoardView({
  styles,
  theme,
  board,
  compact,
  totalTracked,
  missingSources,
  selectedId,
  onSelect,
}: {
  readonly styles: PanelStyles;
  readonly theme: PluginTheme;
  readonly board: BoardModel;
  readonly compact: boolean;
  /** `counts.total` from `bv`, or `null` when counts are unavailable. */
  readonly totalTracked: number | null;
  /** Names of the `bv` sections that could not be read, e.g. `["plan"]`. */
  readonly missingSources: readonly string[];
  readonly selectedId: string | null;
  readonly onSelect: (issueId: string) => void;
}) {
  const provenance =
    `${board.surfaced} of ${totalTracked === null ? "unknown" : totalTracked} surfaced` +
    "  ·  bv working set  ·  read-only";
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
      <Text style={styles.muted}>
        Only issues surfaced by triage picks and execution tracks appear here. This is not the full
        project.
      </Text>
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
            message="bv surfaced no triage pick and no track item, so there is nothing to lay out."
          />
        </View>
      </View>
    );
  }

  if (compact) {
    // Compact stacks full-width lane sections; narrow horizontal columns would be
    // unreadable on a phone. The panel's own page scroll owns the vertical axis,
    // so nothing here nests a second vertical scroll region.
    return (
      <View style={styles.boardStack}>
        {header}
        {board.lanes.map((lane) => (
          <View key={lane.status} style={styles.boardLaneStacked}>
            <LaneHeader styles={styles} theme={theme} lane={lane} />
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
            </View>
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
              <LaneHeader styles={styles} theme={theme} lane={lane} />
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
              </View>
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
}: {
  readonly styles: PanelStyles;
  readonly theme: PluginTheme;
  readonly lane: BoardLane;
}) {
  return (
    <View
      style={styles.boardLaneHeader}
      accessibilityRole="header"
      accessibilityLabel={`${statusLabel(lane.status)}, ${lane.cards.length} surfaced issue${lane.cards.length === 1 ? "" : "s"}`}
    >
      <Icon name={statusIconName(lane.status)} size={13} color={theme.colors.foregroundMuted} />
      <Text style={styles.boardLaneTitle}>{statusLabel(lane.status)}</Text>
      <Text style={styles.boardLaneCount}>{lane.cards.length}</Text>
    </View>
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
