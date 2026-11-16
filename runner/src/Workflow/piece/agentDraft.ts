// A Piece's Agent draft file, as ../../../../docs/pieces/agent-draft.md describes it: the Doc's `# <H1>` and `## <H2>`
// lines, each Section marked as the developer's or an agent's, with its heading's headingId, on the line under its
// heading and named by its heading path. Pull, from pieceWorkflow.ts, merges a Doc read into it, and the push reads its
// agent Sections back out; the Doc's Markdown dialect and its split into Sections are ../../Docs/markdownDialect.ts's.

import {
  type HeadedSection,
  markdownDialect,
} from "../../Docs/markdownDialect.ts";
import type { NumberOrPlaceholder } from "../../promptText.ts";

export type SectionAuthor = "developer" | "agent";

// The body is as markdownDialect.sectionsOf keys it: trimmed, ending in one newline.
export type DraftSection = HeadedSection & {
  author: SectionAuthor;
  headingId: string | undefined;
};

// A mark is `<!-- developer -->` or `<!-- agent -->`, then the heading's headingId when it has one.
const authorMark = {
  pattern: /^<!-- (developer|agent)(?: (\S+))? -->$/,
  example: "<!-- developer -->",

  lineOf(author: SectionAuthor, headingId: string | undefined): string {
    const parts = [author, headingId].filter((part) => part !== undefined);
    return `<!-- ${parts.join(" ")} -->`;
  },
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
        ...markOf(section.path, markLine),
        markdown: `${lines.join("\n").trim()}\n`,
      };
    });
  },

  draftOf(sections: DraftSection[]): string {
    const blocks = sections.map(
      ({ level, text, author, headingId, markdown }) => {
        const mark = authorMark.lineOf(author, headingId);
        const head = `${markdownDialect.heading(level, text)}\n${mark}`;
        const body = markdown.trim();
        return body === "" ? head : `${head}\n\n${body}`;
      },
    );
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

  // The Doc's Sections in its order, an agent Section kept but for its current headingId; one the Doc lost stays after its H1's last Section.
  pulledOf(
    draft: DraftSection[],
    docMarkdown: string,
    headingIds: Map<string, string>,
  ): DraftSection[] {
    const agentSections = new Map(
      draft
        .filter(({ author }) => author === "agent")
        .map((section) => [section.path, section]),
    );
    const docSections = markdownDialect.headedSectionsOf(docMarkdown);
    const pulled = docSections.map((section): DraftSection => {
      const headingId = headingIds.get(section.path);
      const agentSection = agentSections.get(section.path);
      if (agentSection === undefined) {
        return { ...section, author: "developer", headingId };
      }
      return { ...agentSection, headingId };
    });
    const docPaths = new Set(docSections.map(({ path }) => path));
    return [...agentSections.values()]
      .filter(({ path }) => !docPaths.has(path))
      .reduce(withGoneSection, pulled);
  },
};

function markOf(
  path: string,
  markLine: string,
): Pick<DraftSection, "author" | "headingId"> {
  const [, author, headingId] = authorMark.pattern.exec(markLine.trim()) ?? [];
  if (!isSectionAuthor(author)) {
    throw new Error(
      `The Agent draft's Section "${path}" has no author mark under its heading, such as "${authorMark.example}".`,
    );
  }
  return { author, headingId };
}

function isSectionAuthor(value: string | undefined): value is SectionAuthor {
  return value === "developer" || value === "agent";
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
      level: markdownDialect.syntax.h1Level,
      text: h1,
      path: h1,
      author: "developer",
      headingId: undefined,
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
