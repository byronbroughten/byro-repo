import { readFileSync } from "node:fs";

import type { PieceStyle } from "./pieceStyle.ts";

export interface StyleRule {
  text: string;
  tag: string | undefined;
}

export interface PositionRule {
  ruleStart: string;
  end: "first" | "last";
  paragraphCount: number;
}

// Rules about one place in the piece, judged only against the paragraphs at that place.
export const positionRules: PositionRule[] = [
  { ruleStart: "Open a piece", end: "first", paragraphCount: 1 },
  { ruleStart: "Right after the opening", end: "first", paragraphCount: 2 },
  { ruleStart: "Close by returning", end: "last", paragraphCount: 1 },
];

export interface StyleSheetPaths {
  voiceSheetPath: string;
  craftSheetPath: string;
  academicSheetPath: string;
}

export function pieceRules(
  { voiceSheetPath, craftSheetPath, academicSheetPath }: StyleSheetPaths,
  style: PieceStyle,
): string[] {
  const voiceRules = rulesIn(voiceSheetPath);
  requirePositionRules(voiceRules, voiceSheetPath);
  const rules = [...voiceRules, ...rulesIn(craftSheetPath)];
  if (style.isAcademic) rules.push(...rulesIn(academicSheetPath));
  return rules
    .filter(
      ({ tag }) =>
        tag === undefined || tag === style.evidence || tag === style.formality,
    )
    .map(({ text }) => text);
}

export interface ParagraphPlace {
  index: number;
  count: number;
}

export function isRuleAt(
  rule: string,
  { index, count }: ParagraphPlace,
): boolean {
  const position = positionRules.find(({ ruleStart }) =>
    rule.startsWith(ruleStart),
  );
  if (!position) return true;
  if (position.end === "first") return index < position.paragraphCount;
  return index >= count - position.paragraphCount;
}

// Sections whose bold lines define words or rank the sheets, never rules a paragraph can break.
const nonRuleSections = ["Axes", "Terms", "Precedence"];

function rulesIn(sheetPath: string): StyleRule[] {
  return rulesOf(readFileSync(sheetPath, "utf8"));
}

// Drops the text before the first section, so a sheet's intro is never read as rules.
function rulesOf(sheet: string): StyleRule[] {
  return sheet
    .split(/^## /m)
    .slice(1)
    .filter((section) => !nonRuleSections.includes(headingOf(section)))
    .flatMap((section) => section.split("\n"))
    .flatMap((line) => {
      const rule = /^- (?:`(\w+)` )?\*\*(.+?)\*\*/.exec(line);
      if (!rule) return [];
      const [, tag, text = ""] = rule;
      return [{ text, tag }];
    });
}

function headingOf(section: string): string {
  return section.split("\n", 1)[0]?.trim() ?? "";
}

function requirePositionRules(rules: StyleRule[], sheetPath: string): void {
  positionRules.forEach(({ ruleStart }) => {
    if (rules.some(({ text }) => text.startsWith(ruleStart))) return;
    throw new Error(
      `Position rule "${ruleStart}" matches no rule in ${sheetPath}; update positionRules in scripts/jev/styleRules.ts.`,
    );
  });
}
