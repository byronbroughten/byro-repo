import { readFileSync } from "node:fs";

import { markdownBlocks } from "./markdownBlocks.ts";

const axisValues = {
  Evidence: ["firsthand", "sourced", "cited"],
  Formality: ["general", "formal"],
} as const;

type AxisName = keyof typeof axisValues;
type AxisValue<AN extends AxisName> = (typeof axisValues)[AN][number];

interface StyleFile {
  path: string;
  header: string;
}

export interface PieceStyle {
  evidence: AxisValue<"Evidence">;
  formality: AxisValue<"Formality">;
  isAcademic: boolean;
  kind: string;
  overrides: string[];
}

// The Style file's shape is in docs/agents/jev.md.
export function readPieceStyle(stylePath: string): PieceStyle {
  const [header = "", overridesText] = readFileSync(stylePath, "utf8").split(
    /^#+\s*Overrides\s*$/im,
  );
  if (overridesText === undefined) {
    throw new Error(
      `${stylePath} needs an "## Overrides" heading; leave it empty when the spec has none.`,
    );
  }
  const styleFile = { path: stylePath, header };
  const evidence = axisValue(styleFile, "Evidence");
  const formality = axisValue(styleFile, "Formality");
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

function axisValue<AN extends AxisName>(
  { path, header }: StyleFile,
  name: AN,
): AxisValue<AN> {
  const value = field(header, name)?.toLowerCase();
  const values: readonly AxisValue<AN>[] = axisValues[name];
  const match = values.find((axis) => axis === value);
  if (match) return match;
  throw new Error(
    `${path} needs an "${name}:" line set to one of ${values.join(", ")}.`,
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
