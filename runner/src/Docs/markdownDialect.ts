// The repo's Markdown dialect for a Doc: a Section per `## <heading>`, and per
// `# <heading>` for its text before its first H2, named by its heading path; no
// comment markers. The reader (`DocReader.ts`) builds and splits Markdown, and the
// writer (`SectionWriter.ts`) parses it, through `markdownDialect/blockParse.ts`,
// so every Markdown form has one home.
// Nothing here knows the Docs API; that layer is `googleDocs.ts`.

import type { TextSpan } from "./InlineParser.ts";

/** One run of inline Markdown, its text already escaped. */
export interface InlineRun {
  markdown: string;
  isBold: boolean;
  isItalic: boolean;
  target: string | undefined;
}

export type SpanStyle = Omit<TextSpan, "text">;

export type ListKind = "bulleted" | "numbered";

/** A top-level piece of the Markdown: a list item joins the item before it with no blank line. */
export interface MarkdownBlock {
  markdown: string;
  isListItem: boolean;
}

/** An H1 or H2: a heading that starts a Section. */
export interface SectionHeading {
  level: number;
  text: string;
}

/** A Section heading with its heading path. */
export type WithPath<SH extends SectionHeading> = SH & { path: string };

const syntax = {
  sectionLevel: 2,
  pathSeparator: " › ",
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

  /** Each H1 and H2 with its Section's heading path: an H1's text, an H2's under the H1 before it, or an H2's alone before any H1. */
  withPathsOf<SH extends SectionHeading>(headings: SH[]): WithPath<SH>[] {
    let h1: string | undefined;
    const pathed: WithPath<SH>[] = [];
    for (const heading of headings) {
      if (heading.level < syntax.sectionLevel) {
        h1 = heading.text;
        pathed.push({ ...heading, path: heading.text });
        continue;
      }
      const path =
        h1 === undefined
          ? heading.text
          : `${h1}${syntax.pathSeparator}${heading.text}`;
      pathed.push({ ...heading, path });
    }
    return pathed;
  },

  /** Each Section's body by its heading path, the Markdown before the first H1 or H2 left out. */
  sectionsOf(markdown: string): Map<string, string> {
    const chunks = markdown
      .split("\n")
      .reduce<(SectionHeading & { lines: string[] })[]>((split, line) => {
        const level = headingLevelOf(line);
        if (level === undefined || level > syntax.sectionLevel) {
          split.at(-1)?.lines.push(line);
          return split;
        }
        split.push({ level, text: line.slice(level + 1), lines: [] });
        return split;
      }, []);
    return markdownDialect
      .withPathsOf(chunks)
      .reduce((sections, { path, lines }) => {
        if (sections.has(path)) {
          throw new Error(`Two Sections share the heading path "${path}".`);
        }
        return sections.set(path, `${lines.join("\n").trim()}\n`);
      }, new Map<string, string>());
  },
};

export interface ListItem {
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

export function headingLevelOf(line: string): number | undefined {
  const match = /^(#{1,6}) /.exec(line);
  return match?.[1]?.length;
}
