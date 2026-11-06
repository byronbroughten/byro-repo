// Checks a Research comment against its sources: every numbered fact ends with a locator, and every double-quoted span in it is found within the cited source's cited pages, across page breaks.
// Whitespace, line-end hyphens, ligatures, curly quotes and letter case are ignored; punctuation must match exactly. Any span in double quotes counts, whatever its length.
// It does not judge whether a fact is right (that is /review-research), and it is not the plagiarism check (that is overlap in /review-piece).
// Also marks each page of pdftotext's output. The command: verifyQuotes.ts.

export interface Page {
  number: number | undefined;
  text: string;
}

export interface SourceText {
  file: string;
  text: string;
}

export interface QuoteFound {
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
}

export type QuoteFinding = QuoteFound | QuoteFailed | FactUnlocated;

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
): QuoteFinding[] {
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

function factFindings(fact: Fact, sources: Source[]): QuoteFinding[] {
  const match = locatorPattern.exec(fact.text);
  if (!match) {
    return [{ kind: "noLocator", fact: fact.number, citedFile: undefined }];
  }
  const locator = locatorOf(match);
  const cited = sources.find((source) => source.file === locator.file);
  if (!cited) {
    return [{ kind: "noLocator", fact: fact.number, citedFile: locator.file }];
  }
  const claim = fact.text.slice(0, match.index);
  return quotesIn(claim).map((quote) =>
    quoteFinding({ fact: fact.number, quote, cited, locator, sources }),
  );
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

function quoteFinding({
  fact,
  quote,
  cited,
  locator,
  sources,
}: {
  fact: number;
  quote: string;
  cited: Source;
  locator: Locator;
  sources: Source[];
}): QuoteFinding {
  if (/\.\.\.|…/.test(quote)) return { kind: "joined", fact, quote };
  const inRange = pageQuoted(quote, citedPages(cited, locator));
  if (inRange) {
    return {
      kind: "found",
      fact,
      quote,
      file: cited.file,
      page: inRange.number,
    };
  }
  const others = sources.filter((source) => source !== cited);
  for (const source of [cited, ...others]) {
    const page = pageQuoted(quote, source.pages);
    if (!page) continue;
    return {
      kind: "outsideLocator",
      fact,
      quote,
      file: source.file,
      page: page.number,
    };
  }
  return { kind: "notFound", fact, quote };
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
