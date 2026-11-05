// Writes one PDF's text to a file, each page under a "--- PDF page <n> ---" line that quoteMatch.ts and the agent can cite.
// Needs poppler's pdftotext on the PATH (brew install poppler).
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { markedPages, pagesOf } from "./quoteMatch.ts";

const usage = "usage: npm run pdf:text -- <file.pdf> <out.txt>";

try {
  const { positionals } = parseArgs({ allowPositionals: true, options: {} });
  const [pdf, out] = positionals;
  if (!pdf || !out) throw new Error(usage);
  const raw = execFileSync("pdftotext", [pdf, "-"], { encoding: "utf8" });
  const text = markedPages(raw);
  writeFileSync(out, text);
  console.log(`${pagesOf(text).length} pages written to ${out}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
