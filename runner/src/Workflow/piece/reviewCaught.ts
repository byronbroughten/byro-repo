// A piece row's review cell: the log is public and a Piece's prose may be private, so a kept finding is its axis and public rule only.

import { caughtCellOf, type ResolveRecord } from "../../stepRecords.ts";

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

// A label only as the citation's own field reference, since a cited sentence that merely holds the word may be private.
const specFieldReference = new RegExp(
  `^(?:the )?(?:piece )?(?:spec(?:['’]s)? )?(${specFieldLabels.join("|")})(?: (?:line|field|section))?(?=$|[:;,.]| [-–—])`,
  "i",
);

interface RuleName {
  sheet: RuleSheetName;
  name: string;
}

export function pieceReviewCaughtOf(
  records: ResolveRecord[],
  sheets: RuleSheets,
): string | undefined {
  const ruleNames = ruleNamesOf(sheets);
  return caughtCellOf(records, (kept) => {
    const counts = kept.reduce((byEntry, { axis, rule }) => {
      const entry = `${axis}, ${publicRuleOf(rule, ruleNames)}`;
      byEntry.set(entry, (byEntry.get(entry) ?? 0) + 1);
      return byEntry;
    }, new Map<string, number>());
    return [...counts].map(([entry, count]) => `${entry} ×${count}`);
  });
}

// Every bold-led bullet in a sheet, axis tag or not, outside its `## Axes` section, whose bullets are a Piece's settings.
function ruleNamesOf(sheets: RuleSheets): RuleName[] {
  return Object.entries(sheets).flatMap(([sheet, markdown]) =>
    [...withoutAxes(markdown).matchAll(/^- (?:`[^`]+` )?\*\*(.+?)\*\*/gm)].map(
      ([, bold = ""]) => ({
        sheet: sheet as RuleSheetName,
        name: bold.replace(/[.:;]+$/, ""),
      }),
    ),
  );
}

function withoutAxes(markdown: string): string {
  return markdown.replace(/^## Axes$[\s\S]*?(?=^## |(?![\s\S]))/m, "");
}

// The longest sheet rule name the cited rule holds, else the spec field it refers to, else `spec`.
function publicRuleOf(rule: string | undefined, ruleNames: RuleName[]): string {
  if (rule === undefined) return unnamedRule;
  const cited = ` ${wordsOf(rule)} `;
  const sheetRule = ruleNames
    .filter(({ name }) => cited.includes(` ${wordsOf(name)} `))
    .toSorted((first, second) => second.name.length - first.name.length)[0];
  if (sheetRule !== undefined) return `${sheetRule.sheet} "${sheetRule.name}"`;
  const referred = specFieldReference.exec(rule.trim())?.[1]?.toLowerCase();
  const label = specFieldLabels.find(
    (field) => field.toLowerCase() === referred,
  );
  return label === undefined ? unnamedRule : `spec ${label} line`;
}

function wordsOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
