import { describe, expect, it } from "vitest";
import {
  hasMarkdownStructure,
  markdownToPlainText,
  parseInlineText,
  parseMarkdown,
  MARKDOWN_MAX_BLOCKS,
  MARKDOWN_MAX_CHARS,
  MARKDOWN_MAX_CODE_LINES,
  MARKDOWN_MAX_INLINE_SEGMENTS,
  MARKDOWN_MAX_LINES,
  MARKDOWN_MAX_LIST_DEPTH,
  type MarkdownBlock,
} from "../client/markdown";

function kinds(source: string): readonly MarkdownBlock["kind"][] {
  return parseMarkdown(source).blocks.map((block) => block.kind);
}

function textOf(block: MarkdownBlock | undefined): string {
  if (block === undefined) return "";
  if (block.kind === "rule") return "";
  if (block.kind === "code") return block.lines.join("\n");
  return block.inline.map((segment) => segment.text).join("");
}

describe("block parsing", () => {
  it("reads ATX headings h1-h3 and clamps deeper levels", () => {
    const blocks = parseMarkdown("# One\n\n## Two\n\n### Three\n\n##### Five").blocks;
    expect(blocks.map((block) => (block.kind === "heading" ? block.level : null))).toEqual([1, 2, 3, 3]);
    expect(textOf(blocks[0])).toBe("One");
  });

  it("strips closing hashes from a heading", () => {
    expect(textOf(parseMarkdown("## Scope ##").blocks[0])).toBe("Scope");
  });

  it("joins wrapped paragraph lines and splits on blank lines", () => {
    const blocks = parseMarkdown("first line\nsecond line\n\nnext para").blocks;
    expect(blocks).toHaveLength(2);
    expect(textOf(blocks[0])).toBe("first line second line");
    expect(textOf(blocks[1])).toBe("next para");
  });

  it("reads unordered and ordered list items with bounded nesting", () => {
    const blocks = parseMarkdown("- top\n  - nested\n    - deeper\n      - deepest\n1. first\n2) second").blocks;
    const items = blocks.filter((block) => block.kind === "listItem");
    expect(items).toHaveLength(6);
    const depths = items.map((item) => (item.kind === "listItem" ? item.depth : -1));
    expect(Math.max(...depths)).toBeLessThanOrEqual(MARKDOWN_MAX_LIST_DEPTH - 1);
    const ordered = items.filter((item) => item.kind === "listItem" && item.ordered);
    expect(ordered).toHaveLength(2);
    expect(ordered.map((item) => (item.kind === "listItem" ? item.marker : ""))).toEqual(["1.", "2)"]);
  });

  it("reads task-list checkboxes and leaves plain items unchecked-null", () => {
    const blocks = parseMarkdown("- [ ] todo\n- [x] done\n- [X] also done\n- plain").blocks;
    expect(blocks.map((block) => (block.kind === "listItem" ? block.checked : "?"))).toEqual([
      false,
      true,
      true,
      null,
    ]);
    expect(textOf(blocks[0])).toBe("todo");
  });

  it("merges consecutive blockquote lines into one quote", () => {
    const blocks = parseMarkdown("> quoted\n> continued\n\nafter").blocks;
    expect(kinds("> quoted\n> continued\n\nafter")).toEqual(["quote", "paragraph"]);
    expect(textOf(blocks[0])).toBe("quoted continued");
  });

  it("reads thematic rules in all three marker forms", () => {
    expect(kinds("---\n\n***\n\n___")).toEqual(["rule", "rule", "rule"]);
  });

  it("reads a fenced code block with a language and preserves its lines verbatim", () => {
    const blocks = parseMarkdown("```ts\nconst a = 1;\n  indented\n```").blocks;
    const block = blocks[0];
    expect(block?.kind).toBe("code");
    if (block?.kind !== "code") return;
    expect(block.language).toBe("ts");
    expect(block.lines).toEqual(["const a = 1;", "  indented"]);
  });

  it("does not treat markers inside a fence as structure", () => {
    expect(kinds("```\n# not a heading\n- not a list\n```")).toEqual(["code"]);
  });

  it("normalises CRLF and drops control characters", () => {
    const blocks = parseMarkdown("# Title\r\n\r\nbody\u0007text").blocks;
    expect(kinds("# Title\r\n\r\nbody")).toEqual(["heading", "paragraph"]);
    expect(textOf(blocks[1])).toBe("bodytext");
  });

  it("returns an empty document for null, blank, and whitespace input", () => {
    expect(parseMarkdown(null).blocks).toEqual([]);
    expect(parseMarkdown("").blocks).toEqual([]);
    expect(parseMarkdown("   \n\n \t ").blocks).toEqual([]);
  });
});

describe("inline parsing", () => {
  it("reads bold, italic, and bold-italic", () => {
    expect(parseInlineText("**bold** and *ital* and _under_")).toEqual([
      { text: "bold", strong: true, emphasis: false, code: false, href: null },
      { text: " and ", strong: false, emphasis: false, code: false, href: null },
      { text: "ital", strong: false, emphasis: true, code: false, href: null },
      { text: " and ", strong: false, emphasis: false, code: false, href: null },
      { text: "under", strong: false, emphasis: true, code: false, href: null },
    ]);
    expect(parseInlineText("**_both_**")).toEqual([
      { text: "both", strong: true, emphasis: true, code: false, href: null },
    ]);
  });

  it("reads inline code and does not style inside it", () => {
    expect(parseInlineText("run `npm **test**` now")).toEqual([
      { text: "run ", strong: false, emphasis: false, code: false, href: null },
      { text: "npm **test**", strong: false, emphasis: false, code: true, href: null },
      { text: " now", strong: false, emphasis: false, code: false, href: null },
    ]);
  });

  it("reads a link into an accent segment carrying its target", () => {
    expect(parseInlineText("see [docs](https://example.test/a) here")).toEqual([
      { text: "see ", strong: false, emphasis: false, code: false, href: null },
      { text: "docs", strong: false, emphasis: false, code: false, href: "https://example.test/a" },
      { text: " here", strong: false, emphasis: false, code: false, href: null },
    ]);
  });

  it("falls back to the target when a link has no label", () => {
    expect(parseInlineText("[](https://example.test/x)")).toEqual([
      { text: "https://example.test/x", strong: false, emphasis: false, code: false, href: "https://example.test/x" },
    ]);
  });

  it("keeps emphasis inside a link label", () => {
    expect(parseInlineText("[**bold link**](https://example.test)")).toEqual([
      { text: "bold link", strong: true, emphasis: false, code: false, href: "https://example.test" },
    ]);
  });

  it("does not split intraword underscores", () => {
    expect(parseInlineText("issue_id_value")).toEqual([
      { text: "issue_id_value", strong: false, emphasis: false, code: false, href: null },
    ]);
  });

  it("emits escaped punctuation literally", () => {
    expect(parseInlineText("\\*not italic\\*")).toEqual([
      { text: "*not italic*", strong: false, emphasis: false, code: false, href: null },
    ]);
  });

  it("preserves a long plain paragraph within the document bound", () => {
    const source = "x".repeat(5_000);
    expect(parseInlineText(source).map((segment) => segment.text).join("")).toBe(source);
  });

  it("keeps a readable tail when the inline-segment budget is exhausted", () => {
    const source = `${Array.from(
      { length: MARKDOWN_MAX_INLINE_SEGMENTS + 40 },
      (_, index) => `**b${index}**`,
    ).join(" ")} TAIL`;
    const segments = parseInlineText(source);
    expect(segments.length).toBeLessThanOrEqual(MARKDOWN_MAX_INLINE_SEGMENTS);
    expect(segments.map((segment) => segment.text).join("")).toContain("TAIL");
  });
});

describe("malformed input degrades instead of throwing", () => {
  it("treats an unclosed emphasis marker as plain text", () => {
    expect(parseInlineText("**unclosed bold")).toEqual([
      { text: "**unclosed bold", strong: false, emphasis: false, code: false, href: null },
    ]);
    expect(parseInlineText("half *open _mess")).toEqual([
      { text: "half *open _mess", strong: false, emphasis: false, code: false, href: null },
    ]);
  });

  it("treats an unclosed backtick as plain text", () => {
    expect(parseInlineText("a `code start")).toEqual([
      { text: "a `code start", strong: false, emphasis: false, code: false, href: null },
    ]);
  });

  it("treats a malformed link as plain text", () => {
    expect(parseInlineText("[label](no closing")).toEqual([
      { text: "[label](no closing", strong: false, emphasis: false, code: false, href: null },
    ]);
    expect(parseInlineText("[label]")).toEqual([
      { text: "[label]", strong: false, emphasis: false, code: false, href: null },
    ]);
  });

  it("closes an unclosed fence at the end of input and keeps the body", () => {
    const block = parseMarkdown("```\nline one\nline two").blocks[0];
    expect(block?.kind).toBe("code");
    if (block?.kind !== "code") return;
    expect(block.lines).toEqual(["line one", "line two"]);
  });

  it("never throws on adversarial marker soup", () => {
    const hostile = [
      "*".repeat(400),
      "`".repeat(400),
      "[".repeat(400),
      "](".repeat(200),
      "> ".repeat(200),
      "#".repeat(200),
      "- ".repeat(200),
      "\\".repeat(200),
      "___***___***",
    ].join("\n");
    expect(() => parseMarkdown(hostile)).not.toThrow();
    expect(parseMarkdown(hostile).blocks.length).toBeLessThanOrEqual(MARKDOWN_MAX_BLOCKS);
  });
});

describe("bounds", () => {
  it("truncates input beyond the character bound and reports it", () => {
    const document = parseMarkdown("x".repeat(MARKDOWN_MAX_CHARS + 500));
    expect(document.truncated).toBe(true);
    expect(textOf(document.blocks[0]).length).toBeLessThanOrEqual(MARKDOWN_MAX_CHARS);
  });

  it("drops lines beyond the line bound", () => {
    const document = parseMarkdown(
      Array.from({ length: MARKDOWN_MAX_LINES + 50 }, (_, index) => `# h${index}`).join("\n"),
    );
    expect(document.truncated).toBe(true);
    expect(document.blocks.length).toBeLessThanOrEqual(MARKDOWN_MAX_BLOCKS);
  });

  it("caps block count and marks the document truncated", () => {
    const document = parseMarkdown(
      Array.from({ length: MARKDOWN_MAX_BLOCKS + 40 }, (_, index) => `- item ${index}`).join("\n"),
    );
    expect(document.blocks).toHaveLength(MARKDOWN_MAX_BLOCKS);
    expect(document.truncated).toBe(true);
  });

  it("caps code lines inside one fence", () => {
    const body = Array.from({ length: MARKDOWN_MAX_CODE_LINES + 30 }, (_, index) => `line ${index}`).join("\n");
    const document = parseMarkdown(`\`\`\`\n${body}\n\`\`\``);
    const block = document.blocks[0];
    expect(block?.kind).toBe("code");
    if (block?.kind !== "code") return;
    expect(block.lines).toHaveLength(MARKDOWN_MAX_CODE_LINES);
    expect(document.truncated).toBe(true);
  });

  it("caps inline segments per block", () => {
    const source = Array.from({ length: MARKDOWN_MAX_INLINE_SEGMENTS + 40 }, (_, i) => `**b${i}** t${i}`).join(" ");
    expect(parseInlineText(source).length).toBeLessThanOrEqual(MARKDOWN_MAX_INLINE_SEGMENTS);
  });

  it("bounds deeply nested emphasis without unbounded recursion", () => {
    const nested = `${"**".repeat(40)}deep${"**".repeat(40)}`;
    expect(() => parseInlineText(nested)).not.toThrow();
    expect(parseInlineText(nested).length).toBeLessThanOrEqual(MARKDOWN_MAX_INLINE_SEGMENTS);
  });
});

describe("projections", () => {
  it("detects structure only when a non-paragraph block exists", () => {
    expect(hasMarkdownStructure("just prose across\ntwo lines")).toBe(false);
    expect(hasMarkdownStructure("- a list item")).toBe(true);
    expect(hasMarkdownStructure("## heading")).toBe(true);
  });

  it("flattens a document to bounded plain text", () => {
    const plain = markdownToPlainText(parseMarkdown("# Title\n\n- **one**\n- two\n\n---\n\n`code`"));
    expect(plain).toContain("Title");
    expect(plain).toContain("one");
    expect(plain).toContain("code");
    expect(markdownToPlainText(parseMarkdown("a".repeat(1000)), 50).length).toBeLessThanOrEqual(51);
  });
});
