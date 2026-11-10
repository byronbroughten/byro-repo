// The repo's Markdown dialect for a Doc: `## <heading>` per Section, no comment
// markers. The reader (`DocReader.ts`) builds and splits Markdown, and the
// writer (`SectionWriter.ts`) parses it, only through this bundle, so every
// Markdown form has one home.
// Nothing here knows the Docs API; that layer is `googleDocs.ts`.

import { InlineParser, type TextSpan } from "./InlineParser.ts";

/** One run of inline Markdown, its text already escaped. */
export interface InlineRun {
  markdown: string;
  isBold: boolean;
  isItalic: boolean;
  target: string | undefined;
}

export type SpanStyle = Omit<TextSpan, "text">;

export type ListKind = "bulleted" | "numbered";

/** A heading or paragraph parsed back from the dialect; a paragraph has no level. */
export interface ParsedParagraph {
  kind: "paragraph";
  level: number | undefined;
  spans: TextSpan[];
}

/** One flat list parsed back from the dialect; a numbered list ends where the next `1.` starts another. */
export interface ParsedList {
  kind: "list";
  listKind: ListKind;
  items: TextSpan[][];
}

/** A table parsed back from the dialect: its rows, header row first, of cells. */
export interface ParsedTable {
  kind: "table";
  rows: TextSpan[][][];
}

export type ParsedBlock = ParsedParagraph | ParsedList | ParsedTable;

/** A top-level piece of the Markdown: a list item joins the item before it with no blank line. */
export interface MarkdownBlock {
  markdown: string;
  isListItem: boolean;
}

const syntax = {
  sectionLevel: 2,
  listIndent: "    ",
  lineBreak: "<br>",
} as const;

export const markdownDialect = {
  syntax,

  isSameStyle(left: SpanStyle, right: SpanStyle): boolean {
    return (
      left.isBold === right.isBold &&
      left.isItalic === right.isItalic &&
      left.target === right.target
    );
  },

  escaped(text: string): string {
    return text.replace(/[\\*_[\]]/g, "\\$&");
  },

  /** A paragraph's text, a leading character that would start a block escaped. */
  paragraph(inline: string): string {
    const numbered = /^(\d+)\. /.exec(inline);
    if (numbered !== null) {
      return `${numbered[1]}\\. ${inline.slice(numbered[0].length)}`;
    }
    if (/^(#|>|[-+] )/.test(inline)) {
      return `\\${inline}`;
    }
    return inline;
  },

  heading(level: number, inline: string): string {
    return `${"#".repeat(level)} ${inline}`;
  },

  inline(runs: InlineRun[]): string {
    return linkGroupsOf(mergedRuns(runs))
      .map((group) => {
        const text = group.map(emphasized).join("");
        const target = group[0]?.target;
        if (target === undefined) {
          return text;
        }
        return `[${text}](${target})`;
      })
      .join("");
  },

  /** The link target for a heading in the same Doc, from its plain text. */
  headingTarget(headingText: string): string {
    const slug = headingText
      .toLowerCase()
      .replace(/[^\p{L}\p{N} _-]/gu, "")
      .replace(/ /g, "-");
    return `#${slug}`;
  },

  footnoteReference(footnoteNumber: string): string {
    return `[^${footnoteNumber}]`;
  },

  footnoteDefinition(footnoteNumber: string, inline: string): string {
    return `[^${footnoteNumber}]: ${inline}`;
  },

  listItem({ depth, ordinal, inline }: ListItem): string {
    const marker = ordinal === undefined ? "-" : `${ordinal}.`;
    return `${syntax.listIndent.repeat(depth)}${marker} ${inline}`;
  },

  /** A table whose first row is its header row; each cell is inline Markdown. */
  table(rows: string[][]): string {
    const [header, ...body] = rows;
    if (header === undefined) {
      return "";
    }
    const divider = header.map(() => "---");
    return [header, divider, ...body].map(tableRow).join("\n");
  },

  document(blocks: MarkdownBlock[]): string {
    const joined = blocks.reduce((markdown, block, index) => {
      if (index === 0) {
        return block.markdown;
      }
      const isInList = block.isListItem && blocks[index - 1]?.isListItem;
      return `${markdown}${isInList ? "\n" : "\n\n"}${block.markdown}`;
    }, "");
    return joined === "" ? "" : `${joined}\n`;
  },

  /** Each Section's body by its heading's text, the Markdown before the first Section left out. */
  sectionsOf(markdown: string): Map<string, string> {
    const sections = new Map<string, string>();
    const prefix = `${"#".repeat(syntax.sectionLevel)} `;
    let heading: string | undefined;
    let lines: string[] = [];
    function keep(): void {
      if (heading === undefined) {
        return;
      }
      if (sections.has(heading)) {
        throw new Error(`Two Sections share the heading "${heading}".`);
      }
      sections.set(heading, `${lines.join("\n").trim()}\n`);
    }
    markdown.split("\n").forEach((line) => {
      const level = headingLevelOf(line);
      if (level === undefined || level > syntax.sectionLevel) {
        lines.push(line);
        return;
      }
      keep();
      heading =
        level === syntax.sectionLevel ? line.slice(prefix.length) : undefined;
      lines = [];
    });
    keep();
    return sections;
  },

  /** A Section body's headings, paragraphs, flat lists and tables; nested lists and footnotes are refused. */
  blocksOf(sectionMarkdown: string): ParsedBlock[] {
    return sectionMarkdown
      .trim()
      .split(/\n{2,}/)
      .filter((block) => block !== "")
      .flatMap(parsedBlocks);
  },
};

function parsedBlocks(block: string): ParsedBlock[] {
  const lines = block.split("\n");
  if (block.startsWith("|")) {
    return [parsedTable(lines)];
  }
  if (flatItemOf(lines[0] ?? "") !== undefined) {
    return parsedLists(lines);
  }
  if (/\n|^(\s|\+ |\[\^)/.test(block)) {
    throw unwritable(block);
  }
  const level = headingLevelOf(block);
  if (level !== undefined && level <= syntax.sectionLevel) {
    throw new Error(`A Section's body holds no heading "${block}".`);
  }
  const inline = level === undefined ? block : block.slice(level + 1);
  return [{ kind: "paragraph", level, spans: spansOf(inline) }];
}

/** Consecutive items of one kind form one list, but a numbered list starts again at `1.`. */
function parsedLists(lines: string[]): ParsedList[] {
  return lines.reduce<ParsedList[]>((lists, line) => {
    const item = flatItemOf(line);
    if (item === undefined) {
      throw unwritable(line);
    }
    const listKind = item.ordinal === undefined ? "bulleted" : "numbered";
    const list = lists.at(-1);
    const spans = spansOf(item.inline);
    if (list?.listKind === listKind && item.ordinal !== 1) {
      if (
        item.ordinal !== undefined &&
        item.ordinal !== list.items.length + 1
      ) {
        throw miscounted(line);
      }
      list.items.push(spans);
      return lists;
    }
    if (item.ordinal !== undefined && item.ordinal !== 1) {
      throw miscounted(line);
    }
    lists.push({ kind: "list", listKind, items: [spans] });
    return lists;
  }, []);
}

/** A list item at the top level, its ordinal undefined when bulleted. */
function flatItemOf(line: string): Omit<ListItem, "depth"> | undefined {
  const match = /^(-|(\d+)\.) (.*)$/.exec(line);
  if (match === null) {
    return undefined;
  }
  const ordinal = match[2] === undefined ? undefined : Number(match[2]);
  return { ordinal, inline: match[3] ?? "" };
}

function parsedTable(lines: string[]): ParsedTable {
  const [header, divider, ...body] = lines.map(cellsOf);
  if (
    header === undefined ||
    divider?.every((cell) => /^:?-{3,}:?$/.test(cell)) !== true
  ) {
    throw new Error(
      `A table's second line divides off its header, not "${lines[1] ?? ""}".`,
    );
  }
  const rows = [header, ...body];
  if (rows.some((row) => row.length !== header.length)) {
    throw new Error(
      `Every row of a table has its header's ${header.length} cells.`,
    );
  }
  return { kind: "table", rows: rows.map((row) => row.map(spansOf)) };
}

/** A table row's cells, each still inline Markdown, a `\|` kept escaped. */
function cellsOf(line: string): string[] {
  if (!/^\|.*\|$/.test(line) || line.length < 2) {
    throw new Error(`A table row starts and ends with "|", not "${line}".`);
  }
  return [...line.slice(1).matchAll(/((?:\\.|[^\\|])*)\|/g)].map((match) =>
    (match[1] ?? "").trim(),
  );
}

function spansOf(inline: string): TextSpan[] {
  return InlineParser.init(inline, syntax.lineBreak).spans();
}

function unwritable(block: string): Error {
  return new Error(
    `The writer takes only headings, paragraphs, flat lists and tables, not "${block.split("\n")[0]}".`,
  );
}

function miscounted(line: string): Error {
  return new Error(`A numbered list counts up from 1, not "${line}".`);
}

interface ListItem {
  depth: number;
  ordinal: number | undefined;
  inline: string;
}

function mergedRuns(runs: InlineRun[]): InlineRun[] {
  return runs.reduce<InlineRun[]>((merged, run) => {
    const last = merged.at(-1);
    if (last !== undefined && markdownDialect.isSameStyle(last, run)) {
      last.markdown += run.markdown;
      return merged;
    }
    merged.push({ ...run });
    return merged;
  }, []);
}

function linkGroupsOf(runs: InlineRun[]): InlineRun[][] {
  return runs.reduce<InlineRun[][]>((groups, run) => {
    const group = groups.at(-1);
    if (group !== undefined && group[0]?.target === run.target) {
      group.push(run);
      return groups;
    }
    groups.push([run]);
    return groups;
  }, []);
}

/** Emphasis markers sit inside the run's edge whitespace, which Markdown needs. */
function emphasized(run: InlineRun): string {
  const marker = `${run.isItalic ? "*" : ""}${run.isBold ? "**" : ""}`;
  const match = /^(\s*)(.*?)(\s*)$/s.exec(run.markdown);
  if (marker === "" || match === null || match[2] === "") {
    return run.markdown;
  }
  const [, before, text, after] = match;
  return `${before}${marker}${text}${[...marker].reverse().join("")}${after}`;
}

function tableRow(cells: string[]): string {
  return `| ${cells.map((cell) => cell.replace(/\|/g, "\\|")).join(" | ")} |`;
}

function headingLevelOf(line: string): number | undefined {
  const match = /^(#{1,6}) /.exec(line);
  return match?.[1]?.length;
}
