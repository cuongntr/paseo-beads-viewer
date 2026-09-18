/**
 * A bounded, dependency-free Markdown subset parser.
 *
 * Beads issue bodies, acceptance criteria, and comments are authored as Markdown
 * by humans and agents, so rendering them as one flat paragraph loses the
 * structure that carries the meaning. The plugin has no runtime dependency and
 * must never be the thing that hangs the app, so this parser:
 *
 * - accepts a fixed subset (ATX h1-h3, paragraphs, lists, task items,
 *   blockquotes, thematic rules, fenced code, inline code, bold, italic, links),
 * - bounds input length, line count, block count, inline segments, and nesting,
 * - never throws: anything unrecognised or unclosed degrades to readable text.
 *
 * It is pure so it can be unit tested in the Vitest node environment.
 */

/** Input beyond this many characters is dropped; the document is marked truncated. */
export const MARKDOWN_MAX_CHARS = 12_000;
/** Lines beyond this count are dropped. */
export const MARKDOWN_MAX_LINES = 500;
/** Blocks beyond this count are dropped. */
export const MARKDOWN_MAX_BLOCKS = 160;
/** Inline segments per block; a hostile marker soup cannot exceed this. */
export const MARKDOWN_MAX_INLINE_SEGMENTS = 96;
/** Emphasis/link nesting depth before the rest is emitted as plain text. */
export const MARKDOWN_MAX_INLINE_DEPTH = 4;
/** List indentation levels that are visually distinguished. */
export const MARKDOWN_MAX_LIST_DEPTH = 3;
/** Lines kept inside one fenced code block. */
export const MARKDOWN_MAX_CODE_LINES = 80;
/** Characters kept for one run. A run may span the globally bounded input. */
export const MARKDOWN_MAX_SEGMENT_CHARS = MARKDOWN_MAX_CHARS;
/** Characters kept for a link target. */
export const MARKDOWN_MAX_HREF_CHARS = 300;

/**
 * One styled run of inline text. Marks are flattened onto the run rather than
 * nested, so the renderer is a single map over a flat list.
 */
export interface InlineSegment {
  readonly text: string;
  readonly strong: boolean;
  readonly emphasis: boolean;
  readonly code: boolean;
  /** Link target when this run came from `[label](target)`, else `null`. */
  readonly href: string | null;
}

export type MarkdownBlock =
  | { readonly kind: "heading"; readonly level: 1 | 2 | 3; readonly inline: readonly InlineSegment[] }
  | { readonly kind: "paragraph"; readonly inline: readonly InlineSegment[] }
  | {
      readonly kind: "listItem";
      readonly ordered: boolean;
      /** 0-based, clamped to {@link MARKDOWN_MAX_LIST_DEPTH} - 1. */
      readonly depth: number;
      /** Rendered bullet or number label, e.g. `•` or `2.`. */
      readonly marker: string;
      /** `null` when the item is not a task item. */
      readonly checked: boolean | null;
      readonly inline: readonly InlineSegment[];
    }
  | { readonly kind: "quote"; readonly inline: readonly InlineSegment[] }
  | { readonly kind: "rule" }
  | { readonly kind: "code"; readonly language: string | null; readonly lines: readonly string[] };

export interface MarkdownDocument {
  readonly blocks: readonly MarkdownBlock[];
  /** True when input was cut by a character, line, or block bound. */
  readonly truncated: boolean;
}

const EMPTY_DOCUMENT: MarkdownDocument = { blocks: [], truncated: false };

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*)$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*(\S*)[ \t]*$/;
const RULE = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const LIST_ITEM = /^( {0,16})([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const TASK_MARK = /^\[([ xX])\][ \t]+(.*)$/;
const LINK = /^\[([^\][]{0,200})\]\(([^\s()]{0,300})\)/;
const TRAILING_HASHES = /[ \t]+#+[ \t]*$/;

/**
 * Parses a Markdown subset. Never throws; unparseable input degrades to text.
 */
export function parseMarkdown(input: string | null): MarkdownDocument {
  if (input === null) return EMPTY_DOCUMENT;
  const normalized = normalizeSource(input);
  if (normalized.text.length === 0) return { blocks: [], truncated: normalized.truncated };

  const rawLines = normalized.text.split("\n");
  const lines = rawLines.slice(0, MARKDOWN_MAX_LINES);
  let truncated = normalized.truncated || rawLines.length > lines.length;

  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let quote: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(" ");
    paragraph = [];
    push({ kind: "paragraph", inline: parseInlineText(text) });
  };
  const flushQuote = (): void => {
    if (quote.length === 0) return;
    const text = quote.join(" ");
    quote = [];
    push({ kind: "quote", inline: parseInlineText(text) });
  };
  const flush = (): void => {
    flushParagraph();
    flushQuote();
  };
  function push(block: MarkdownBlock): void {
    if (blocks.length >= MARKDOWN_MAX_BLOCKS) {
      truncated = true;
      return;
    }
    blocks.push(block);
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    const fence = FENCE.exec(line);
    if (fence !== null) {
      flush();
      const marker = fence[1] ?? "```";
      const language = (fence[2] ?? "").length === 0 ? null : clampText(fence[2] ?? "", 40);
      const code: string[] = [];
      index += 1;
      // An unclosed fence simply ends at the last line; the body is still shown.
      for (; index < lines.length; index += 1) {
        const codeLine = lines[index] ?? "";
        if (isClosingFence(codeLine, marker)) break;
        if (code.length >= MARKDOWN_MAX_CODE_LINES) {
          truncated = true;
          continue;
        }
        code.push(clampText(codeLine, MARKDOWN_MAX_SEGMENT_CHARS));
      }
      push({ kind: "code", language, lines: code });
      continue;
    }

    if (line.trim().length === 0) {
      flush();
      continue;
    }

    if (RULE.test(line)) {
      flush();
      push({ kind: "rule" });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      flush();
      const hashes = (heading[1] ?? "#").length;
      const level = (hashes > 3 ? 3 : hashes) as 1 | 2 | 3;
      const text = (heading[2] ?? "").replace(TRAILING_HASHES, "").trim();
      push({ kind: "heading", level, inline: parseInlineText(text) });
      continue;
    }

    const quoteLine = QUOTE.exec(line);
    if (quoteLine !== null) {
      flushParagraph();
      quote.push((quoteLine[1] ?? "").trim());
      continue;
    }
    flushQuote();

    const item = LIST_ITEM.exec(line);
    if (item !== null) {
      flushParagraph();
      const indent = (item[1] ?? "").length;
      const bullet = item[2] ?? "-";
      const ordered = /\d/.test(bullet);
      const depth = Math.min(Math.floor(indent / 2), MARKDOWN_MAX_LIST_DEPTH - 1);
      const task = TASK_MARK.exec(item[3] ?? "");
      const checked = task === null ? null : (task[1] ?? " ").toLowerCase() === "x";
      const content = task === null ? (item[3] ?? "") : (task[2] ?? "");
      push({
        kind: "listItem",
        ordered,
        depth,
        marker: ordered ? bullet : bulletFor(depth),
        checked,
        inline: parseInlineText(content),
      });
      continue;
    }

    paragraph.push(line.trim());
  }

  flush();
  return { blocks, truncated };
}

/** True when `text` contains anything the renderer would show as structure. */
export function hasMarkdownStructure(text: string): boolean {
  return parseMarkdown(text).blocks.some((block) => block.kind !== "paragraph");
}

/** Plain-text projection of a parsed document, for accessibility labels. */
export function markdownToPlainText(parsed: MarkdownDocument, maxChars = 400): string {
  const parts: string[] = [];
  for (const block of parsed.blocks) {
    if (block.kind === "rule") continue;
    if (block.kind === "code") {
      parts.push(block.lines.join(" "));
      continue;
    }
    const prefix = block.kind === "listItem" ? `${block.marker} ` : "";
    parts.push(prefix + block.inline.map((segment) => segment.text).join(""));
    if (parts.join(" ").length > maxChars) break;
  }
  return clampText(parts.join(" ").replace(/\s+/g, " ").trim(), maxChars);
}

function isClosingFence(line: string, marker: string): boolean {
  const trimmed = line.trim();
  const char = marker[0] ?? "`";
  if (trimmed.length < marker.length) return false;
  for (const candidate of trimmed) {
    if (candidate !== char) return false;
  }
  return true;
}

function bulletFor(depth: number): string {
  if (depth <= 0) return "•";
  if (depth === 1) return "◦";
  return "▪";
}

interface NormalizedSource {
  readonly text: string;
  readonly truncated: boolean;
}

/**
 * Collapses line endings, expands tabs, and strips control characters so a
 * hostile payload cannot smuggle terminal escapes into a `Text` node.
 */
function normalizeSource(input: string): NormalizedSource {
  const bounded = input.length > MARKDOWN_MAX_CHARS ? input.slice(0, MARKDOWN_MAX_CHARS) : input;
  const text = bounded
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "  ")
    // eslint-disable-next-line no-control-regex -- deliberately stripping C0/C1 except newline.
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, "");
  return { text: text.trim(), truncated: bounded.length < input.length };
}

function clampText(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}…` : value;
}

interface Marks {
  readonly strong: boolean;
  readonly emphasis: boolean;
}

const PLAIN: Marks = { strong: false, emphasis: false };

/** Parses one logical line of inline Markdown into flat styled runs. */
export function parseInlineText(source: string): readonly InlineSegment[] {
  const out: InlineSegment[] = [];
  parseInline(source, PLAIN, null, 0, out);
  return out;
}

function parseInline(
  source: string,
  marks: Marks,
  href: string | null,
  depth: number,
  out: InlineSegment[],
): void {
  if (source.length === 0) return;
  if (depth > MARKDOWN_MAX_INLINE_DEPTH) {
    pushRun(out, source, marks, href, false);
    return;
  }

  let cursor = 0;
  let plainStart = 0;
  const flushPlain = (end: number): void => {
    if (end > plainStart) pushRun(out, source.slice(plainStart, end), marks, href, false);
  };

  while (cursor < source.length) {
    if (out.length >= MARKDOWN_MAX_INLINE_SEGMENTS - 1) {
      // Reserve the final segment for readable plain-text fallback. Nested or
      // marker-heavy input may stop receiving rich styling, but its tail must
      // not silently disappear.
      pushRemainder(out, source.slice(plainStart));
      return;
    }
    const char = source[cursor] ?? "";

    if (char === "\\" && cursor + 1 < source.length) {
      // Escaped punctuation is emitted literally without its backslash.
      flushPlain(cursor);
      pushRun(out, source[cursor + 1] ?? "", marks, href, false);
      cursor += 2;
      plainStart = cursor;
      continue;
    }

    if (char === "`") {
      const run = runLength(source, cursor, "`");
      const closing = source.indexOf("`".repeat(run), cursor + run);
      if (closing > cursor + run - 1) {
        flushPlain(cursor);
        pushRun(out, source.slice(cursor + run, closing).trim(), marks, href, true);
        cursor = closing + run;
        plainStart = cursor;
        continue;
      }
      cursor += run;
      continue;
    }

    if (char === "[" && href === null) {
      const link = LINK.exec(source.slice(cursor));
      if (link !== null) {
        const target = clampText((link[2] ?? "").trim(), MARKDOWN_MAX_HREF_CHARS);
        const label = link[1] ?? "";
        flushPlain(cursor);
        if (target.length === 0) {
          pushRun(out, label, marks, href, false);
        } else {
          parseInline(label.length === 0 ? target : label, marks, target, depth + 1, out);
        }
        cursor += (link[0] ?? "").length;
        plainStart = cursor;
        continue;
      }
      cursor += 1;
      continue;
    }

    if (char === "*" || char === "_") {
      const run = Math.min(runLength(source, cursor, char), 2);
      const marker = char.repeat(run);
      const contentStart = cursor + run;
      const closing = findEmphasisClose(source, contentStart, marker, char);
      const intraword = char === "_" && isWordChar(source[cursor - 1]);
      if (closing > contentStart && !intraword) {
        flushPlain(cursor);
        const next: Marks =
          run === 2 ? { strong: true, emphasis: marks.emphasis } : { strong: marks.strong, emphasis: true };
        parseInline(source.slice(contentStart, closing), next, href, depth + 1, out);
        cursor = closing + run;
        plainStart = cursor;
        continue;
      }
      cursor += run;
      continue;
    }

    cursor += 1;
  }

  flushPlain(source.length);
}

function findEmphasisClose(source: string, from: number, marker: string, char: string): number {
  let search = from;
  while (search < source.length) {
    const found = source.indexOf(marker, search);
    if (found < 0) return -1;
    if (char === "_" && isWordChar(source[found + marker.length])) {
      search = found + marker.length;
      continue;
    }
    return found;
  }
  return -1;
}

function runLength(source: string, from: number, char: string): number {
  let length = 0;
  while (source[from + length] === char) length += 1;
  return length;
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9]/.test(char);
}

/** Keeps the unparsed tail readable when the inline-segment budget is exhausted. */
function pushRemainder(out: InlineSegment[], text: string): void {
  if (text.length === 0) return;
  const remainder = clampText(text, MARKDOWN_MAX_SEGMENT_CHARS);
  if (out.length < MARKDOWN_MAX_INLINE_SEGMENTS) {
    out.push({ text: remainder, strong: false, emphasis: false, code: false, href: null });
    return;
  }
  const last = out[out.length - 1];
  if (last === undefined) return;
  out[out.length - 1] = {
    text: clampText(last.text + remainder, MARKDOWN_MAX_SEGMENT_CHARS),
    strong: false,
    emphasis: false,
    code: false,
    href: null,
  };
}


/** Appends a run, merging into the previous run when the styling is identical. */
function pushRun(out: InlineSegment[], text: string, marks: Marks, href: string | null, code: boolean): void {
  if (text.length === 0) return;
  if (out.length >= MARKDOWN_MAX_INLINE_SEGMENTS) return;
  const last = out[out.length - 1];
  if (
    last !== undefined &&
    last.code === code &&
    last.strong === marks.strong &&
    last.emphasis === marks.emphasis &&
    last.href === href
  ) {
    out[out.length - 1] = { ...last, text: clampText(last.text + text, MARKDOWN_MAX_SEGMENT_CHARS) };
    return;
  }
  out.push({ text, strong: marks.strong, emphasis: marks.emphasis, code, href });
}
