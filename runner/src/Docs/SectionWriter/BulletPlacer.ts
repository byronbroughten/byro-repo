// Puts the lists `SectionWriter.ts` writes into bullets: once its text requests
// have run, each written list becomes one list of its own, by where those
// requests left its items, unless the items already make up the whole of one
// held list. Placing bullets last, rather than per insertion, keeps an item
// added to a list or splitting one from restarting the numbering.

import { listKindOf } from "../DocReader.ts";
import type {
  BulletPreset,
  GoogleDocument,
  List,
  Range,
  Request,
} from "../googleDocs.ts";
import type { ListKind } from "../markdownDialect.ts";
import {
  type HeldParagraph,
  unitLengthOf,
  type WrittenParagraph,
} from "../sectionDiff.ts";

/** A written paragraph and where it starts. */
export interface LaidParagraph {
  paragraph: WrittenParagraph;
  startIndex: number;
}

/** A written paragraph where the text requests leave it, and the held paragraph whose bullet it keeps. */
export interface PlacedParagraph extends LaidParagraph {
  heldParagraph: HeldParagraph | undefined;
}

const bulletPresets: Record<ListKind, BulletPreset> = {
  bulleted: "BULLET_DISC_CIRCLE_SQUARE",
  numbered: "NUMBERED_DECIMAL_ALPHA_ROMAN",
};

export class BulletPlacer {
  private readonly lists: Record<string, List>;
  private readonly listSizes: Map<string, number>;

  constructor(document: GoogleDocument) {
    this.lists = document.lists ?? {};
    this.listSizes = (document.body?.content ?? []).reduce(
      (sizes, { paragraph }) => {
        const listId = paragraph?.bullet?.listId;
        if (listId !== undefined) {
          sizes.set(listId, (sizes.get(listId) ?? 0) + 1);
        }
        return sizes;
      },
      new Map<string, number>(),
    );
  }

  static init(document: GoogleDocument): BulletPlacer {
    return new BulletPlacer(document);
  }

  /** The bullet requests for every written list among the placed paragraphs, the last list first. */
  requestsFor(placed: PlacedParagraph[]): Request[] {
    return listRunsOf(placed)
      .filter((run) => !this._isWholeList(run))
      .reverse()
      .flatMap((run) => {
        const first = run[0];
        const last = run.at(-1);
        const listKind = first?.paragraph.list?.listKind;
        if (
          first === undefined ||
          last === undefined ||
          listKind === undefined
        ) {
          return [];
        }
        const range: Range = {
          startIndex: first.startIndex,
          endIndex: paragraphRangeOf(last).endIndex,
        };
        return [
          { deleteParagraphBullets: { range } },
          {
            createParagraphBullets: {
              range,
              bulletPreset: bulletPresets[listKind],
            },
          },
        ];
      });
  }

  private _isWholeList(run: PlacedParagraph[]): boolean {
    const listIds = new Set(
      run.map(({ heldParagraph }) => heldParagraph?.bullet?.listId),
    );
    const [listId] = listIds;
    const listKind = run[0]?.paragraph.list?.listKind;
    return (
      listIds.size === 1 &&
      listId !== undefined &&
      listKindOf(this.lists, { listId }) === listKind &&
      this.listSizes.get(listId) === run.length
    );
  }
}

/** A laid paragraph's range, its newline included. */
export function paragraphRangeOf({
  paragraph,
  startIndex,
}: LaidParagraph): Range {
  return {
    startIndex,
    endIndex: startIndex + unitLengthOf(paragraph.chars) + 1,
  };
}

/** The placed list items in runs, one per written list. */
function listRunsOf(placed: PlacedParagraph[]): PlacedParagraph[][] {
  return placed.reduce<PlacedParagraph[][]>((runs, paragraph) => {
    const { list } = paragraph.paragraph;
    if (list === undefined) {
      return runs;
    }
    const run = runs.at(-1);
    if (run?.at(-1)?.paragraph.list === list) {
      run.push(paragraph);
      return runs;
    }
    runs.push([paragraph]);
    return runs;
  }, []);
}
