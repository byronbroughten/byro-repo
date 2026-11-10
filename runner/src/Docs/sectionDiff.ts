// The blocks the Section writer compares, paragraphs and tables, and their diff:
// a longest common subsequence keeps the blocks that match, and the runs
// between are the hunks `SectionWriter.ts` turns into requests.

import type { Bullet } from "./googleDocs.ts";
import type { ListKind, SpanStyle } from "./markdownDialect.ts";

/** One character, a UTF-16 surrogate pair kept whole, with its style. */
export interface StyledChar {
  char: string;
  style: SpanStyle;
}

/** One list among the written paragraphs: its items share the one object. */
export interface WrittenList {
  kind: ListKind;
}

/** A heading, paragraph or list item as the writer compares it: its level, its list and its text, one character at a time. */
export interface WrittenParagraph {
  kind: "paragraph";
  level: number | undefined;
  list: WrittenList | undefined;
  chars: StyledChar[];
}

/** A table as the writer compares it: its rows of cells, each cell's text. */
export interface WrittenTable {
  kind: "table";
  rows: StyledChar[][][];
}

export type WrittenBlock = WrittenParagraph | WrittenTable;

/** A paragraph of the read document, with where it sits and its bullet. */
export interface HeldParagraph extends WrittenParagraph {
  startIndex: number;
  endIndex: number;
  bullet: Bullet | undefined;
}

/** A table of the read document, with where it sits. */
export interface HeldTable extends WrittenTable {
  startIndex: number;
  endIndex: number;
}

export type HeldBlock = HeldParagraph | HeldTable;

/** A held block left as it is, and the written block it stands for. */
export interface Kept {
  held: HeldBlock;
  wanted: WrittenBlock;
}

/** A run of blocks that differ, after the block ending at `afterIndex`, and the kept pair just after it. */
export interface Hunk {
  held: HeldBlock[];
  wanted: WrittenBlock[];
  afterIndex: number;
  kept: Kept | undefined;
}

export const sectionDiff = {
  /** The Section's blocks in order as hunks, each ending with the kept pair after it. */
  hunksOf(
    sectionHeading: HeldParagraph,
    held: HeldBlock[],
    wanted: WrittenBlock[],
  ): Hunk[] {
    const heldKeys = held.map(keyOf);
    const wantedKeys = wanted.map(keyOf);
    const lengths = suffixLengthsOf(heldKeys, wantedKeys);
    const hunks: Hunk[] = [];
    let hunk = emptyHunk(sectionHeading.endIndex);
    let i = 0;
    let j = 0;
    while (i < held.length || j < wanted.length) {
      const heldBlock = held[i];
      const wantedBlock = wanted[j];
      if (
        heldBlock !== undefined &&
        wantedBlock !== undefined &&
        heldKeys[i] === wantedKeys[j]
      ) {
        hunk.kept = { held: heldBlock, wanted: wantedBlock };
        hunks.push(hunk);
        hunk = emptyHunk(heldBlock.endIndex);
        i += 1;
        j += 1;
      } else if (
        heldBlock !== undefined &&
        (wantedBlock === undefined ||
          (lengths[i + 1]?.[j] ?? 0) >= (lengths[i]?.[j + 1] ?? 0))
      ) {
        hunk.held.push(heldBlock);
        i += 1;
      } else if (wantedBlock !== undefined) {
        hunk.wanted.push(wantedBlock);
        j += 1;
      }
    }
    hunks.push(hunk);
    return hunks.filter(
      (candidate) =>
        candidate.held.length > 0 ||
        candidate.wanted.length > 0 ||
        candidate.kept !== undefined,
    );
  },
};

function emptyHunk(afterIndex: number): Hunk {
  return { held: [], wanted: [], afterIndex, kept: undefined };
}

/** The longest common subsequence of each pair of suffixes, filled from the end. */
function suffixLengthsOf(heldKeys: string[], wantedKeys: string[]): number[][] {
  const lengths = [...heldKeys, undefined].map(() =>
    new Array<number>(wantedKeys.length + 1).fill(0),
  );
  indicesFromEnd(heldKeys).forEach((i) => {
    indicesFromEnd(wantedKeys).forEach((j) => {
      const row = lengths[i] ?? [];
      row[j] =
        heldKeys[i] === wantedKeys[j]
          ? (lengths[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(lengths[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    });
  });
  return lengths;
}

function indicesFromEnd(keys: string[]): number[] {
  return [...keys.keys()].reverse();
}

function keyOf(block: WrittenBlock): string {
  if (block.kind === "table") {
    return JSON.stringify([
      "table",
      block.rows.map((row) => row.map(charKeysOf)),
    ]);
  }
  return JSON.stringify([
    block.level,
    block.list?.kind,
    charKeysOf(block.chars),
  ]);
}

function charKeysOf(chars: StyledChar[]): unknown[] {
  return chars.map(({ char, style }) => [
    char,
    style.isBold,
    style.isItalic,
    style.target,
  ]);
}
