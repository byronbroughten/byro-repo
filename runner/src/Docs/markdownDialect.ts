// The repo's Markdown dialect for a Doc: `## <heading>` per Section, no comment
// markers. The reader (`DocReader.ts`) and the later writer both build and split
// Markdown only through this bundle, so a pushed Section pulls back unchanged.
// Nothing here knows the Docs API; that layer is `googleDocs.ts`.

/** One run of inline Markdown, its text already escaped. */
export interface InlineRun {
  markdown: string;
  bold: boolean;
  italic: boolean;
  target: string | undefined;
}

/** A top-level piece of the Markdown: a list item joins the item before it with no blank line. */
export interface MarkdownBlock {
  markdown: string;
  isListItem: boolean;
}

const sectionLevel = 2;
const listIndent = "    ";
const lineBreak = "<br>";

export const markdownDialect = {
  sectionLevel,
  lineBreak,

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
    return `${listIndent.repeat(depth)}${marker} ${inline}`;
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
    const prefix = `${"#".repeat(sectionLevel)} `;
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
      if (level === undefined || level > sectionLevel) {
        lines.push(line);
        return;
      }
      keep();
      heading = level === sectionLevel ? line.slice(prefix.length) : undefined;
      lines = [];
    });
    keep();
    return sections;
  },
};

interface ListItem {
  depth: number;
  ordinal: number | undefined;
  inline: string;
}

function mergedRuns(runs: InlineRun[]): InlineRun[] {
  return runs.reduce<InlineRun[]>((merged, run) => {
    const last = merged.at(-1);
    if (last !== undefined && isSameStyle(last, run)) {
      last.markdown += run.markdown;
      return merged;
    }
    merged.push({ ...run });
    return merged;
  }, []);
}

function isSameStyle(left: InlineRun, right: InlineRun): boolean {
  return (
    left.bold === right.bold &&
    left.italic === right.italic &&
    left.target === right.target
  );
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
  const marker = `${run.italic ? "*" : ""}${run.bold ? "**" : ""}`;
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
