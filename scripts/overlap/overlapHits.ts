// Done check 4's mechanical half: every run of four or more words a Deliverable sentence shares with a passage read for it.
// The rule and its reasoning: docs/writing-style/borrowing.md. The command: overlap.ts.
import { markdownBlocks } from "../jev/markdownBlocks.ts";

export interface Passage {
  name: string;
  text: string;
}

export interface OverlapInput {
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
interface Tokens {
  words: (string | undefined)[];
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
    const passageSentences = sentencesOf(passage.text);
    const passageTokens = tokensOf(passageSentences, terms);
    return sentences.flatMap((sentence) =>
      sharedRuns(
        tokensOf([sentence], terms).words,
        passageTokens.words,
      ).flatMap((run) => {
        const words = passageTokens.words
          .slice(run.start, run.start + run.length)
          .filter((word) => word !== undefined);
        const contentWords = words.filter((word) => !functionWords.has(word));
        if (contentWords.length === 0) return [];
        return [
          {
            run: words.join(" "),
            wordCount: run.length,
            passageName: passage.name,
            sentence,
            passageSentence: passageSentenceOf(
              passageSentences,
              passageTokens,
              run,
            ),
            isOnlyFigures: contentWords.every(
              (word) => /^\d+$/.test(word) || months.has(word),
            ),
          },
        ];
      }),
    );
  });
}

// The passage sentences the run spans, joined, since a run can cross a sentence break the splitter guessed.
function passageSentenceOf(
  passageSentences: string[],
  passageTokens: Tokens,
  run: Run,
): string {
  const first = passageTokens.sentenceIndexes[run.start] ?? 0;
  const last =
    passageTokens.sentenceIndexes[run.start + run.length - 1] ?? first;
  return passageSentences.slice(first, last + 1).join(" ");
}

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“‘(])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");
}

function tokensOf(sentences: string[], terms: string[][]): Tokens {
  const tokens = sentences.reduce<Tokens>(
    (tokens, sentence, index) => {
      wordsOf(sentence).forEach((word) => {
        tokens.words.push(word);
        tokens.sentenceIndexes.push(index);
      });
      return tokens;
    },
    { words: [], sentenceIndexes: [] },
  );
  terms.forEach((term) => maskTerm(tokens.words, term));
  return tokens;
}

function maskTerm(words: (string | undefined)[], term: string[]): void {
  words.forEach((_, start) => {
    const isTermStart =
      term.length > 0 &&
      term.every((word, offset) => words[start + offset] === word);
    if (isTermStart) words.fill(undefined, start, start + term.length);
  });
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
function sharedRuns(
  sentence: (string | undefined)[],
  passage: (string | undefined)[],
): Run[] {
  const runs: Run[] = [];
  let index = 0;
  while (index <= sentence.length - minRunLength) {
    let best: Run = { start: 0, length: 0 };
    passage.forEach((_, start) => {
      let length = 0;
      while (
        index + length < sentence.length &&
        sentence[index + length] !== undefined &&
        sentence[index + length] === passage[start + length]
      ) {
        length += 1;
      }
      if (length > best.length) best = { start, length };
    });
    if (best.length >= minRunLength) {
      runs.push(best);
      index += best.length;
    } else {
      index += 1;
    }
  }
  return runs;
}
