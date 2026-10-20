// Done check 4's mechanical half: every run of four or more words a Deliverable sentence shares with a passage read for it.
// The rule and its reasoning: docs/writing-style/borrowing.md. The command: overlap.ts.
import { markdownBlocks } from "../jev/markdownBlocks.ts";

interface Passage {
  name: string;
  text: string;
}

interface OverlapInput {
  deliverable: string;
  passages: Passage[];
  allowlist: string[];
}

export interface OverlapHit {
  run: string;
  wordCount: number;
  passageName: string;
  sentence: string;
  passageSentence: string;
  isOnlyFigures: boolean;
}

// An allowlisted term's words are undefined, so no run passes through them.
type MaskedWords = (string | undefined)[];

interface Tokens {
  sentences: string[];
  words: MaskedWords;
  sentenceIndexes: number[];
}

// A run's position in the passage's words.
interface Run {
  start: number;
  length: number;
}

const minRunLength = 4;

const months = new Set(
  "january february march april may june july august september october november december".split(
    " ",
  ),
);

// "end", "start" and their kin are here so a frame like "at the end of the" counts as function words.
const functionWords = new Set(
  `a an the of to in on at by for from with as and or but nor so if then than that this these those
  it its is are was were be been being has have had do does did not no can could may might must shall should will would
  which who whom whose what when where while how why each every any all some both either neither such into onto over under
  between through during before after about up down out off per via also only just more most less least other another same
  their there they them he she his her we our us i my me you your one two three four five
  end start beginning middle part rest kind sort type lot`.split(/\s+/),
);

export function overlapHits({
  deliverable,
  passages,
  allowlist,
}: OverlapInput): OverlapHit[] {
  const sentences = markdownBlocks(deliverable).flatMap((block) =>
    sentencesOf(block.text),
  );
  const terms = allowlist.map(wordsOf);
  return passages.flatMap((passage) => {
    const passageTokens = tokensOf(sentencesOf(passage.text), terms);
    return sentences.flatMap((sentence) =>
      sharedRuns(tokensOf([sentence], terms).words, passageTokens.words).map(
        (run) => {
          const words = passageTokens.words
            .slice(run.start, run.start + run.length)
            .filter((word) => word !== undefined);
          return {
            run: words.join(" "),
            wordCount: run.length,
            passageName: passage.name,
            sentence,
            passageSentence: passageSentenceOf(passageTokens, run),
            isOnlyFigures: words
              .filter((word) => !functionWords.has(word))
              .every((word) => /^\d+$/.test(word) || months.has(word)),
          };
        },
      ),
    );
  });
}

// The passage sentences the run spans, joined, since a run can cross a sentence break the splitter guessed.
function passageSentenceOf(passageTokens: Tokens, run: Run): string {
  const first = passageTokens.sentenceIndexes[run.start] ?? 0;
  const last =
    passageTokens.sentenceIndexes[run.start + run.length - 1] ?? first;
  return passageTokens.sentences.slice(first, last + 1).join(" ");
}

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“‘(])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");
}

function tokensOf(sentences: string[], terms: string[][]): Tokens {
  const words = sentences.flatMap(wordsOf);
  const sentenceIndexes = sentences.flatMap((sentence, index) =>
    wordsOf(sentence).map(() => index),
  );
  return {
    sentences,
    words: terms.reduce<MaskedWords>(maskedTerm, words),
    sentenceIndexes,
  };
}

function maskedTerm(words: MaskedWords, term: string[]): MaskedWords {
  const masked = [...words];
  words.forEach((_, start) => {
    const isTermStart =
      term.length > 0 &&
      term.every((word, offset) => words[start + offset] === word);
    if (isTermStart) masked.fill(undefined, start, start + term.length);
  });
  return masked;
}

function wordsOf(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "");
}

// Greedy left to right: each run is the longest one starting at that sentence word, and the next search starts after it.
// A function-word-only run moves the search one word on, so copied wording overlapping it is still found.
function sharedRuns(sentence: MaskedWords, passage: MaskedWords): Run[] {
  const runs: Run[] = [];
  let index = 0;
  while (index <= sentence.length - minRunLength) {
    let longest: Run = { start: 0, length: 0 };
    passage.forEach((_, start) => {
      let length = 0;
      while (
        index + length < sentence.length &&
        sentence[index + length] !== undefined &&
        sentence[index + length] === passage[start + length]
      ) {
        length += 1;
      }
      if (length > longest.length) longest = { start, length };
    });
    const hasContentWord = sentence
      .slice(index, index + longest.length)
      .some((word) => word !== undefined && !functionWords.has(word));
    if (longest.length >= minRunLength && hasContentWord) {
      runs.push(longest);
      index += longest.length;
    } else {
      index += 1;
    }
  }
  return runs;
}
