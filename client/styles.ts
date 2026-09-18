import type { PluginTheme } from "@getpaseo/plugin";
import type { TextStyle, ViewStyle } from "react-native";

/**
 * Visual direction: a quiet dependency console. A single vertical status rail on
 * the left carries all state colour; everything to its right is flat, dense text
 * on one surface. No cards, no shadows, no gradients, no coloured panels.
 */
export interface PanelStyles {
  readonly screen: ViewStyle;
  readonly scroll: ViewStyle;
  readonly scrollContent: ViewStyle;
  readonly headerRow: ViewStyle;
  readonly headerText: ViewStyle;
  readonly title: TextStyle;
  readonly subtitle: TextStyle;
  readonly action: ViewStyle;
  readonly actionPressed: ViewStyle;
  readonly actionText: TextStyle;
  readonly pulseRow: ViewStyle;
  readonly pulseCell: ViewStyle;
  readonly pulseValue: TextStyle;
  readonly pulseLabel: TextStyle;
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
  readonly detailBlock: ViewStyle;
  readonly detailLabel: TextStyle;
  readonly detailText: TextStyle;
  readonly monoMeta: TextStyle;
}

export function createPanelStyles(theme: PluginTheme, compact: boolean): PanelStyles {
  const gutter = compact ? 12 : 18;
  const rowGap = compact ? 8 : 10;
  return {
    screen: { flex: 1, backgroundColor: theme.colors.surface0 },
    scroll: { flex: 1 },
    scrollContent: { paddingHorizontal: gutter, paddingTop: gutter, paddingBottom: gutter * 2, gap: rowGap },
    headerRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
    headerText: { flex: 1, gap: 2 },
    title: { color: theme.colors.foreground, fontSize: compact ? 15 : 17, fontWeight: "600" },
    subtitle: { color: theme.colors.foregroundMuted, fontSize: 11 },
    action: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 4,
      backgroundColor: theme.colors.surface1,
    },
    actionPressed: { backgroundColor: theme.colors.surface2 },
    actionText: { color: theme.colors.foreground, fontSize: 11, fontWeight: "600" },
    pulseRow: { flexDirection: "row", flexWrap: "wrap", gap: compact ? 10 : 18, paddingVertical: 2 },
    pulseCell: { minWidth: compact ? 58 : 70, gap: 1 },
    pulseValue: { color: theme.colors.foreground, fontSize: compact ? 18 : 20, fontWeight: "600" },
    pulseLabel: { color: theme.colors.foregroundMuted, fontSize: 10 },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: 8,
      paddingTop: rowGap,
    },
    sectionTitle: {
      color: theme.colors.foreground,
      fontSize: 12,
      fontWeight: "700",
    },
    sectionMeta: { color: theme.colors.foregroundMuted, fontSize: 10 },
    railRow: { flexDirection: "row", gap: 10, paddingVertical: 5 },
    railRowSelected: { backgroundColor: theme.colors.surface1 },
    rail: { width: 3, borderRadius: 2, alignSelf: "stretch", minHeight: 18 },
    railBody: { flex: 1, gap: 2 },
    rowTitle: { color: theme.colors.foreground, fontSize: 13 },
    rowMeta: { color: theme.colors.foregroundMuted, fontSize: 10 },
    rowNote: { color: theme.colors.foregroundMuted, fontSize: 11 },
    metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    tagText: { color: theme.colors.foregroundMuted, fontSize: 10 },
    divider: { height: 1, backgroundColor: theme.colors.border, opacity: 0.6 },
    body: { color: theme.colors.foreground, fontSize: 12 },
    muted: { color: theme.colors.foregroundMuted, fontSize: 11 },
    danger: { color: theme.colors.statusDanger, fontSize: 11 },
    searchRow: { flexDirection: "row", gap: 8, alignItems: "center" },
    input: {
      flex: 1,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 4,
      paddingHorizontal: 8,
      paddingVertical: compact ? 6 : 7,
      color: theme.colors.foreground,
      backgroundColor: theme.colors.surface1,
      fontSize: 12,
    },
    detailBlock: { gap: 3, paddingTop: 4 },
    detailLabel: {
      color: theme.colors.foregroundMuted,
      fontSize: 10,
      fontWeight: "600",
    },
    detailText: { color: theme.colors.foreground, fontSize: 12 },
    monoMeta: { color: theme.colors.foregroundMuted, fontSize: 10 },
  };
}
