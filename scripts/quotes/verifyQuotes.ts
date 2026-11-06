// Prints quoteMatch.ts's findings on a Research comment, and exits 1 on any finding but a quote found within its locator.
// Each file in the texts folder is one source, named as locators cite it, made by pdfText.ts or copied from a text file.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import {
  type FactFinding,
  type QuoteLocated,
  type SourceText,
  verifyComment,
} from "./quoteMatch.ts";

const usage =
  "usage: npm run verify:quotes -- --comment <comment.md> --texts <folder>";

try {
  const { values } = parseArgs({
    options: {
      comment: { type: "string" },
      texts: { type: "string" },
    },
  });
  if (!values.comment || !values.texts) throw new Error(usage);
  const findings = verifyComment(
    readFileSync(values.comment, "utf8"),
    sourceTextsIn(values.texts),
  );
  findings.forEach((finding) => console.log(lineFor(finding)));
  const failures = findings.filter((finding) => finding.kind !== "found");
  console.log(
    `\n${findings.length - failures.length} quoted spans found; ${failures.length} failures.`,
  );
  if (failures.length > 0) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

function lineFor(finding: FactFinding): string {
  const fact = `fact ${finding.fact}`;
  if (finding.kind === "noLocator") {
    if (finding.citedFile === undefined) {
      return `NO LOCATOR, ${fact}: end it with (<file>, PDF pp. <a>–<b>) or (<file>, heading "<heading>")`;
    }
    return `NO LOCATOR, ${fact}: no saved text is named ${finding.citedFile}`;
  }
  if (finding.kind === "found") {
    return `FOUND, ${fact}, ${placeOf(finding)}: ${finding.quote}`;
  }
  if (finding.kind === "outsideLocator") {
    return `OUTSIDE LOCATOR, ${fact} (found only in ${placeOf(finding)}): ${finding.quote}`;
  }
  if (finding.kind === "joined") {
    return `JOINED, ${fact} (quote each passage separately): ${finding.quote}`;
  }
  return `NOT FOUND, ${fact}: ${finding.quote}`;
}

function placeOf(finding: QuoteLocated): string {
  if (finding.page === undefined) return finding.file;
  return `${finding.file}, PDF page ${finding.page}`;
}

function sourceTextsIn(folder: string): SourceText[] {
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
    .map((entry) => ({
      file: entry.name,
      text: readFileSync(join(folder, entry.name), "utf8"),
    }));
}
