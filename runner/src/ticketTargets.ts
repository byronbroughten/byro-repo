// Reads a ticket's `## Targets` section, placed before `## Model fit`: one target outside the repo per line that the ticket's steps may write.
// SpecRun.ts reads them with the pair just before each launch; ClaudeAgentStep.ts turns them into tools, and the tier gate checks writes against them.

const sectionHeading = "## Targets";
const docLine = /^doc ([A-Za-z0-9_-]+)$/;
// The line shapes targetOf() reads, for a refusal to name.
export const targetLineShapes =
  "`app spreadsheet`, `dev spreadsheet` or `doc <id>`";

export type Target =
  { kind: "spreadsheet"; name: SpreadsheetName } | { kind: "doc"; id: string };

export type SpreadsheetName = "app" | "dev";

export type TargetsReading =
  | { status: "valid"; targets: Target[] }
  | { status: "malformed"; line: string };

const spreadsheetLines: Record<string, SpreadsheetName> = {
  "app spreadsheet": "app",
  "dev spreadsheet": "dev",
};

// A body with no section names no targets.
export function targetsOf(body: string): TargetsReading {
  const section = body
    .split(/^(?=## )/m)
    .find((part) => part.split("\n")[0]?.trim() === sectionHeading);
  if (section === undefined) return { status: "valid", targets: [] };
  const targets: Target[] = [];
  const lines = section
    .slice(sectionHeading.length)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  for (const line of lines) {
    const target = targetOf(line);
    if (target === undefined) return { status: "malformed", line };
    targets.push(target);
  }
  return { status: "valid", targets };
}

function targetOf(line: string): Target | undefined {
  const name = spreadsheetLines[line.toLowerCase()];
  if (name !== undefined) return { kind: "spreadsheet", name };
  const id = docLine.exec(line)?.[1];
  if (id !== undefined) return { kind: "doc", id };
  return undefined;
}
