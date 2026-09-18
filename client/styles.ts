import type { PluginTheme } from "@getpaseo/plugin";
import type { TextStyle, ViewStyle } from "react-native";

/**
 * Visual direction: a quiet dependency console shaped as a workbench. A single
 * vertical status rail carries all state colour; everything beside it is flat,
 * dense text on one surface. On a wide panel the workbench is a fixed-height
 * master/detail pair of independent scroll regions; on a compact panel the
 * detail is a drill-in screen. No cards, no shadows, no gradients, no coloured
 * panels, no hardcoded colours.
 */
export interface PanelStyles {
  readonly screen: ViewStyle;
  readonly topBar: ViewStyle;
  readonly headerRow: ViewStyle;
  readonly headerText: ViewStyle;
  readonly title: TextStyle;
  readonly subtitle: TextStyle;
  readonly action: ViewStyle;
  readonly actionInline: ViewStyle;
  readonly actionPressed: ViewStyle;
  readonly actionText: TextStyle;
  readonly banner: ViewStyle;
  readonly summaryBar: ViewStyle;
  readonly pulseRow: ViewStyle;
  readonly pulseCell: ViewStyle;
  readonly pulseValue: TextStyle;
  readonly pulseLabel: TextStyle;
  readonly workbench: ViewStyle;
  readonly masterPane: ViewStyle;
  readonly masterHeader: ViewStyle;
  readonly controlStack: ViewStyle;
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
      paddingTop: gutter,
      paddingBottom: compact ? 12 : 14,
      gap: 8,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    headerRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 14 },
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
    /** Non-compact only: the pulse band between the header and the workbench. */
    summaryBar: {
      paddingHorizontal: gutter,
      paddingVertical: 14,
      gap: 12,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    pulseRow: { flexDirection: "row", flexWrap: "wrap", columnGap: compact ? 18 : 32, rowGap: 8 },
    pulseCell: { minWidth: compact ? 62 : 78, gap: 2 },
    pulseValue: { color: theme.colors.foreground, fontSize: compact ? 19 : 22, fontWeight: "600" },
    pulseLabel: { color: theme.colors.foregroundMuted, fontSize: 10 },
    workbench: { flex: 1, flexDirection: "row" },
    masterPane: {
      flex: 4,
      minWidth: 0,
      borderRightWidth: 1,
      borderRightColor: theme.colors.border,
    },
    masterHeader: {
      paddingHorizontal: gutter,
      paddingTop: 14,
      paddingBottom: 12,
      gap: 12,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    controlStack: { gap: 12, paddingBottom: 4 },
    detailPane: { flex: 5, minWidth: 0 },
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
    rowTitle: { color: theme.colors.foreground, fontSize: 13, lineHeight: 18 },
    rowMeta: { color: theme.colors.foregroundMuted, fontSize: 10 },
    rowNote: { color: theme.colors.foregroundMuted, fontSize: 11, lineHeight: 16 },
    metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    tagText: { color: theme.colors.foregroundMuted, fontSize: 10 },
    divider: { height: 1, backgroundColor: theme.colors.border, opacity: 0.6 },
    body: { color: theme.colors.foreground, fontSize: 12, lineHeight: 18 },
    muted: { color: theme.colors.foregroundMuted, fontSize: 11, lineHeight: 16 },
    danger: { color: theme.colors.statusDanger, fontSize: 11, lineHeight: 16 },
    searchRow: { flexDirection: "row", gap: 8, alignItems: "center" },
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
  };
}
