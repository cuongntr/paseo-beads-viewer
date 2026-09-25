import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, TextInput, View, type LayoutChangeEvent } from "react-native";
import {
  ALL_WORK,
  boardFilters,
  isFiltered,
  parentLabel,
  searchFilters,
  toggleFilter,
  type BoardColumn,
  type BoardFilter,
  type BoardFilterOption,
  type BoardModel,
} from "./board";
import { stateDescription, stateIconName, stateLabel, stateTone, toneColor } from "./format";
import type { ProjectModel, WorkItem, WorkState } from "./project";
import { Empty, facetContext, WorkFacets, workAccessibility, type FacetContext } from "./rows";
import type { PanelStyles } from "./styles";

/**
 * Read-only project board: one column per work state, each an independent
 * list, narrowed by a multi-select filter. On a compact panel the columns
 * become a state picker over a single list, as board apps do on a phone. There
 * is no drag, drop, or mutation affordance anywhere in this file.
 */
export function BoardView({
  styles,
  theme,
  project,
  board,
  compact,
  now,
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
  /** The clock card ages are measured against. */
  readonly now: number;
  readonly selectedId: string | null;
  readonly onSelect: (issueId: string) => void;
  readonly onFilterChange: (filter: BoardFilter) => void;
  readonly onShowDoneChange: (showDone: boolean) => void;
}) {
  // Compact shows one column at a time; start where work can be picked up.
  const [compactState, setCompactState] = useState<WorkState>("ready");
  const [filterOpen, setFilterOpen] = useState(false);
  // Where the filter bar ends, so the wide dropdown opens right under it.
  const [controlsBottom, setControlsBottom] = useState(0);
  const context = facetContext(project, now);
  const options = boardFilters(project);
  const closeFilter = () => setFilterOpen(false);
  const filterPanel = (
    <FilterPanel
      styles={styles}
      theme={theme}
      options={options}
      filter={board.filter}
      onChange={onFilterChange}
    />
  );

  const caveats = [
    project.complete
      ? null
      : "Whole-project graph unavailable: only triage picks and plan items appear, without their parents, so containers among them cannot be told from work.",
    project.truncated ? "Some closed issues were left out to bound the payload; open work is all here." : null,
  ].filter((line): line is string => line !== null);

  const controls = (
    <View
      style={compact ? styles.boardHeaderStacked : styles.boardHeader}
      onLayout={(event: LayoutChangeEvent) =>
        setControlsBottom(event.nativeEvent.layout.y + event.nativeEvent.layout.height)
      }
    >
      <FilterBar
        styles={styles}
        theme={theme}
        options={options}
        filter={board.filter}
        onChange={onFilterChange}
        open={filterOpen}
        onOpenChange={setFilterOpen}
        trailing={
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
        }
      />
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
      // A single chosen parent is already the whole board's context.
      parent={
        board.filter.parents.length === 1 && board.filter.parents[0] === item.parentId
          ? null
          : parentLabel(item, project)
      }
      showState={showState}
      context={context}
      selected={selectedId === item.id}
      onSelect={onSelect}
    />
  );

  // On a phone the list opens in the host's own modal; a floating dropdown
  // there would be too small to tap and would fight the page scroll.
  const compactFilter = (
    <Modal title="Filter the board" open={filterOpen} onOpenChange={setFilterOpen}>
      <Modal.Content scrollable={false}>{filterPanel}</Modal.Content>
    </Modal>
  );

  if (compact) {
    const shown = board.columns.find((column) => column.state === compactState) ?? board.columns[0];
    return (
      <View style={styles.boardStack}>
        {controls}
        {compactFilter}
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
      {/* The dropdown floats over the columns instead of pushing them down; a
          press anywhere else on the board closes it. */}
      {!filterOpen ? null : (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close the filter"
            onPress={closeFilter}
            style={styles.overlayBackdrop}
          />
          <View style={[styles.filterPopover, { top: controlsBottom }]}>{filterPanel}</View>
        </>
      )}
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
          <WorkFacets
            styles={styles}
            theme={theme}
            item={item}
            showState={showState}
            context={context}
            onOpen={onSelect}
          />
        </View>
      </View>
    </Pressable>
  );
}

/** Options listed before the rest is left to the search box. */
const FILTER_LIST_LIMIT = 80;

/**
 * The board's filter bar: a button summarising the choice and the choices as
 * removable chips. The list itself is {@link FilterPanel}, which the board
 * floats over its columns, or shows in a modal on a phone. A chip row of every
 * parent stopped scaling once a project had more than a handful of epics.
 */
function FilterBar({
  styles,
  theme,
  options,
  filter,
  onChange,
  open,
  onOpenChange,
  trailing,
}: {
  readonly styles: PanelStyles;
  readonly theme: PluginTheme;
  readonly options: readonly BoardFilterOption[];
  readonly filter: BoardFilter;
  readonly onChange: (filter: BoardFilter) => void;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly trailing: ReactNode;
}) {
  const chosen = options.filter((option) => isChosen(filter, option));
  const count = chosen.length;
  return (
    <View style={styles.boardControlRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={count === 0 ? "Filter: all work" : `Filter: ${count} selected`}
        onPress={() => onOpenChange(!open)}
        style={({ pressed }) => [
          styles.filterChip,
          count > 0 ? styles.filterChipSelected : null,
          pressed ? styles.actionPressed : null,
        ]}
      >
        <Icon name="Filter" size={13} color={theme.colors.foregroundMuted} />
        <Text style={count > 0 ? styles.segmentLabelSelected : styles.segmentLabel}>
          {count === 0 ? "All work" : `${count} selected`}
        </Text>
        <Icon name={open ? "ChevronUp" : "ChevronDown"} size={13} color={theme.colors.foregroundMuted} />
      </Pressable>
      <View style={styles.filterChosen}>
        {chosen.map((option) => (
          <Pressable
            key={`${option.kind}:${option.value}`}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${option.label} from the filter`}
            onPress={() => onChange(toggleFilter(filter, option.kind, option.value))}
            style={({ pressed }) => [
              styles.filterChip,
              option.kind === "label" ? styles.filterChipLabel : null,
              pressed ? styles.actionPressed : null,
            ]}
          >
            <Text style={styles.segmentLabelSelected} numberOfLines={1}>
              {option.label}
            </Text>
            <Icon name="X" size={12} color={theme.colors.foregroundMuted} />
          </Pressable>
        ))}
      </View>
      {trailing}
    </View>
  );
}

function isChosen(filter: BoardFilter, option: BoardFilterOption): boolean {
  return (option.kind === "parent" ? filter.parents : filter.labels).includes(option.value);
}

/** The searchable, multi-select list of parents and labels. */
function FilterPanel({
  styles,
  theme,
  options,
  filter,
  onChange,
}: {
  readonly styles: PanelStyles;
  readonly theme: PluginTheme;
  readonly options: readonly BoardFilterOption[];
  readonly filter: BoardFilter;
  readonly onChange: (filter: BoardFilter) => void;
}) {
  const [query, setQuery] = useState("");
  const shown = searchFilters(options, query);
  const parents = shown.filter((option) => option.kind === "parent");
  const labels = shown.filter((option) => option.kind === "label");

  const row = (option: BoardFilterOption) => {
    const on = isChosen(filter, option);
    return (
      <Pressable
        key={`${option.kind}:${option.value}`}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: on }}
        accessibilityLabel={`${option.label}, ${option.live} open`}
        onPress={() => onChange(toggleFilter(filter, option.kind, option.value))}
        style={({ pressed }) => [
          styles.filterOption,
          option.depth > 0 ? styles.filterOptionNested : null,
          pressed ? styles.actionPressed : null,
        ]}
      >
        <Icon
          name={on ? "CircleCheck" : "Circle"}
          size={14}
          color={on ? theme.colors.accent : theme.colors.foregroundMuted}
        />
        <Text style={option.kind === "label" ? styles.labelFacet : styles.filterOptionText} numberOfLines={1}>
          {option.label}
        </Text>
        <Text style={styles.switcherCount}>{option.live}</Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.filterPanel}>
      <View style={styles.boardControlRow}>
        <TextInput
          accessibilityLabel="Find a parent or label"
          placeholder="Find a parent or label"
          placeholderTextColor={theme.colors.foregroundMuted}
          value={query}
          onChangeText={setQuery}
          style={[styles.input, styles.filterSearch]}
        />
        {!isFiltered(filter) ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear the filter"
            onPress={() => onChange(ALL_WORK)}
            style={({ pressed }) => [styles.action, pressed ? styles.actionPressed : null]}
          >
            <Text style={styles.actionText}>Clear</Text>
          </Pressable>
        )}
      </View>
      <Text style={styles.muted}>Any chosen parent, and any chosen label.</Text>
      <ScrollView style={styles.filterList} contentContainerStyle={styles.filterListContent}>
        {parents.length === 0 ? null : <Text style={styles.detailSectionLabel}>PARENTS</Text>}
        {parents.slice(0, FILTER_LIST_LIMIT).map(row)}
        {labels.length === 0 ? null : <Text style={styles.detailSectionLabel}>LABELS</Text>}
        {labels.slice(0, FILTER_LIST_LIMIT).map(row)}
        {shown.length === 0 ? <Text style={styles.muted}>Nothing matches “{query}”.</Text> : null}
        {parents.length > FILTER_LIST_LIMIT || labels.length > FILTER_LIST_LIMIT ? (
          <Text style={styles.muted}>Type to narrow the list.</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}
