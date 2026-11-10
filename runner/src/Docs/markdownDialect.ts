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

/** A heading or paragraph parsed back from the dialect; a paragraph has no level. */
export interface ParsedBlock {
  level: number | undefined;
  spans: TextSpan[];
}

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

  /** A Section body's headings and paragraphs; lists, tables and footnotes are refused. */
  blocksOf(sectionMarkdown: string): ParsedBlock[] {
    return sectionMarkdown
      .trim()
      .split(/\n{2,}/)
      .filter((block) => block !== "")
      .map(parsedBlock);
  },
};

function parsedBlock(block: string): ParsedBlock {
  if (/\n|^(\s*[-+] |\s*\d+\. |\||\[\^)/.test(block)) {
    throw new Error(
      `The writer takes only headings and paragraphs, not "${block.split("\n")[0]}".`,
    );
  }
  const level = headingLevelOf(block);
  if (level !== undefined && level <= syntax.sectionLevel) {
    throw new Error(`A Section's body holds no heading "${block}".`);
  }
  const inline = level === undefined ? block : block.slice(level + 1);
  const spans = InlineParser.init(inline, syntax.lineBreak).spans();
  return { level, spans };
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
