import type { PluginTheme } from "@getpaseo/plugin";
import type { TextStyle, ViewStyle } from "react-native";

/**
 * Visual direction: a quiet dependency console shaped as a workbench. A single
 * vertical rail carries priority colour; status is icon plus text, and metadata
 * reads as restrained wrapping facets rather than SaaS pills. On a wide panel the
 * workbench is a fixed-height master/detail pair of independent scroll regions
 * (master slightly wider in operational views, board-dominant in Board view); on
 * a compact panel the detail is a drill-in screen. No cards, no shadows, no
 * gradients, no coloured panels, no hardcoded colours.
 */
export interface PanelStyles {
  readonly screen: ViewStyle;
  readonly topBar: ViewStyle;
  readonly toolbarRow: ViewStyle;
  readonly headerText: ViewStyle;
  readonly title: TextStyle;
  readonly subtitle: TextStyle;
  readonly action: ViewStyle;
  readonly actionInline: ViewStyle;
  readonly actionPressed: ViewStyle;
  readonly actionText: TextStyle;
  readonly banner: ViewStyle;
  readonly workbench: ViewStyle;
  readonly masterPane: ViewStyle;
  readonly masterPaneWide: ViewStyle;
  readonly masterPaneAlone: ViewStyle;
  readonly detailPaneNarrow: ViewStyle;
  readonly detailPane: ViewStyle;
  readonly paneScroll: ViewStyle;
  readonly paneContent: ViewStyle;
  readonly detailContent: ViewStyle;
  readonly noticeContent: ViewStyle;
  readonly switcherRow: ViewStyle;
  readonly switcherItem: ViewStyle;
  readonly switcherItemSelected: ViewStyle;
  readonly switcherLabel: TextStyle;
  readonly switcherLabelSelected: TextStyle;
  readonly switcherCount: TextStyle;
  readonly backRow: ViewStyle;
  readonly listGroup: ViewStyle;
  readonly stateBlock: ViewStyle;
  readonly sectionHeader: ViewStyle;
  readonly sectionTitle: TextStyle;
  readonly sectionMeta: TextStyle;
  readonly railRow: ViewStyle;
  readonly railRowSelected: ViewStyle;
  readonly rail: ViewStyle;
  readonly railBody: ViewStyle;
  readonly rowTitle: TextStyle;
  readonly rowMeta: TextStyle;
  readonly rowNote: TextStyle;
  readonly metaRow: ViewStyle;
  readonly facetRow: ViewStyle;
  readonly facet: ViewStyle;
  readonly facetIdent: ViewStyle;
  readonly facetText: TextStyle;
  readonly facetIdentText: TextStyle;
  readonly facetDot: ViewStyle;
  readonly facetStrongText: TextStyle;
  readonly facetLabel: TextStyle;
  readonly tagText: TextStyle;
  readonly divider: ViewStyle;
  readonly body: TextStyle;
  readonly muted: TextStyle;
  readonly danger: TextStyle;
  readonly searchRow: ViewStyle;
  readonly input: TextStyle;
  readonly trackBlock: ViewStyle;
  readonly detailStack: ViewStyle;
  readonly detailBlock: ViewStyle;
  readonly detailLabel: TextStyle;
  readonly detailText: TextStyle;
  readonly monoMeta: TextStyle;
  readonly detailTitle: TextStyle;
  readonly detailHeadBlock: ViewStyle;
  readonly detailSection: ViewStyle;
  readonly detailSectionLabel: TextStyle;
  readonly commentBlock: ViewStyle;
  readonly commentByline: TextStyle;
  readonly markdownStack: ViewStyle;
  readonly markdownParagraph: TextStyle;
  readonly markdownHeading1: TextStyle;
  readonly markdownHeading2: TextStyle;
  readonly markdownHeading3: TextStyle;
  readonly markdownStrong: TextStyle;
  readonly markdownEmphasis: TextStyle;
  readonly markdownInlineCode: TextStyle;
  readonly markdownLink: TextStyle;
  readonly markdownLinkTarget: TextStyle;
  readonly markdownListRow: ViewStyle;
  readonly markdownListMarker: TextStyle;
  readonly markdownListText: TextStyle;
  readonly markdownTaskMark: ViewStyle;
  readonly markdownQuote: ViewStyle;
  readonly markdownQuoteText: TextStyle;
  readonly markdownRule: ViewStyle;
  readonly markdownCodeBlock: ViewStyle;
  readonly markdownCodeLanguage: TextStyle;
  readonly markdownCodeText: TextStyle;
  readonly markdownTruncated: TextStyle;
  readonly boardPane: ViewStyle;
  readonly boardStack: ViewStyle;
  readonly boardScroll: ViewStyle;
  readonly boardHeader: ViewStyle;
  readonly boardHeaderStacked: ViewStyle;
  readonly boardControlRow: ViewStyle;
  readonly boardContent: ViewStyle;
  readonly boardColumnsRow: ViewStyle;
  readonly boardColumnHeaderBand: ViewStyle;
  readonly boardColumnHeader: ViewStyle;
  readonly boardCell: ViewStyle;
  readonly boardLaneStacked: ViewStyle;
  readonly laneToggle: ViewStyle;
  readonly laneTitleBlock: ViewStyle;
  readonly laneTitle: TextStyle;
  readonly laneProgressText: TextStyle;
  readonly laneSummary: TextStyle;
  readonly segmentCaption: TextStyle;
  readonly segmentRow: ViewStyle;
  readonly segmentItem: ViewStyle;
  readonly segmentItemSelected: ViewStyle;
  readonly segmentLabel: TextStyle;
  readonly segmentLabelSelected: TextStyle;
  readonly progressTrack: ViewStyle;
  readonly progressTrackWide: ViewStyle;
  readonly progressFill: ViewStyle;
  readonly overviewColumns: ViewStyle;
  readonly overviewColumn: ViewStyle;
  readonly summaryBlock: ViewStyle;
  readonly summaryHeadRow: ViewStyle;
  readonly summaryHeadline: TextStyle;
  readonly summaryPercent: TextStyle;
  readonly summaryFigures: ViewStyle;
  readonly summaryFigure: ViewStyle;
  readonly summaryFigureValue: TextStyle;
  readonly summaryFigureLabel: TextStyle;
  readonly rootBlock: ViewStyle;
  readonly packageIndent: ViewStyle;
  readonly groupRow: ViewStyle;
  readonly groupRowHead: ViewStyle;
  readonly groupTitle: TextStyle;
  readonly groupTitleStrong: TextStyle;
  readonly labelFacet: TextStyle;
  readonly labelRow: ViewStyle;
  readonly facetAccentText: TextStyle;
  readonly boardLaneHeader: ViewStyle;
  readonly boardLaneTitle: TextStyle;
  readonly boardLaneCount: TextStyle;
  readonly boardLaneBody: ViewStyle;
  readonly boardCard: ViewStyle;
  readonly boardCardSelected: ViewStyle;
  readonly boardCardRail: ViewStyle;
  readonly boardCardBody: ViewStyle;
  readonly boardCardTitle: TextStyle;
  readonly statusChip: ViewStyle;
  readonly statusChipText: TextStyle;
}

/** Widest comfortable measure for prose-heavy inspector content. */
const DETAIL_MAX_WIDTH = 760;

export function createPanelStyles(theme: PluginTheme, compact: boolean): PanelStyles {
  const gutter = compact ? 14 : 20;
  const rowGap = compact ? 10 : 12;
  const hitHeight = compact ? 46 : 42;
  return {
    screen: { flex: 1, backgroundColor: theme.colors.surface0 },
    topBar: {
      paddingHorizontal: gutter,
      paddingTop: compact ? 10 : 8,
      paddingBottom: compact ? 8 : 8,
      gap: 6,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    /**
     * The panel's single chrome row: navigation, search and refresh together.
     * It wraps rather than scrolls, so a narrow panel grows a line instead of
     * hiding a control.
     */
    toolbarRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
    headerText: { flex: 1, gap: 3 },
    title: { color: theme.colors.foreground, fontSize: compact ? 16 : 18, fontWeight: "600" },
    subtitle: { color: theme.colors.foregroundMuted, fontSize: 11 },
    action: {
      minHeight: compact ? 38 : 32,
      justifyContent: "center",
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 4,
      backgroundColor: theme.colors.surface1,
    },
    actionInline: { alignSelf: "flex-start" },
    actionPressed: { backgroundColor: theme.colors.surface2 },
    actionText: { color: theme.colors.foreground, fontSize: 11, fontWeight: "600" },
    banner: { paddingHorizontal: gutter, paddingTop: 12, gap: 6, maxWidth: DETAIL_MAX_WIDTH },
    workbench: { flex: 1, flexDirection: "row" },
    /**
     * Operational views put the working list first: 5:4 favours the master pane
     * without starving the inspector.
     */
    masterPane: {
      flex: 5,
      minWidth: 0,
      borderRightWidth: 1,
      borderRightColor: theme.colors.border,
    },
    /** Board view: the lanes need the width, the inspector stays reachable. */
    masterPaneWide: { flex: 7 },
    /** With no inspector beside it, the divider would sit on the panel edge. */
    masterPaneAlone: { borderRightWidth: 0 },
    detailPaneNarrow: { flex: 3 },
    detailPane: { flex: 4, minWidth: 0 },
    paneScroll: { flex: 1 },
    paneContent: { paddingHorizontal: gutter, paddingTop: rowGap, paddingBottom: gutter * 2, gap: rowGap },
    detailContent: {
      paddingHorizontal: gutter,
      paddingTop: rowGap,
      paddingBottom: gutter * 2,
      gap: rowGap,
      width: "100%",
      maxWidth: DETAIL_MAX_WIDTH,
    },
    noticeContent: { paddingHorizontal: gutter, paddingTop: gutter, paddingBottom: gutter * 2, gap: 8, maxWidth: DETAIL_MAX_WIDTH },
    switcherRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    switcherItem: {
      minHeight: compact ? 40 : 34,
      justifyContent: "center",
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 4,
    },
    switcherItemSelected: { backgroundColor: theme.colors.surface2, borderColor: theme.colors.accent },
    switcherLabel: { color: theme.colors.foregroundMuted, fontSize: 12 },
    switcherLabelSelected: { color: theme.colors.foreground, fontWeight: "600" },
    switcherCount: { color: theme.colors.foregroundMuted, fontSize: 10 },
    backRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    listGroup: { gap: compact ? 2 : 4 },
    stateBlock: { gap: 8 },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: 10,
      paddingTop: rowGap,
      paddingBottom: 2,
    },
    sectionTitle: {
      color: theme.colors.foreground,
      fontSize: 12,
      fontWeight: "700",
      letterSpacing: 0.4,
    },
    sectionMeta: { color: theme.colors.foregroundMuted, fontSize: 10 },
    railRow: { flexDirection: "row", gap: 12, paddingVertical: 8, paddingRight: 4, minHeight: hitHeight },
    railRowSelected: { backgroundColor: theme.colors.surface1 },
    rail: { width: 3, borderRadius: 2, alignSelf: "stretch", minHeight: 20 },
    railBody: { flex: 1, gap: 3 },
    rowTitle: { color: theme.colors.foreground, fontSize: 13, lineHeight: 18, fontWeight: "600" },
    rowMeta: { color: theme.colors.foregroundMuted, fontSize: 10 },
    rowNote: { color: theme.colors.foregroundMuted, fontSize: 11, lineHeight: 16 },
    metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    /** Structured facets replace dot-joined metadata; they wrap instead of truncating. */
    facetRow: { flexDirection: "row", flexWrap: "wrap", columnGap: 10, rowGap: 4, alignItems: "center" },
    facet: { flexDirection: "row", alignItems: "center", gap: 4 },
    /** Only the identifier gets a container, so it anchors the row without noise. */
    facetIdent: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 3,
      backgroundColor: theme.colors.surface1,
    },
    facetText: { color: theme.colors.foregroundMuted, fontSize: 10 },
    facetIdentText: { color: theme.colors.foreground, fontSize: 10, fontWeight: "600" },
    /** The priority swatch: the only colour a facet row carries. */
    facetDot: { width: 6, height: 6, borderRadius: 3 },
    facetStrongText: { color: theme.colors.foreground, fontSize: 10, fontWeight: "600" },
    facetLabel: { color: theme.colors.foregroundMuted, fontSize: 9, letterSpacing: 0.3 },
    tagText: { color: theme.colors.foregroundMuted, fontSize: 10 },
    divider: { height: 1, backgroundColor: theme.colors.border, opacity: 0.6 },
    body: { color: theme.colors.foreground, fontSize: 12, lineHeight: 18 },
    muted: { color: theme.colors.foregroundMuted, fontSize: 11, lineHeight: 16 },
    danger: { color: theme.colors.statusDanger, fontSize: 11, lineHeight: 16 },
    /** Grows into whatever the toolbar's chips and buttons leave behind. */
    searchRow: {
      flexGrow: 1,
      flexShrink: 1,
      minWidth: 160,
      flexDirection: "row",
      gap: 8,
      alignItems: "center",
    },
    input: {
      flex: 1,
      minHeight: compact ? 40 : 34,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 4,
      paddingHorizontal: 10,
      paddingVertical: compact ? 8 : 7,
      color: theme.colors.foreground,
      backgroundColor: theme.colors.surface1,
      fontSize: 12,
    },
    trackBlock: { gap: 2, paddingTop: 4 },
    detailStack: { gap: 6 },
    detailBlock: { gap: 4, paddingTop: 6 },
    detailLabel: {
      color: theme.colors.foregroundMuted,
      fontSize: 10,
      fontWeight: "600",
      letterSpacing: 0.4,
    },
    detailText: { color: theme.colors.foreground, fontSize: 12, lineHeight: 18 },
    monoMeta: { color: theme.colors.foregroundMuted, fontSize: 10 },
    detailTitle: {
      color: theme.colors.foreground,
      fontSize: compact ? 17 : 19,
      lineHeight: compact ? 23 : 26,
      fontWeight: "700",
    },
    detailHeadBlock: { gap: 8, paddingBottom: 4 },
    detailSection: {
      gap: 6,
      paddingTop: compact ? 12 : 14,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
    },
    detailSectionLabel: {
      color: theme.colors.foregroundMuted,
      fontSize: 10,
      fontWeight: "700",
      letterSpacing: 0.5,
    },
    commentBlock: { gap: 3, paddingTop: 8 },
    commentByline: { color: theme.colors.foregroundMuted, fontSize: 10, fontWeight: "600" },
    markdownStack: { gap: 6 },
    markdownParagraph: { color: theme.colors.foreground, fontSize: 12, lineHeight: 19 },
    markdownHeading1: {
      color: theme.colors.foreground,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "700",
      paddingTop: 4,
    },
    markdownHeading2: {
      color: theme.colors.foreground,
      fontSize: 13,
      lineHeight: 19,
      fontWeight: "700",
      paddingTop: 4,
    },
    markdownHeading3: {
      color: theme.colors.foregroundMuted,
      fontSize: 12,
      lineHeight: 18,
      fontWeight: "700",
      letterSpacing: 0.3,
      paddingTop: 2,
    },
    markdownStrong: { fontWeight: "700" },
    markdownEmphasis: { fontStyle: "italic" },
    markdownInlineCode: {
      color: theme.colors.foreground,
      backgroundColor: theme.colors.surface2,
      fontFamily: "monospace",
      fontSize: 11,
    },
    markdownLink: { color: theme.colors.accent, fontSize: 12, lineHeight: 19 },
    markdownLinkTarget: { color: theme.colors.foregroundMuted, fontSize: 10 },
    markdownListRow: { flexDirection: "row", gap: 6, alignItems: "flex-start" },
    markdownListMarker: {
      color: theme.colors.foregroundMuted,
      fontSize: 12,
      lineHeight: 19,
      minWidth: 16,
    },
    markdownListText: { flex: 1, color: theme.colors.foreground, fontSize: 12, lineHeight: 19 },
    markdownTaskMark: { minWidth: 16, paddingTop: 3 },
    markdownQuote: {
      borderLeftWidth: 2,
      borderLeftColor: theme.colors.border,
      paddingLeft: 8,
      paddingVertical: 2,
    },
    markdownQuoteText: {
      color: theme.colors.foregroundMuted,
      fontSize: 12,
      lineHeight: 19,
      fontStyle: "italic",
    },
    markdownRule: { height: 1, backgroundColor: theme.colors.border, marginVertical: 4 },
    markdownCodeBlock: {
      gap: 1,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 4,
      backgroundColor: theme.colors.surface1,
    },
    markdownCodeLanguage: { color: theme.colors.foregroundMuted, fontSize: 9, letterSpacing: 0.4 },
    markdownCodeText: {
      color: theme.colors.foreground,
      fontFamily: "monospace",
      fontSize: 11,
      lineHeight: 16,
    },
    markdownTruncated: { color: theme.colors.foregroundMuted, fontSize: 10, fontStyle: "italic" },
    boardPane: { flex: 1, minWidth: 0 },
    /** Compact board: laid out inside the page scroll, so no flex height. */
    boardStack: { gap: 14 },
    boardScroll: { flex: 1 },
    /** Compact reuses the page gutter, so only the vertical rhythm is set here. */
    boardHeaderStacked: { gap: 6, paddingBottom: 2 },
    boardHeader: {
      paddingHorizontal: gutter,
      paddingTop: 8,
      paddingBottom: 8,
      gap: 6,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    /** The board's own controls and its scope note share one line. */
    boardControlRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 },
    boardContent: { paddingHorizontal: gutter, paddingTop: 4, paddingBottom: gutter * 2, gap: 6 },
    /**
     * Wide board: every lane's cells and the column header share one flex row
     * shape, so the columns line up without a horizontal scroll region.
     */
    boardColumnsRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
    boardColumnHeaderBand: {
      paddingHorizontal: gutter,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    boardColumnHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
    boardCell: { flex: 1, minWidth: 0, gap: 5 },
    /** One lane: its header over its row of cells, or its stacked cards when compact. */
    boardLaneStacked: {
      gap: 6,
      paddingTop: 8,
      paddingBottom: 6,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    boardLaneHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 2 },
    laneToggle: { padding: 4, borderRadius: 3 },
    laneTitleBlock: { flexShrink: 1, flexGrow: 1, minWidth: 0, gap: 1 },
    laneTitle: { color: theme.colors.foreground, fontSize: 12, fontWeight: "700" },
    laneProgressText: { color: theme.colors.foreground, fontSize: 11, fontWeight: "600", minWidth: 34, textAlign: "right" },
    laneSummary: { color: theme.colors.foregroundMuted, fontSize: 10, flexShrink: 1, minWidth: 0 },
    segmentCaption: { color: theme.colors.foregroundMuted, fontSize: 10, letterSpacing: 0.3 },
    /** Board controls are subordinate to the view tabs, so they are smaller and borderless until chosen. */
    segmentRow: {
      flexDirection: "row",
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 4,
      overflow: "hidden",
    },
    segmentItem: {
      minHeight: compact ? 34 : 26,
      justifyContent: "center",
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    segmentItemSelected: { backgroundColor: theme.colors.surface2 },
    segmentLabel: { color: theme.colors.foregroundMuted, fontSize: 11 },
    segmentLabelSelected: { color: theme.colors.foreground, fontSize: 11, fontWeight: "600" },
    progressTrack: {
      width: 72,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.colors.surface2,
      overflow: "hidden",
    },
    progressTrackWide: { width: "100%" },
    progressFill: { height: "100%", borderRadius: 2 },
    /** Two columns on a wide pane, one when it is too narrow for both. */
    overviewColumns: { flexDirection: "row", flexWrap: "wrap", gap: compact ? 12 : 28, alignItems: "flex-start" },
    overviewColumn: { flexGrow: 1, flexShrink: 1, flexBasis: 340, minWidth: 0, gap: rowGap },
    summaryBlock: { gap: 8, paddingTop: 4 },
    summaryHeadRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 10 },
    summaryHeadline: { color: theme.colors.foreground, fontSize: compact ? 18 : 20, fontWeight: "700" },
    summaryPercent: { color: theme.colors.foregroundMuted, fontSize: 13, fontWeight: "600" },
    summaryFigures: { flexDirection: "row", flexWrap: "wrap", gap: compact ? 16 : 24, paddingTop: 2 },
    summaryFigure: { gap: 1 },
    summaryFigureValue: { fontSize: 18, fontWeight: "700" },
    summaryFigureLabel: { color: theme.colors.foregroundMuted, fontSize: 10, letterSpacing: 0.3 },
    rootBlock: { gap: 2, paddingBottom: 6 },
    packageIndent: { paddingLeft: 14 },
    groupRow: { gap: 4, paddingVertical: 6, paddingHorizontal: 4, borderRadius: 3 },
    groupRowHead: { flexDirection: "row", alignItems: "baseline", gap: 10 },
    groupTitle: { flex: 1, color: theme.colors.foreground, fontSize: 12 },
    groupTitleStrong: { flex: 1, color: theme.colors.foreground, fontSize: 13, fontWeight: "700" },
    labelRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 3 },
    /** A project label, written as the project wrote it. */
    labelFacet: {
      color: theme.colors.foregroundMuted,
      fontSize: 10,
      paddingHorizontal: 4,
      borderRadius: 3,
      backgroundColor: theme.colors.surface2,
    },
    facetAccentText: { color: theme.colors.accent, fontSize: 10, fontWeight: "600" },
    boardLaneTitle: {
      color: theme.colors.foreground,
      fontSize: 11,
      fontWeight: "700",
      letterSpacing: 0.4,
    },
    boardLaneCount: { color: theme.colors.foregroundMuted, fontSize: 10 },
    boardLaneBody: { gap: 5 },
    boardCard: {
      flexDirection: "row",
      gap: 10,
      minHeight: hitHeight,
      paddingVertical: 6,
      paddingRight: 8,
      paddingLeft: 0,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 4,
      backgroundColor: theme.colors.surface1,
      overflow: "hidden",
    },
    boardCardSelected: { backgroundColor: theme.colors.surface2, borderColor: theme.colors.accent },
    boardCardRail: { width: 3, alignSelf: "stretch" },
    boardCardBody: { flex: 1, gap: 4 },
    boardCardTitle: { color: theme.colors.foreground, fontSize: 12, lineHeight: 17, fontWeight: "600" },
    statusChip: { flexDirection: "row", alignItems: "center", gap: 4 },
    statusChipText: { color: theme.colors.foreground, fontSize: 10, fontWeight: "600" },
  };
}
