// Checks a Research comment against its sources: every numbered fact ends with a locator, and every double-quoted span in it is found within the cited source's cited pages, across page breaks.
// Whitespace, line-end hyphens, ligatures, curly quotes and letter case are ignored; punctuation must match exactly. Any span in double quotes counts, whatever its length.
// It does not judge whether a fact is right (that is /review-research), and it is not the plagiarism check (that is overlap in /review-piece).
// Also marks each page of pdftotext's output and reads pdfinfo's page count. The command: verifyQuotes.ts.

export interface Page {
  number: number | undefined;
  text: string;
}

export interface SourceText {
  file: string;
  text: string;
}

export interface QuoteLocated {
  kind: "found" | "outsideLocator";
  fact: number;
  quote: string;
  file: string;
  page: number | undefined;
}

export interface QuoteFailed {
  kind: "notFound" | "joined";
  fact: number;
  quote: string;
}

export interface FactUnlocated {
  kind: "noLocator";
  fact: number;
  citedFile: string | undefined;
  missingPages?: PageRange;
}

export interface PageRange {
  first: number;
  last: number;
}

export type FactFinding = QuoteLocated | QuoteFailed | FactUnlocated;

interface Fact {
  number: number;
  text: string;
}

interface Locator {
  file: string;
  firstPage: number | undefined;
  lastPage: number | undefined;
}

interface Source {
  file: string;
  pages: Page[];
}

// `(heagney.txt, PDF pp. 45–46 (printed 31–32))`, `(heagney.txt, PDF p. 45)` or `(notes.txt, heading "Scope of work")`, closing the fact.
const locatorPattern =
  /\(([^,()]+), (?:PDF pp?\. (\d+)(?:\s*[–-]\s*(\d+))?(?: \(printed [^()]*\))?|heading [“"][^“”"\n]+[”"])\)\s*$/;

export function verifyComment(
  comment: string,
  sourceTexts: SourceText[],
): FactFinding[] {
  const sources = sourceTexts
    .map((source) => ({ file: source.file, pages: pagesOf(source.text) }))
    .sort((a, b) => a.file.localeCompare(b.file));
  return factsIn(comment).flatMap((fact) => factFindings(fact, sources));
}

// pdftotext ends every page with a form feed, so only the empty piece after the last one is dropped; a blank page keeps its number.
export function markedPages(pdftotextOutput: string): string {
  const pages = pdftotextOutput.split("\f");
  if (pages.at(-1)?.trim() === "") pages.pop();
  return pages
    .map((page, index) => `--- PDF page ${index + 1} ---\n${page.trimEnd()}\n`)
    .join("");
}

export function pageCountOf(pdfinfoOutput: string): number {
  const match = /^Pages:\s+(\d+)$/m.exec(pdfinfoOutput);
  if (!match?.[1]) throw new Error("pdfinfo printed no Pages: line");
  return Number(match[1]);
}

export function pagesOf(text: string): Page[] {
  const parts = text.split(/^--- PDF page (\d+) ---$/m);
  if (parts.length === 1) return [{ number: undefined, text }];
  const pages: Page[] = [];
  for (let index = 1; index < parts.length; index += 2) {
    pages.push({ number: Number(parts[index]), text: parts[index + 1] ?? "" });
  }
  return pages;
}

// A fact runs from its number to the next blank line, numbered line or heading; the `## Unverified` section holds no facts.
function factsIn(comment: string): Fact[] {
  const facts: Fact[] = [];
  let current: Fact | undefined;
  let isUnverified = false;
  for (const line of comment.split("\n")) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      isUnverified = /^unverified\b/i.test(heading[1] ?? "");
      current = undefined;
      continue;
    }
    if (isUnverified) continue;
    const numbered = /^\s*(\d+)\.\s+(.*)$/.exec(line);
    if (numbered) {
      current = { number: Number(numbered[1]), text: numbered[2] ?? "" };
      facts.push(current);
    } else if (line.trim() === "") {
      current = undefined;
    } else if (current) {
      current.text += ` ${line.trim()}`;
    }
  }
  return facts;
}

function factFindings(fact: Fact, sources: Source[]): FactFinding[] {
  const match = locatorPattern.exec(fact.text);
  if (!match) {
    return [{ kind: "noLocator", fact: fact.number, citedFile: undefined }];
  }
  const locator = locatorOf(match);
  const cited = sources.find((source) => source.file === locator.file);
  if (!cited) {
    return [{ kind: "noLocator", fact: fact.number, citedFile: locator.file }];
  }
  const pages = citedPages(cited, locator);
  const missingPages = missingPagesOf(locator, pages);
  if (missingPages) {
    return [
      {
        kind: "noLocator",
        fact: fact.number,
        citedFile: cited.file,
        missingPages,
      },
    ];
  }
  const citedRange = { file: cited.file, pages };
  const others = sources.filter((source) => source !== cited);
  const outside = [cited, ...others];
  const claim = fact.text.slice(0, match.index);
  return quotesIn(claim).map((quote) =>
    quoteFinding({ fact: fact.number, quote, citedRange, outside }),
  );
}

// Without this, a fact with no quotes passes on a page its source lacks, every page of an unpaged source included.
function missingPagesOf(
  locator: Locator,
  pages: Page[],
): PageRange | undefined {
  const { firstPage, lastPage } = locator;
  if (firstPage === undefined || lastPage === undefined) return undefined;
  if (pages.length > lastPage - firstPage) return undefined;
  return { first: firstPage, last: lastPage };
}

function locatorOf(match: RegExpExecArray): Locator {
  const file = (match[1] ?? "").trim();
  if (match[2] === undefined) {
    return { file, firstPage: undefined, lastPage: undefined };
  }
  const firstPage = Number(match[2]);
  return { file, firstPage, lastPage: Number(match[3] ?? firstPage) };
}

function quotesIn(claim: string): string[] {
  return [...claim.matchAll(/[“"]([^“”"\n]+)[”"]/g)].map((match) =>
    (match[1] ?? "").trim(),
  );
}

// `outside` is searched only when the cited range misses: the cited source first, then the others.
function quoteFinding({
  fact,
  quote,
  citedRange,
  outside,
}: {
  fact: number;
  quote: string;
  citedRange: Source;
  outside: Source[];
}): FactFinding {
  if (/\.\.\.|…/.test(quote)) return { kind: "joined", fact, quote };
  const inRange = placeQuoted(quote, [citedRange]);
  const place = inRange ?? placeQuoted(quote, outside);
  if (!place) return { kind: "notFound", fact, quote };
  const kind = inRange ? "found" : "outsideLocator";
  return { kind, fact, quote, file: place.file, page: place.page.number };
}

function placeQuoted(
  quote: string,
  sources: Source[],
): { file: string; page: Page } | undefined {
  for (const source of sources) {
    const page = pageQuoted(quote, source.pages);
    if (page) return { file: source.file, page };
  }
  return undefined;
}

// A heading locator scopes the match to its whole source file.
function citedPages(source: Source, locator: Locator): Page[] {
  const { firstPage, lastPage } = locator;
  if (firstPage === undefined || lastPage === undefined) return source.pages;
  return source.pages.filter(
    (page) =>
      page.number !== undefined &&
      page.number >= firstPage &&
      page.number <= lastPage,
  );
}

// The page the quote starts on, or undefined when the pages don't contain it.
function pageQuoted(quote: string, pages: Page[]): Page | undefined {
  const wanted = normalize(quote, false);
  const { text, pageStarts } = joinedPages(pages);
  const at = text.indexOf(wanted);
  if (at === -1) return undefined;
  return pageStarts.findLast((start) => start.start <= at)?.page;
}

// One string for the pages, so a quote that crosses a page break is found; each page's start maps a match back to its page.
function joinedPages(pages: Page[]): {
  text: string;
  pageStarts: { start: number; page: Page }[];
} {
  let text = "";
  const pageStarts: { start: number; page: Page }[] = [];
  for (const page of pages) {
    pageStarts.push({ start: text.length, page });
    text += normalize(page.text, true);
  }
  return { text, pageStarts };
}

function normalize(text: string, isSource: boolean): string {
  const unified = text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/ﬁ/g, "fi")
    .replace(/ﬂ/g, "fl")
    .replace(/ﬀ/g, "ff")
    .replace(/ﬃ/g, "ffi")
    .replace(/ﬄ/g, "ffl");
  const dehyphenated = isSource ? unified.replace(/-\s*\n\s*/g, "") : unified;
  return dehyphenated.replace(/\s+/g, "").toLowerCase();
}
