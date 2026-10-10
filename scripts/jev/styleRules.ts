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
  styleSheetPath: string;
  academicSheetPath: string;
}

export function pieceRules(
  { styleSheetPath, academicSheetPath }: StyleSheetPaths,
  style: PieceStyle,
): string[] {
  const sheetRules = rulesOf(readFileSync(styleSheetPath, "utf8"));
  requirePositionRules(sheetRules, styleSheetPath);
  const rules = [...sheetRules];
  if (style.isAcademic) {
    rules.push(...rulesOf(readFileSync(academicSheetPath, "utf8")));
  }
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

// Starts at the first section after Axes, so the axis definitions are never read as rules.
function rulesOf(sheet: string): StyleRule[] {
  const lines = sheet.split("\n");
  const axes = lines.findIndex((line) => /^## Axes\s*$/.test(line));
  const start = lines.findIndex(
    (line, index) => index > axes && line.startsWith("## "),
  );
  return lines.slice(Math.max(start, 0)).flatMap((line) => {
    const rule = /^- (?:`(\w+)` )?\*\*(.+?)\*\*/.exec(line);
    if (!rule) return [];
    const [, tag, text = ""] = rule;
    return [{ text, tag }];
  });
}

function requirePositionRules(rules: StyleRule[], sheetPath: string): void {
  positionRules.forEach(({ ruleStart }) => {
    if (rules.some(({ text }) => text.startsWith(ruleStart))) return;
    throw new Error(
      `Position rule "${ruleStart}" matches no rule in ${sheetPath}; update positionRules in scripts/jev/styleRules.ts.`,
    );
  });
}
