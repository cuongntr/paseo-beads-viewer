import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { boardGroupings, type BoardGrouping, type BoardLane, type BoardModel } from "./board";
import { stateIconName, stateLabel, stateTone, toneColor } from "./format";
import type { ProjectModel, WorkItem, WorkState } from "./project";
import { Empty, facetContext, ProgressBar, WorkFacets, workAccessibility, type FacetContext } from "./rows";
import type { PanelStyles } from "./styles";

/** Label families read `stack:` so they are recognisable as the project's own prefix. */
function groupingLabel(grouping: BoardGrouping): string {
  switch (grouping) {
    case "parent":
      return "Parent";
    case "root":
      return "Top level";
    case "none":
      return "None";
    case "labels":
      return "Label";
    default:
      return `${grouping.slice("ns:".length)}:`;
  }
}

/**
 * Read-only project board: lanes are the chosen grouping, columns are the
 * derived work state. On a wide panel the columns line up under one fixed
 * header; on a compact panel each lane stacks its cards with their state named.
 * There is no drag, drop, or mutation affordance anywhere in this file.
 */
export function BoardView({
  styles,
  theme,
  project,
  board,
  compact,
  selectedId,
  onSelect,
  onGroupingChange,
  onShowDoneChange,
}: {
  readonly styles: PanelStyles;
  readonly theme: PluginTheme;
  readonly project: ProjectModel;
  readonly board: BoardModel;
  readonly compact: boolean;
  readonly selectedId: string | null;
  readonly onSelect: (issueId: string) => void;
  readonly onGroupingChange: (grouping: BoardGrouping) => void;
  readonly onShowDoneChange: (showDone: boolean) => void;
}) {
  // Lanes the reader folded; settled lanes start folded when done work is shown.
  const [toggled, setToggled] = useState<readonly string[]>([]);
  const toggleLane = (key: string) =>
    setToggled((current) => (current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]));
  const isOpen = (lane: BoardLane) => lane.settled === toggled.includes(lane.key);
  const context = facetContext(project);

  const caveats = [
    project.complete
      ? null
      : "Whole-project graph unavailable: only triage picks and plan items appear, without their parents, so containers among them cannot be told from work.",
    project.truncated ? "Some closed issues were left out to bound the payload; open work is all here." : null,
    board.settledHidden === 0
      ? null
      : `${board.settledHidden} finished group${board.settledHidden === 1 ? "" : "s"} hidden.`,
  ].filter((line): line is string => line !== null);

  const controls = (
    <View style={compact ? styles.boardHeaderStacked : styles.boardHeader}>
      <View style={styles.boardControlRow}>
        <Text style={styles.segmentCaption}>Group by</Text>
        <View style={styles.segmentRow} accessibilityRole="tablist" accessibilityLabel="Group the board by">
          {boardGroupings(project).map((option) => {
            const selected = option === board.grouping;
            return (
              <Pressable
                key={option}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={`Group by ${groupingLabel(option)}`}
                onPress={() => onGroupingChange(option)}
                style={({ pressed }) => [
                  styles.segmentItem,
                  selected ? styles.segmentItemSelected : null,
                  pressed ? styles.actionPressed : null,
                ]}
              >
                <Text style={selected ? styles.segmentLabelSelected : styles.segmentLabel}>
                  {groupingLabel(option)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: board.showDone }}
          accessibilityLabel="Show finished work"
          onPress={() => onShowDoneChange(!board.showDone)}
          style={({ pressed }) => [
            styles.segmentItem,
            board.showDone ? styles.segmentItemSelected : null,
            pressed ? styles.actionPressed : null,
          ]}
        >
          <Text style={board.showDone ? styles.segmentLabelSelected : styles.segmentLabel}>
            {board.showDone ? "Showing done" : "Show done"}
          </Text>
        </Pressable>
      </View>
      {caveats.map((line) => (
        <Text key={line} style={styles.muted}>
          {line}
        </Text>
      ))}
    </View>
  );

  if (board.lanes.length === 0) {
    return (
      <View style={compact ? styles.boardStack : styles.boardPane}>
        {controls}
        <View style={compact ? styles.stateBlock : styles.paneContent}>
          <Empty
            styles={styles}
            theme={theme}
            message={
              project.work.length === 0
                ? "bv reported no issues in this project, so there is nothing to lay out."
                : "Every piece of work is done. Turn on “Show done” to see it."
            }
          />
        </View>
      </View>
    );
  }

  const laneHeader = (lane: BoardLane) => (
    <LaneHeader
      styles={styles}
      theme={theme}
      lane={lane}
      compact={compact}
      open={isOpen(lane)}
      onToggle={toggleLane}
      onSelect={onSelect}
    />
  );

  const card = (item: WorkItem, showState: boolean) => (
    <Card
      key={item.id}
      styles={styles}
      theme={theme}
      item={item}
      showState={showState}
      context={context}
      selected={selectedId === item.id}
      onSelect={onSelect}
    />
  );

  if (compact) {
    // Narrow columns are unreadable on a phone: each lane lists its cards in
    // state order and names the state on every card instead.
    return (
      <View style={styles.boardStack}>
        {controls}
        {board.lanes.map((lane) => (
          <View key={lane.key} style={styles.boardLaneStacked}>
            {laneHeader(lane)}
            {!isOpen(lane)
              ? null
              : board.columns.map((state) => {
                  const cell = lane.cells[state];
                  return cell.cards.length === 0 ? null : (
                    <View key={state} style={styles.boardLaneBody}>
                      {cell.cards.map((item) => card(item, true))}
                      <MoreNote styles={styles} hidden={cell.hidden} />
                    </View>
                  );
                })}
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={styles.boardPane}>
      {controls}
      <View style={[styles.boardColumnsRow, styles.boardColumnHeaderBand]}>
        {board.columns.map((state) => (
          <ColumnHeader key={state} styles={styles} theme={theme} state={state} count={board.counts[state]} />
        ))}
      </View>
      <ScrollView style={styles.boardScroll} contentContainerStyle={styles.boardContent}>
        {board.lanes.map((lane) => (
          <View key={lane.key} style={styles.boardLaneStacked}>
            {laneHeader(lane)}
            {!isOpen(lane) ? null : (
              <View style={styles.boardColumnsRow}>
                {board.columns.map((state) => {
                  const cell = lane.cells[state];
                  return (
                    <View key={state} style={styles.boardCell}>
                      {cell.cards.map((item) => card(item, false))}
                      <MoreNote styles={styles} hidden={cell.hidden} />
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function MoreNote({ styles, hidden }: { readonly styles: PanelStyles; readonly hidden: number }) {
  if (hidden === 0) return null;
  return <Text style={styles.muted}>+{hidden} more. Use search to reach a specific issue.</Text>;
}

function ColumnHeader({
  styles,
  theme,
  state,
  count,
}: {
  readonly styles: PanelStyles;
  readonly theme: PluginTheme;
  readonly state: WorkState;
  readonly count: number;
}) {
  const tone = stateTone(state);
  return (
    <View
      style={[styles.boardCell, styles.boardColumnHeader]}
      accessibilityRole="header"
      accessibilityLabel={`${stateLabel(state)}, ${count}`}
    >
      <Icon
        name={stateIconName(state)}
        size={13}
        color={tone === "neutral" ? theme.colors.foregroundMuted : toneColor(theme, tone)}
      />
      <Text style={styles.boardLaneTitle}>{stateLabel(state)}</Text>
      <Text style={styles.boardLaneCount}>{count}</Text>
    </View>
  );
}

function LaneHeader({
  styles,
  theme,
  lane,
  compact,
  open,
  onToggle,
  onSelect,
}: {
  readonly styles: PanelStyles;
  readonly theme: PluginTheme;
  readonly lane: BoardLane;
  readonly compact: boolean;
  readonly open: boolean;
  readonly onToggle: (key: string) => void;
  readonly onSelect: (issueId: string) => void;
}) {
  const summary = [
    lane.counts.active === 0 ? null : `${lane.counts.active} in progress`,
    lane.counts.ready === 0 ? null : `${lane.counts.ready} ready`,
    lane.counts.waiting === 0 ? null : `${lane.counts.waiting} waiting`,
    lane.counts.held === 0 ? null : `${lane.counts.held} held`,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
  return (
    <View style={styles.boardLaneHeader}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${lane.label}, ${lane.done} of ${lane.total} done, ${open ? "collapse" : "expand"}`}
        onPress={() => onToggle(lane.key)}
        style={({ pressed }) => [styles.laneToggle, pressed ? styles.actionPressed : null]}
      >
        <Icon name={open ? "ChevronDown" : "ChevronRight"} size={13} color={theme.colors.foregroundMuted} />
      </Pressable>
      <Pressable
        accessibilityRole={lane.headerId === null ? undefined : "button"}
        accessibilityLabel={lane.headerId === null ? lane.label : `Open ${lane.headerId}, ${lane.label}`}
        disabled={lane.headerId === null}
        onPress={() => (lane.headerId === null ? undefined : onSelect(lane.headerId))}
        style={styles.laneTitleBlock}
      >
        <Text style={styles.laneTitle} numberOfLines={1}>
          {lane.label}
        </Text>
        {lane.context === null && lane.headerId === null ? null : (
          <Text style={styles.boardLaneCount} numberOfLines={1}>
            {[lane.headerId, lane.context === null ? null : `in ${lane.context}`]
              .filter((part): part is string => part !== null)
              .join(" ")}
          </Text>
        )}
      </Pressable>
      {/* On a phone the cards already name their state; the title keeps the room. */}
      {compact || summary.length === 0 ? null : (
        <Text style={styles.laneSummary} numberOfLines={1}>
          {summary}
        </Text>
      )}
      <ProgressBar styles={styles} theme={theme} done={lane.done} total={lane.total} />
      <Text style={styles.laneProgressText}>
        {lane.done}/{lane.total}
      </Text>
    </View>
  );
}

function Card({
  styles,
  theme,
  item,
  showState,
  context,
  selected,
  onSelect,
}: {
  readonly styles: PanelStyles;
  readonly theme: PluginTheme;
  readonly item: WorkItem;
  readonly showState: boolean;
  readonly context: FacetContext;
  readonly selected: boolean;
  readonly onSelect: (issueId: string) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={workAccessibility(item)}
      onPress={() => onSelect(item.id)}
      style={({ pressed }) => [styles.boardCard, selected || pressed ? styles.boardCardSelected : null]}
    >
      <View style={[styles.boardCardRail, { backgroundColor: toneColor(theme, stateTone(item.state)) }]} />
      <View style={styles.boardCardBody}>
        <Text style={styles.boardCardTitle} numberOfLines={2}>
          {item.title}
        </Text>
        <View style={styles.facetRow}>
          <WorkFacets styles={styles} theme={theme} item={item} showState={showState} context={context} />
        </View>
      </View>
    </Pressable>
  );
}
