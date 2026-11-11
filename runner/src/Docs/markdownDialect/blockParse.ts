// The dialect's parse of a Section body back into blocks, for the writer
// (`SectionWriter.ts`). The forms it reads are `markdownDialect.ts`'s, which
// never imports this file.

import { InlineParser, type TextSpan } from "../InlineParser.ts";
import {
  headingLevelOf,
  type ListItem,
  type ListKind,
  markdownDialect,
} from "../markdownDialect.ts";

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

const { syntax } = markdownDialect;

export const blockParse = {
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
  if (!/^\|.*\|$/.test(line)) {
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
