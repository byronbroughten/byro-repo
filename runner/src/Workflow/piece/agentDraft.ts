// A Piece's Agent draft file, as ../../../../docs/pieces/agent-draft.md describes it: the Doc's `# <H1>` and `## <H2>`
// lines, each Section marked as the developer's or an agent's on the line under its heading and named by its heading
// path. Pull, from pieceWorkflow.ts, merges a Doc read into it, and the push reads its agent Sections back out; the Doc's
// Markdown dialect and its split into Sections are ../../Docs/markdownDialect.ts's.

import {
  type HeadedSection,
  markdownDialect,
} from "../../Docs/markdownDialect.ts";
import type { NumberOrPlaceholder } from "../../promptText.ts";

export type SectionAuthor = "developer" | "agent";

// The body is as markdownDialect.sectionsOf keys it: trimmed, ending in one newline.
export type DraftSection = HeadedSection & { author: SectionAuthor };

const authorMarks: Record<SectionAuthor, string> = {
  developer: "<!-- developer -->",
  agent: "<!-- agent -->",
};

export const agentDraft = {
  pathOf(specNumber: NumberOrPlaceholder): string {
    return `writing/agent-drafts/${specNumber}.md`;
  },

  sectionsOf(draft: string): DraftSection[] {
    return markdownDialect.headedSectionsOf(draft).map((section) => {
      const [markLine = "", ...lines] = section.markdown.split("\n");
      return {
        ...section,
        author: authorOf(section.path, markLine),
        markdown: `${lines.join("\n").trim()}\n`,
      };
    });
  },

  draftOf(sections: DraftSection[]): string {
    const blocks = sections.map(({ level, text, author, markdown }) => {
      const head = `${markdownDialect.heading(level, text)}\n${authorMarks[author]}`;
      const body = markdown.trim();
      return body === "" ? head : `${head}\n\n${body}`;
    });
    return `${blocks.join("\n\n")}\n`;
  },

  agentSectionsOf(draft: string): Map<string, string> {
    return new Map(
      agentDraft
        .sectionsOf(draft)
        .filter(({ author }) => author === "agent")
        .map(({ path, markdown }) => [path, markdown]),
    );
  },

  // A push Halt's `keep mine` answers, by heading path: the Doc's text stays the developer's, so no later push writes over it.
  keptOf(draft: string, kept: Map<string, string>): string {
    return agentDraft.draftOf(
      agentDraft.sectionsOf(draft).map((section): DraftSection => {
        const markdown = kept.get(section.path);
        if (markdown === undefined) return section;
        return { ...section, author: "developer", markdown };
      }),
    );
  },

  // The Doc's Sections in its order, each agent Section kept as the draft has it; an agent Section the Doc no longer has
  // stays, after the last Section under its H1, so the draft still names it by the same heading path.
  pulledOf(draft: DraftSection[], docMarkdown: string): DraftSection[] {
    const agentSections = new Map(
      draft
        .filter(({ author }) => author === "agent")
        .map((section) => [section.path, section]),
    );
    const docSections = markdownDialect.headedSectionsOf(docMarkdown);
    const pulled = docSections.map(
      (section): DraftSection =>
        agentSections.get(section.path) ?? { ...section, author: "developer" },
    );
    const docPaths = new Set(docSections.map(({ path }) => path));
    return [...agentSections.values()]
      .filter(({ path }) => !docPaths.has(path))
      .reduce(withGoneSection, pulled);
  },
};

function authorOf(path: string, markLine: string): SectionAuthor {
  const author = (Object.keys(authorMarks) as SectionAuthor[]).find(
    (each) => authorMarks[each] === markLine.trim(),
  );
  if (author === undefined) {
    throw new Error(
      `The Agent draft's Section "${path}" has no author mark under its heading, such as "${authorMarks.developer}".`,
    );
  }
  return author;
}

// After the last Section under its H1; one from before any H1 goes first, and one whose H1 is gone gets an empty
// developer H1 of its own, which the push never writes.
function withGoneSection(
  sections: DraftSection[],
  gone: DraftSection,
): DraftSection[] {
  const h1 = h1Of(gone);
  const last = sections.findLastIndex((section) => h1Of(section) === h1);
  if (last !== -1) {
    sections.splice(last + 1, 0, gone);
    return sections;
  }
  if (h1 === undefined) {
    sections.unshift(gone);
    return sections;
  }
  if (gone.level === markdownDialect.syntax.sectionLevel) {
    sections.push({
      level: 1,
      text: h1,
      path: h1,
      author: "developer",
      markdown: "\n",
    });
  }
  sections.push(gone);
  return sections;
}

function h1Of({ level, text, path }: DraftSection): string | undefined {
  if (level < markdownDialect.syntax.sectionLevel) return text;
  return markdownDialect.pathPartsOf(path).h1;
}
