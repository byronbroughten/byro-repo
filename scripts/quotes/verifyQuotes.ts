// Prints each quoted span of a Research comment that no source text in the folder contains, and exits 1 if any is missing.
// Each file in the texts folder is one source, made by pdfText.ts or copied from a text file. The rule: docs/writing-voice/borrowing.md.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { findQuote, type Page, pagesOf, quotesIn } from "./quoteMatch.ts";

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
  const quotes = quotesIn(readFileSync(values.comment, "utf8"));
  const sources = sourcesOf(values.texts);
  const missing: string[] = [];
  let found = 0;
  for (const quote of quotes) {
    const match = findQuote(quote, sources);
    if (match) {
      found += 1;
      const page = match.page === undefined ? "" : `, page ${match.page}`;
      console.log(`FOUND ${match.file}${page}: ${quote}`);
    } else {
      missing.push(quote);
    }
  }
  console.log(
    `\n${found} of ${quotes.length} quoted spans found; ${missing.length} not found.`,
  );
  for (const quote of missing) console.log(`NOT FOUND: ${quote}`);
  if (missing.length > 0) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

function sourcesOf(folder: string): { file: string; pages: Page[] }[] {
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
    .map((entry) => ({
      file: entry.name,
      pages: pagesOf(readFileSync(join(folder, entry.name), "utf8")),
    }))
    .sort((a, b) => a.file.localeCompare(b.file));
}
