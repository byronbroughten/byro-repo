// The drafting steps, piece review and Deliverable Docs the piece and mixed-spec SpecRun tests share.

import type {
  GoogleDocument,
  NamedStyleType,
  StructuralElement,
} from "../Docs/googleDocs.ts";
import { git } from "../GitFixture.ts";
import type {
  DismissedOverlap,
  PieceImplementRecord,
  ReviewFinding,
} from "../stepRecords.ts";
import { stepResults, type StepScript } from "./stepResults.ts";

const deliverableId = "1DeliverableCrossingDoc0000000000";

const draftPath = "writing/agent-drafts/213.md";

// The harness's overlap command reports one hit on "slipped out".
const overlappingDraft =
  "## The harbour\n<!-- developer -->\n\nGulls circled the quay at dawn.\n\n## The crossing\n<!-- agent -->\n\nThe ferry slipped out at noon.\n";

const readerFinding: ReviewFinding = {
  axis: "reader",
  where: `${draftPath}:7`,
  claim:
    'The crossing reads as a delay, not the Outline\'s escape: "The ferry slipped out at noon."',
  suggestedVerdict: "fix",
  reason: "The Outline line says the crossing is the escape.",
};

export const pieceDrafts = {
  deliverableId,
  draftPath,
  // Eight words over two Sections, with no overlap hit.
  lateDraft:
    "## The harbour\n<!-- developer -->\n\nGulls circled the quay.\n\n## The crossing\n<!-- agent -->\n\nThe ferry left late.\n",
  readerFinding,
  // Rewrites The crossing as an agent Section and commits the draft, as a piece implement step would.
  drafted(
    change: Partial<PieceImplementRecord> = {},
    content = overlappingDraft,
  ): StepScript {
    return async (request) => {
      stepResults.commitFile({
        cwd: request.cwd,
        file: draftPath,
        content,
        message: "Draft The crossing in the Agent draft",
      });
      return stepResults.resultOf({
        record: {
          status: "committed",
          branches: [
            {
              repo: "byro-repo",
              branch: git(request.cwd, "branch", "--show-current"),
              sha: git(request.cwd, "rev-parse", "HEAD"),
            },
          ],
          closingComment: "Drafted The crossing.",
          boxesUndone: [],
          blockers: [],
          sectionsDrafted: ["The crossing"],
          ...change,
        },
      });
    };
  },
  // A piece review that spawned its spec, standards and reader reviewers, as `/review-piece` says.
  pieceReviewed(
    findings: ReviewFinding[] = [readerFinding],
    dismissedOverlaps: DismissedOverlap[] = [
      { hit: "the ferry left", reason: "A fixed phrase for the event." },
    ],
  ): StepScript {
    return async () => ({
      ...stepResults.resultOf({ findings, dismissedOverlaps }),
      spawnedSubagentCount: 3,
    });
  },
  // A Doc of one level-2 heading and one paragraph per Section, after the section break every Doc opens with.
  docOf(sections: Record<string, string>): GoogleDocument {
    return pieceDrafts.documentOf(pieceDrafts.h2ContentOf(sections));
  },
  documentOf(content: StructuralElement[]): GoogleDocument {
    return {
      documentId: deliverableId,
      revisionId: "crossing-1",
      body: { content: [{ sectionBreak: {} }, ...content] },
    };
  },
  h2ContentOf(sections: Record<string, string>): StructuralElement[] {
    return Object.entries(sections).flatMap(([heading, text]) => [
      pieceDrafts.paragraphOf(heading, "HEADING_2"),
      pieceDrafts.paragraphOf(text, "NORMAL_TEXT"),
    ]);
  },
  paragraphOf(text: string, namedStyleType: NamedStyleType): StructuralElement {
    return {
      paragraph: {
        elements: [{ textRun: { content: `${text}\n` } }],
        paragraphStyle: { namedStyleType },
      },
    };
  },
};
