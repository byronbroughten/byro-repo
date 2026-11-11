// A piece row's "What review caught" cell. The outcome log is public and a Piece's prose may be private, so each kept
// finding is written only by its axis and the rule it cited, never by its claim, quote or Section heading. A rule is
// written as a rule sheet's own rule name or a piece spec field's label, both public text; any other rule is `spec`,
// since a cited spec line can carry private prose. pieceWorkflow.ts reads the sheets and registers it.

import { caughtLabels, type ResolveRecord } from "../../stepRecords.ts";

export type RuleSheetName = "Voice" | "Craft" | "academic";

// Each rule sheet's Markdown.
export type RuleSheets = Record<RuleSheetName, string>;

const specFieldLabels = [
  "User Stories",
  "Reader",
  "Style",
  "Form",
  "Outline",
  "Facts",
] as const;

const unnamedRule = "spec";

interface RuleName {
  sheet: RuleSheetName;
  name: string;
}

export function pieceReviewCaughtOf(
  records: ResolveRecord[],
  sheets: RuleSheets,
): string | undefined {
  const ruleNames = ruleNamesOf(sheets);
  const groups = Object.entries(caughtLabels).flatMap(([verdict, label]) => {
    const counts = records
      .filter((record) => record.verdict === verdict)
      .reduce((byEntry, { axis, rule }) => {
        const entry = `${axis}, ${publicRuleOf(rule, ruleNames)}`;
        byEntry.set(entry, (byEntry.get(entry) ?? 0) + 1);
        return byEntry;
      }, new Map<string, number>());
    if (counts.size === 0) return [];
    const entries = [...counts].map(([entry, count]) => `${entry} ×${count}`);
    return [`${label}: ${entries.join("; ")}`];
  });
  return groups.length === 0 ? undefined : groups.join(". ");
}

// Every bold-led bullet in a sheet, a rule or a term, its trailing punctuation dropped.
function ruleNamesOf(sheets: RuleSheets): RuleName[] {
  return Object.entries(sheets).flatMap(([sheet, markdown]) =>
    [...markdown.matchAll(/^- \*\*(.+?)\*\*/gm)].map(([, bold = ""]) => ({
      sheet: sheet as RuleSheetName,
      name: bold.replace(/[.:;]+$/, ""),
    })),
  );
}

// The longest sheet rule name the cited rule holds, else the first spec field label it holds, else `spec`.
function publicRuleOf(rule: string | undefined, ruleNames: RuleName[]): string {
  if (rule === undefined) return unnamedRule;
  const cited = ` ${wordsOf(rule)} `;
  const sheetRule = ruleNames
    .filter(({ name }) => cited.includes(` ${wordsOf(name)} `))
    .toSorted((first, second) => second.name.length - first.name.length)[0];
  if (sheetRule !== undefined) return `${sheetRule.sheet} "${sheetRule.name}"`;
  const label = specFieldLabels.find((field) =>
    cited.includes(` ${wordsOf(field)} `),
  );
  return label === undefined ? unnamedRule : `spec ${label} line`;
}

function wordsOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
