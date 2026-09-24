import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import {
  boardFilters,
  filterKey,
  parentLabel,
  type BoardColumn,
  type BoardFilter,
  type BoardModel,
} from "./board";
import { stateDescription, stateIconName, stateLabel, stateTone, toneColor } from "./format";
import type { ProjectModel, WorkItem, WorkState } from "./project";
import { Empty, facetContext, WorkFacets, workAccessibility, type FacetContext } from "./rows";
import type { PanelStyles } from "./styles";

/**
 * Read-only project board: one column per work state, each an independent
 * list, narrowed by one filter. On a compact panel the columns become a state
 * picker over a single list, as board apps do on a phone. There is no drag,
 * drop, or mutation affordance anywhere in this file.
 */
export function BoardView({
  styles,
  theme,
  project,
  board,
  compact,
  selectedId,
  onSelect,
  onFilterChange,
  onShowDoneChange,
}: {
  readonly styles: PanelStyles;
  readonly theme: PluginTheme;
  readonly project: ProjectModel;
  readonly board: BoardModel;
  readonly compact: boolean;
  readonly selectedId: string | null;
  readonly onSelect: (issueId: string) => void;
  readonly onFilterChange: (filter: BoardFilter) => void;
  readonly onShowDoneChange: (showDone: boolean) => void;
}) {
  // Compact shows one column at a time; start where work can be picked up.
  const [compactState, setCompactState] = useState<WorkState>("ready");
  const context = facetContext(project);
  const activeKey = filterKey(board.filter);

  const caveats = [
    project.complete
      ? null
      : "Whole-project graph unavailable: only triage picks and plan items appear, without their parents, so containers among them cannot be told from work.",
    project.truncated ? "Some closed issues were left out to bound the payload; open work is all here." : null,
  ].filter((line): line is string => line !== null);

  const controls = (
    <View style={compact ? styles.boardHeaderStacked : styles.boardHeader}>
      <View style={styles.boardControlRow}>
        <Text style={styles.segmentCaption}>Filter</Text>
        <ScrollView
          horizontal
          style={styles.filterScroll}
          contentContainerStyle={styles.filterRow}
          accessibilityRole="tablist"
          accessibilityLabel="Filter the board"
        >
          {boardFilters(project).map((option) => {
            const selected = option.key === activeKey;
            return (
              <Pressable
                key={option.key}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={`Show ${option.label}, ${option.live} open`}
                onPress={() => onFilterChange(option.filter)}
                style={({ pressed }) => [
                  styles.filterChip,
                  option.filter.kind === "label" ? styles.filterChipLabel : null,
                  selected ? styles.filterChipSelected : null,
                  pressed ? styles.actionPressed : null,
                ]}
              >
                <Text
                  style={selected ? styles.segmentLabelSelected : styles.segmentLabel}
                  numberOfLines={1}
                >
                  {option.depth > 0 ? "› " : ""}
                  {option.label}
                </Text>
                <Text style={styles.switcherCount}>{option.live}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: board.showDone }}
          accessibilityLabel="Show finished work"
          onPress={() => onShowDoneChange(!board.showDone)}
          style={({ pressed }) => [
            styles.filterChip,
            board.showDone ? styles.filterChipSelected : null,
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

  if (project.work.length === 0) {
    return (
      <View style={compact ? styles.boardStack : styles.boardPane}>
        {controls}
        <View style={compact ? styles.stateBlock : styles.paneContent}>
          <Empty styles={styles} theme={theme} message="bv reported no issues in this project, so there is nothing to lay out." />
        </View>
      </View>
    );
  }

  const card = (item: WorkItem, showState: boolean) => (
    <Card
      key={item.id}
      styles={styles}
      theme={theme}
      item={item}
      // The chosen parent is already the whole board's context.
      parent={board.filter.kind === "parent" && board.filter.id === item.parentId ? null : parentLabel(item, project)}
      showState={showState}
      context={context}
      selected={selectedId === item.id}
      onSelect={onSelect}
    />
  );

  if (compact) {
    const shown = board.columns.find((column) => column.state === compactState) ?? board.columns[0];
    return (
      <View style={styles.boardStack}>
        {controls}
        <View style={styles.segmentRow} accessibilityRole="tablist" accessibilityLabel="Board column">
          {board.columns.map((column) => {
            const selected = column.state === shown?.state;
            return (
              <Pressable
                key={column.state}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={`${stateLabel(column.state)}, ${column.total}`}
                onPress={() => setCompactState(column.state)}
                style={({ pressed }) => [
                  styles.segmentItem,
                  styles.segmentItemGrow,
                  selected ? styles.segmentItemSelected : null,
                  pressed ? styles.actionPressed : null,
                ]}
              >
                <Text style={selected ? styles.segmentLabelSelected : styles.segmentLabel} numberOfLines={1}>
                  {stateLabel(column.state)} {column.total}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {shown === undefined ? null : (
          <View style={styles.boardColumnBody}>
            <Text style={styles.boardColumnHint}>{stateDescription(shown.state)}</Text>
            {shown.cards.length === 0 ? <Text style={styles.muted}>Nothing here.</Text> : null}
            {shown.cards.map((item) => card(item, false))}
            <MoreNote styles={styles} hidden={shown.hidden} />
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.boardPane}>
      {controls}
      <View style={styles.boardColumns}>
        {board.columns.map((column) => (
          <Column key={column.state} styles={styles} theme={theme} column={column}>
            {column.cards.map((item) => card(item, false))}
          </Column>
        ))}
      </View>
    </View>
  );
}

/** One state's column: a fixed header over its own scrolling list. */
function Column({
  styles,
  theme,
  column,
  children,
}: {
  readonly styles: PanelStyles;
  readonly theme: PluginTheme;
  readonly column: BoardColumn;
  readonly children: ReactNode;
}) {
  const tone = stateTone(column.state);
  return (
    <View style={styles.boardColumn}>
      <View
        style={styles.boardColumnHead}
        accessibilityRole="header"
        accessibilityLabel={`${stateLabel(column.state)}, ${column.total}. ${stateDescription(column.state)}`}
      >
        <View style={styles.boardColumnHeader}>
          <Icon
            name={stateIconName(column.state)}
            size={13}
            color={tone === "neutral" ? theme.colors.foregroundMuted : toneColor(theme, tone)}
          />
          <Text style={styles.boardColumnTitle}>{stateLabel(column.state)}</Text>
          <Text style={styles.boardColumnCount}>{column.total}</Text>
        </View>
        <Text style={styles.boardColumnHint}>{stateDescription(column.state)}</Text>
      </View>
      <ScrollView style={styles.boardScroll} contentContainerStyle={styles.boardColumnBody}>
        {column.total === 0 ? <Text style={styles.muted}>Nothing here.</Text> : null}
        {children}
        <MoreNote styles={styles} hidden={column.hidden} />
      </ScrollView>
    </View>
  );
}

function MoreNote({ styles, hidden }: { readonly styles: PanelStyles; readonly hidden: number }) {
  if (hidden === 0) return null;
  return <Text style={styles.muted}>+{hidden} more. Narrow the filter or search to reach them.</Text>;
}

function Card({
  styles,
  theme,
  item,
  parent,
  showState,
  context,
  selected,
  onSelect,
}: {
  readonly styles: PanelStyles;
  readonly theme: PluginTheme;
  readonly item: WorkItem;
  /** The parent's title, shown as the card's context; null when it would repeat the filter. */
  readonly parent: string | null;
  readonly showState: boolean;
  readonly context: FacetContext;
  readonly selected: boolean;
  readonly onSelect: (issueId: string) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${workAccessibility(item)}${parent === null ? "" : `, in ${parent}`}`}
      onPress={() => onSelect(item.id)}
      style={({ pressed }) => [styles.boardCard, selected || pressed ? styles.boardCardSelected : null]}
    >
      <View style={[styles.boardCardRail, { backgroundColor: toneColor(theme, stateTone(item.state)) }]} />
      <View style={styles.boardCardBody}>
        {parent === null ? null : (
          <Text style={styles.boardCardParent} numberOfLines={1}>
            {parent}
          </Text>
        )}
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
