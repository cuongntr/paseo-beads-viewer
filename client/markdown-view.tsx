import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Text, View } from "react-native";
import {
  parseMarkdown,
  type InlineSegment,
  type MarkdownBlock,
  type MarkdownDocument,
} from "./markdown";
import type { PanelStyles } from "./styles";

/**
 * Renders the bounded Markdown subset from {@link parseMarkdown} with React
 * Native primitives and theme tokens only.
 *
 * Links are shown as accent-coloured label plus visible target and are *not*
 * pressable: the panel is read-only and must never hand an issue-authored URL to
 * `Linking`. Malformed Markdown degrades to plain paragraphs upstream, so this
 * component has no error path of its own.
 */
export function MarkdownView({
  styles,
  theme,
  source,
  parsed,
}: {
  readonly styles: PanelStyles;
  readonly theme: PluginTheme;
  readonly source?: string | null;
  /** Pre-parsed document; when absent, `source` is parsed here. */
  readonly parsed?: MarkdownDocument;
}) {
  const md = parsed ?? parseMarkdown(source ?? null);
  if (md.blocks.length === 0) return null;
  return (
    <View style={styles.markdownStack}>
      {md.blocks.map((block, index) => (
        <MarkdownBlockView key={index} styles={styles} theme={theme} block={block} />
      ))}
      {md.truncated ? <Text style={styles.markdownTruncated}>…truncated for display</Text> : null}
    </View>
  );
}

function MarkdownBlockView({
  styles,
  theme,
  block,
}: {
  readonly styles: PanelStyles;
  readonly theme: PluginTheme;
  readonly block: MarkdownBlock;
}) {
  switch (block.kind) {
    case "heading":
      return (
        <Text
          accessibilityRole="header"
          style={
            block.level === 1
              ? styles.markdownHeading1
              : block.level === 2
                ? styles.markdownHeading2
                : styles.markdownHeading3
          }
        >
          <Inline styles={styles} segments={block.inline} />
        </Text>
      );
    case "paragraph":
      return (
        <Text style={styles.markdownParagraph}>
          <Inline styles={styles} segments={block.inline} />
        </Text>
      );
    case "listItem":
      return (
        <View style={[styles.markdownListRow, { paddingLeft: block.depth * 14 }]}>
          {block.checked === null ? (
            <Text style={styles.markdownListMarker}>{block.marker}</Text>
          ) : (
            <View style={styles.markdownTaskMark}>
              <Icon name={block.checked ? "SquareCheck" : "Square"} size={13} color={block.checked ? theme.colors.statusSuccess : theme.colors.foregroundMuted} />
            </View>
          )}
          <Text style={styles.markdownListText}>
            <Inline styles={styles} segments={block.inline} />
          </Text>
        </View>
      );
    case "quote":
      return (
        <View style={styles.markdownQuote}>
          <Text style={styles.markdownQuoteText}>
            <Inline styles={styles} segments={block.inline} />
          </Text>
        </View>
      );
    case "rule":
      return <View accessibilityRole="none" style={styles.markdownRule} />;
    case "code":
      return (
        <View style={styles.markdownCodeBlock}>
          {block.language === null ? null : (
            <Text style={styles.markdownCodeLanguage}>{block.language}</Text>
          )}
          {block.lines.map((line, index) => (
            <Text key={index} style={styles.markdownCodeText}>
              {line.length === 0 ? " " : line}
            </Text>
          ))}
        </View>
      );
  }
}

function Inline({
  styles,
  segments,
}: {
  readonly styles: PanelStyles;
  readonly segments: readonly InlineSegment[];
}) {
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.code) {
          return (
            <Text key={index} style={styles.markdownInlineCode}>
              {segment.text}
            </Text>
          );
        }
        const emphasis = [
          segment.strong ? styles.markdownStrong : null,
          segment.emphasis ? styles.markdownEmphasis : null,
        ];
        if (segment.href === null) {
          return (
            <Text key={index} style={emphasis}>
              {segment.text}
            </Text>
          );
        }
        // The URL is shown rather than hidden behind the label: the panel never
        // opens links, so the reader has to be able to read the target.
        return (
          <Text key={index} style={[styles.markdownLink, ...emphasis]}>
            {segment.text}
            <Text style={styles.markdownLinkTarget}>{` (${segment.href})`}</Text>
          </Text>
        );
      })}
    </>
  );
}
