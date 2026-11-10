// A Piece's Agent draft file, as ../../../../docs/pieces/agent-draft.md describes it: one `## <heading>` block per
// Section, each marked as the developer's or an agent's on the line under its heading. Pull, from pieceWorkflow.ts,
// merges a Doc read into it; the Doc's Markdown dialect and its split into Sections are ../../Docs/markdownDialect.ts's.

import { markdownDialect } from "../../Docs/markdownDialect.ts";

export type SectionAuthor = "developer" | "agent";

export interface DraftSection {
  heading: string;
  author: SectionAuthor;
  // As markdownDialect.sectionsOf keys it: trimmed, ending in one newline.
  markdown: string;
}

const authorMarks: Record<SectionAuthor, string> = {
  developer: "<!-- developer -->",
  agent: "<!-- agent -->",
};

export const agentDraft = {
  sectionsOf(draft: string): DraftSection[] {
    return [...markdownDialect.sectionsOf(draft)].map(([heading, body]) => {
      const [markLine = "", ...lines] = body.split("\n");
      return {
        heading,
        author: authorOf(heading, markLine),
        markdown: `${lines.join("\n").trim()}\n`,
      };
    });
  },

  draftOf(sections: DraftSection[]): string {
    const blocks = sections.map(({ heading, author, markdown }) => {
      const head = `${markdownDialect.heading(markdownDialect.syntax.sectionLevel, heading)}\n${authorMarks[author]}`;
      const body = markdown.trim();
      return body === "" ? head : `${head}\n\n${body}`;
    });
    return `${blocks.join("\n\n")}\n`;
  },

  // The Doc's Sections in its order, each agent Section kept as the draft has it; an agent Section the Doc no longer has stays, after them.
  pulledOf(
    draft: DraftSection[],
    docSections: Map<string, string>,
  ): DraftSection[] {
    const agentSections = new Map(
      draft
        .filter(({ author }) => author === "agent")
        .map((section) => [section.heading, section]),
    );
    const pulled = [...docSections].map(
      ([heading, markdown]): DraftSection =>
        agentSections.get(heading) ?? {
          heading,
          author: "developer",
          markdown,
        },
    );
    const gone = [...agentSections.values()].filter(
      ({ heading }) => !docSections.has(heading),
    );
    return [...pulled, ...gone];
  },
};

function authorOf(heading: string, markLine: string): SectionAuthor {
  const author = (Object.keys(authorMarks) as SectionAuthor[]).find(
    (each) => authorMarks[each] === markLine.trim(),
  );
  if (author === undefined) {
    throw new Error(
      `The Agent draft's Section "${heading}" has no author mark under its heading, such as "${authorMarks.developer}".`,
    );
  }
  return author;
}
