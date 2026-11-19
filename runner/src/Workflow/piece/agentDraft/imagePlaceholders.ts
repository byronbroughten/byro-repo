// The Image placeholders in an Agent draft Section's body, as ../../../../../docs/pieces/agent-draft.md's File format
// writes them: the one parse the length check, in ../pieceChecks.ts, and the review inputs read. The image folder's
// path is ../agentDraft.ts's, beside the draft's own.

// A placeholder names its image's file or, for an image with no file, lists the facts it shows.
export type ImagePlaceholder = { number: number } & (
  { file: string } | { facts: string }
);

// A placeholder is a paragraph of its own, `\[Image <n>: <file or facts>\]`, the dialect escaping its brackets.
const patterns = {
  placeholder: /^\\\[Image (\d+): ([\s\S]+)\\\]$/,
  pngFile: /^[^\s/\\]+\.png$/i,
  dialectEscape: /\\([\\*_[\]])/g,
  paragraphBreak: /\n{2,}/,
} as const;

export const imagePlaceholders = {
  of(markdown: string): ImagePlaceholder[] {
    return paragraphsOf(markdown).flatMap((paragraph) => {
      const placeholder = placeholderOf(paragraph);
      return placeholder === undefined ? [] : [placeholder];
    });
  },

  // A Section's body with each Image placeholder paragraph left out.
  proseOf(markdown: string): string {
    const prose = paragraphsOf(markdown).filter(
      (paragraph) => placeholderOf(paragraph) === undefined,
    );
    return `${prose.join("\n\n")}\n`;
  },
};

function paragraphsOf(markdown: string): string[] {
  return markdown
    .trim()
    .split(patterns.paragraphBreak)
    .filter((paragraph) => paragraph !== "");
}

function placeholderOf(paragraph: string): ImagePlaceholder | undefined {
  const [, number, text] = patterns.placeholder.exec(paragraph) ?? [];
  if (number === undefined || text === undefined) return undefined;
  const unescaped = text.replace(patterns.dialectEscape, "$1").trim();
  if (patterns.pngFile.test(unescaped)) {
    return { number: Number(number), file: unescaped };
  }
  return { number: Number(number), facts: unescaped };
}
