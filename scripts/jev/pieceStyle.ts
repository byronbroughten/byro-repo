import { readFileSync } from "node:fs";

import { markdownBlocks } from "./markdownBlocks.ts";

const evidenceValues = ["firsthand", "sourced", "cited"];
const formalityValues = ["general", "formal"];

export interface PieceStyle {
  evidence: string;
  formality: string;
  isAcademic: boolean;
  kind: string;
  overrides: string[];
}

// The Style file's shape is in docs/agents/jev.md.
export function readPieceStyle(stylePath: string): PieceStyle {
  const styleFile = readFileSync(stylePath, "utf8");
  const [header = "", overridesText = ""] =
    styleFile.split(/^#+\s*Overrides\s*$/im);
  const evidence = fieldValue(header, "Evidence", evidenceValues, stylePath);
  const formality = fieldValue(header, "Formality", formalityValues, stylePath);
  const isAcademic = /^(yes|true)$/i.test(field(header, "Academic") ?? "");
  const kind =
    field(header, "Kind") ??
    `A ${evidence}, ${formality}${isAcademic ? ", academic" : ""} piece of reader-facing prose.`;
  return {
    evidence,
    formality,
    isAcademic,
    kind,
    overrides: overridesOf(overridesText),
  };
}

function fieldValue(
  header: string,
  name: string,
  values: string[],
  stylePath: string,
): string {
  const value = field(header, name)?.toLowerCase();
  if (value && values.includes(value)) return value;
  throw new Error(
    `${stylePath} needs an "${name}:" line set to one of ${values.join(", ")}.`,
  );
}

// Tolerates list markers, bold and backticks around a "Name: value" line.
function field(header: string, name: string): string | undefined {
  const line = new RegExp(`^[\\s*-]*\\**${name}\\**\\s*:\\s*(.+)$`, "im").exec(
    header,
  );
  return line?.[1]?.replace(/[`*]/g, "").trim() || undefined;
}

// A subheading under Overrides, such as the spec's Form or Order, prefixes each of its paragraphs.
function overridesOf(overridesText: string): string[] {
  let heading: string | undefined;
  return markdownBlocks(overridesText).flatMap((block) => {
    if (block.kind === "heading") {
      heading = block.text;
      return [];
    }
    return [heading ? `${heading}: ${block.text}` : block.text];
  });
}
