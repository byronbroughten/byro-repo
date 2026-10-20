// Prints every run of four or more words a Deliverable shares with the passages read for it, for a judgment pass to keep or dismiss.
// Usage: npm run overlap -- --deliverable <file.md> --passages <folder> [--allow <file>]
// Each file in the folder is one passage, named by its file name. The allow file lists one proper name or fixed term per line.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { type OverlapHit, overlapHits } from "./overlapHits.ts";

const usage =
  "usage: npm run overlap -- --deliverable <file.md> --passages <folder> [--allow <file>]";

try {
  const { values } = parseArgs({
    options: {
      deliverable: { type: "string" },
      passages: { type: "string" },
      allow: { type: "string" },
    },
  });
  if (!values.deliverable || !values.passages) throw new Error(usage);
  const folder = values.passages;
  const passages = readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
    .map((entry) => ({
      name: entry.name,
      text: readFileSync(join(folder, entry.name), "utf8"),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const allowlist = values.allow
    ? readFileSync(values.allow, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("#"))
    : [];
  const hits = overlapHits({
    deliverable: readFileSync(values.deliverable, "utf8"),
    passages,
    allowlist,
  });
  console.log(report(hits, passages.length));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

function report(hits: OverlapHit[], passageCount: number): string {
  const figureCount = hits.filter((hit) => hit.isOnlyFigures).length;
  const lines = [
    "## Overlap",
    "",
    `${hits.length} shared runs of four or more words across ${passageCount} passages; ${figureCount} are only dates and figures.`,
  ];
  hits.forEach((hit, index) => {
    const figures = hit.isOnlyFigures ? ", only dates and figures" : "";
    lines.push(
      "",
      `${index + 1}. "${hit.run}" (${hit.wordCount} words${figures}), ${hit.passageName}`,
      `   - Deliverable: ${hit.sentence}`,
      `   - Passage: ${hit.passageSentence}`,
    );
  });
  return lines.join("\n");
}
