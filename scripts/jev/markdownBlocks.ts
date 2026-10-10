export interface MarkdownHeading {
  kind: "heading";
  level: number;
  text: string;
}

export interface MarkdownParagraph {
  kind: "paragraph";
  text: string;
}

export type MarkdownBlock = MarkdownHeading | MarkdownParagraph;

// Each list item is its own paragraph; a line that isn't a heading or a list item continues the one before.
export function markdownBlocks(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let paragraph: MarkdownParagraph | undefined;
  markdown.split("\n").forEach((line) => {
    const heading = /^(#{1,6})\s+(.*?)\s*$/.exec(line);
    const listItem = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (line.trim() === "") {
      paragraph = undefined;
    } else if (heading) {
      paragraph = undefined;
      blocks.push({
        kind: "heading",
        level: (heading[1] ?? "").length,
        text: heading[2] ?? "",
      });
    } else if (listItem || !paragraph) {
      paragraph = { kind: "paragraph", text: (listItem?.[1] ?? line).trim() };
      blocks.push(paragraph);
    } else {
      paragraph.text += ` ${line.trim()}`;
    }
  });
  return blocks;
}

export function paragraphTexts(blocks: MarkdownBlock[]): string[] {
  return blocks.flatMap((block) =>
    block.kind === "paragraph" ? [block.text] : [],
  );
}
