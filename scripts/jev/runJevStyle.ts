// Checks a Deliverable against the writing style sheet with Jev and prints a `## Jev style` section.
// The rules come from the sheets (styleRules.ts), the paragraphs from the Deliverable's Markdown
// (markdownBlocks.ts), and the Piece's axis values and overrides from the Style file (pieceStyle.ts).
// One yes/no question per (paragraph, rule) pair; the full answers go to jev-style.json beside the Deliverable.
// Usage and the Style file's shape: docs/agents/jev.md.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { JsonValue, Questions, Usage } from "@typesafe-ai/sdk";

import type { JevClient } from "./JevClient.ts";
import { JevRequestTooLargeError } from "./JevRequestTooLargeError.ts";
import {
  type JevPrinted,
  newVersionLines,
  requireApiKey,
} from "./jevRunSteps.ts";
import {
  type MarkdownBlock,
  markdownBlocks,
  paragraphTexts,
} from "./markdownBlocks.ts";
import { type PieceStyle, readPieceStyle } from "./pieceStyle.ts";
import {
  pieceRules,
  positionRuleOf,
  type StyleSheetPaths,
} from "./styleRules.ts";

export interface JevStyleRun extends StyleSheetPaths {
  deliverablePath: string;
  stylePath: string;
  sections: string[];
  apiKey: string | undefined;
  connect(apiKey: string): JevClient;
}

interface StyleQuestion {
  key: string;
  paragraph: number;
  rule: string;
}

interface StyleAnswer extends StyleQuestion {
  noul: number;
}

interface JevStyleState {
  [key: string]: JsonValue;
  piece: { kind: string; paragraphs: string[] };
  overrides: string[];
  rules: string[];
}

const bands = { breaks: 0.7, unsure: 0.5 } as const;

export async function runJevStyle(run: JevStyleRun): Promise<JevPrinted> {
  const client = run.connect(requireApiKey(run.apiKey));
  const blocks = markdownBlocks(readFileSync(run.deliverablePath, "utf8"));
  const paragraphs = paragraphTexts(blocks);
  const scope = scopedParagraphs(blocks, run.sections);
  const style = readPieceStyle(run.stylePath);
  const rules = pieceRules(run, style);
  const questions = styleQuestions(scope, rules, paragraphs.length);
  const state = styleState(style, paragraphs, rules);
  const [{ model, answers, usage }, versionLines] = await Promise.all([
    sendSplitting(client, state, questions),
    newVersionLines(client),
  ]);
  const answersPath = join(dirname(run.deliverablePath), "jev-style.json");
  writeFileSync(
    answersPath,
    JSON.stringify({ model, usage, answers }, null, 2),
  );
  return {
    stdout: styleSection(answers, paragraphs),
    stderr: [...versionLines, `Full answers: ${answersPath}`],
  };
}

function scopedParagraphs(
  blocks: MarkdownBlock[],
  sections: string[],
): number[] {
  if (sections.length === 0) {
    return paragraphTexts(blocks).map((_, index) => index);
  }
  return sections.flatMap((section) => sectionParagraphs(blocks, section));
}

// A section runs from its heading to the next heading at its level or above.
function sectionParagraphs(blocks: MarkdownBlock[], section: string): number[] {
  const start = blocks.findIndex(
    (block) => block.kind === "heading" && block.text === section,
  );
  const heading = blocks[start];
  if (heading?.kind !== "heading") {
    throw new Error(`No heading "${section}" in the Deliverable.`);
  }
  const indices: number[] = [];
  let paragraph = paragraphTexts(blocks.slice(0, start)).length;
  for (const block of blocks.slice(start + 1)) {
    if (block.kind === "heading" && block.level <= heading.level) break;
    if (block.kind === "paragraph") indices.push(paragraph++);
  }
  return indices;
}

function styleQuestions(
  scope: number[],
  rules: string[],
  paragraphCount: number,
): StyleQuestion[] {
  return scope.flatMap((paragraph) =>
    rules.flatMap((rule, ruleIndex) => {
      if (!isRulePlace(rule, paragraph, paragraphCount)) return [];
      return [{ key: `p${paragraph}r${ruleIndex}`, paragraph, rule }];
    }),
  );
}

function isRulePlace(
  rule: string,
  paragraph: number,
  paragraphCount: number,
): boolean {
  const position = positionRuleOf(rule);
  if (!position) return true;
  if (position.end === "first") return paragraph < position.paragraphCount;
  return paragraph >= paragraphCount - position.paragraphCount;
}

function styleState(
  style: PieceStyle,
  paragraphs: string[],
  rules: string[],
): JevStyleState {
  return {
    piece: { kind: style.kind, paragraphs },
    overrides: style.overrides,
    rules,
  };
}

function styleInstructions({ paragraph, rule }: StyleQuestion): string {
  return (
    `Style rule: "${rule}"\nJudge only \`piece.paragraphs[${paragraph}]\`, reading the rest of \`piece.paragraphs\` for context. ` +
    "If an entry in `overrides` permits what the paragraph does, it does not break the rule. " +
    "A rule that has nothing to act on in this paragraph is not broken. " +
    "Where another entry in `rules` makes an exception for this rule, the exception holds.\n" +
    "Does this paragraph break the rule?"
  );
}

interface StyleAnswers {
  model: string;
  answers: StyleAnswer[];
  usage: Usage;
}

// One request carries the text once; halves only when TypeSafe rejects the size.
async function sendSplitting(
  client: JevClient,
  state: JevStyleState,
  questions: StyleQuestion[],
): Promise<StyleAnswers> {
  try {
    return await sendOnce(client, state, questions);
  } catch (error) {
    if (!(error instanceof JevRequestTooLargeError) || questions.length < 2) {
      throw error;
    }
    const half = Math.ceil(questions.length / 2);
    const first = await sendSplitting(client, state, questions.slice(0, half));
    const second = await sendSplitting(client, state, questions.slice(half));
    return {
      model: first.model,
      answers: [...first.answers, ...second.answers],
      usage: {
        input_tokens: first.usage.input_tokens + second.usage.input_tokens,
        output_tokens: first.usage.output_tokens + second.usage.output_tokens,
      },
    };
  }
}

async function sendOnce(
  client: JevClient,
  state: JevStyleState,
  questions: StyleQuestion[],
): Promise<StyleAnswers> {
  const result = await client.send({
    state,
    questions: requestQuestions(questions),
  });
  const answers = questions.map((question) => {
    const answer = result.answers[question.key];
    if (answer?.type !== "noul") {
      throw new Error(`Jev gave no yes/no answer for ${question.key}.`);
    }
    return { ...question, noul: answer.noul };
  });
  return { model: result.model, answers, usage: result.usage };
}

function requestQuestions(questions: StyleQuestion[]): Questions {
  return questions.reduce<Questions>((request, question) => {
    request[question.key] = {
      type: "noul",
      instructions: styleInstructions(question),
      criteria: {
        true: "The paragraph breaks the rule.",
        false:
          "The paragraph follows the rule, or the rule does not apply to it.",
      },
    };
    return request;
  }, {});
}

function styleSection(answers: StyleAnswer[], paragraphs: string[]): string {
  const flags = answers
    .filter(({ noul }) => noul >= bands.unsure)
    .sort((a, b) => b.noul - a.noul);
  const breaks = flags.filter(({ noul }) => noul >= bands.breaks).length;
  const flagLines = flags.map(
    ({ noul, rule, paragraph }) =>
      `- ${bandOf(noul)} ${noul.toFixed(2)}: "${rule}" at "${firstWords(paragraphs[paragraph] ?? "")}"`,
  );
  return [
    "## Jev style",
    "",
    ...(flagLines.length > 0 ? [...flagLines, ""] : []),
    `${flags.length} flags: ${breaks} breaks, ${flags.length - breaks} unsure, from ${answers.length} questions.`,
  ].join("\n");
}

function bandOf(noul: number): keyof typeof bands {
  if (noul >= bands.breaks) return "breaks";
  return "unsure";
}

function firstWords(paragraph: string): string {
  const words = paragraph.split(/\s+/);
  if (words.length <= 6) return paragraph;
  return `${words.slice(0, 6).join(" ")}…`;
}
