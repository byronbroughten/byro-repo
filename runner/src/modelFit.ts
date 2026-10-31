// Reads a ticket's `## Model fit` section: the last section of its body, a pair line naming one of the six pairs, then a reason.
// The pairs and their criteria are byro-repo's docs/agents/model-fit.md; SpecRun.ts reads the pair just before each launch.

import type { Pair } from "./AgentStep.ts";

const sectionHeading = "## Model fit";

const pairs: Record<string, Pair> = {
  "haiku medium": { model: "haiku", effort: "medium" },
  "sonnet medium": { model: "sonnet", effort: "medium" },
  "sonnet high": { model: "sonnet", effort: "high" },
  "opus low": { model: "opus", effort: "low" },
  "opus medium": { model: "opus", effort: "medium" },
  "opus high": { model: "opus", effort: "high" },
};

// Undefined when the section is missing, isn't last, or names no allowed pair.
export function pairOf(body: string): Pair | undefined {
  const [pairLine = ""] = modelFitLinesOf(body) ?? [];
  return pairNamed(pairLine);
}

// The pair line and its reason as one line, for `npm run outcome:summary`; undefined when the section is missing or isn't last.
export function modelFitTextOf(body: string): string | undefined {
  const lines = modelFitLinesOf(body);
  if (lines === undefined || lines.length === 0) return undefined;
  const [pairLine, ...reason] = lines;
  if (reason.length === 0) return pairLine;
  return `${pairLine}: ${reason.join(" ")}`;
}

function modelFitLinesOf(body: string): string[] | undefined {
  const sections = body.split(/^(?=## )/m);
  const last = sections.at(-1) ?? "";
  if (!last.startsWith(sectionHeading)) return undefined;
  return last
    .slice(sectionHeading.length)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

export function pairNamed(name: string): Pair | undefined {
  return pairs[name.trim().toLowerCase()];
}

// The pairs are listed weakest first; undefined past Opus high.
export function nextStrongerPairOf(pair: Pair): Pair | undefined {
  const ordered = Object.values(pairs);
  const index = ordered.findIndex(
    ({ model, effort }) => model === pair.model && effort === pair.effort,
  );
  return ordered[index + 1];
}

const pairRanks: {
  model: Record<Pair["model"], number>;
  effort: Record<Pair["effort"], number>;
} = {
  model: { haiku: 0, sonnet: 1, opus: 2 },
  effort: { low: 0, medium: 1, high: 2 },
};

// The model decides first, so Opus low is stronger than Sonnet high.
export function strongerPairOf(first: Pair, second: Pair): Pair {
  const modelGap = pairRanks.model[first.model] - pairRanks.model[second.model];
  if (modelGap !== 0) return modelGap > 0 ? first : second;
  return pairRanks.effort[first.effort] >= pairRanks.effort[second.effort]
    ? first
    : second;
}

export function pairLabelOf({ model, effort }: Pair): string {
  return `${model[0]?.toUpperCase()}${model.slice(1)} ${effort}`;
}
