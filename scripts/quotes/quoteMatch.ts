// Finds each quoted span of a Research comment in the text of its sources, across page breaks.
// Whitespace, line-end hyphens, ligatures, curly quotes and letter case are ignored; punctuation must match exactly.
// The command: verifyQuotes.ts.

export interface Page {
  number: number | undefined;
  text: string;
}

export interface QuoteMatch {
  quote: string;
  file: string;
  page: number | undefined;
}

const minQuoteWords = 4;

export function quotesIn(comment: string): string[] {
  const spans = [...comment.matchAll(/[“"]([^“”"\n]+)[”"]/g)].map((match) =>
    (match[1] ?? "").trim(),
  );
  return spans.filter((span) => span.split(/\s+/).length >= minQuoteWords);
}

export function isJoined(quote: string): boolean {
  return /\.\.\.|…/.test(quote);
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

export function findQuote(
  quote: string,
  sources: { file: string; pages: Page[] }[],
): QuoteMatch | undefined {
  const wanted = normalize(quote, false);
  for (const source of sources) {
    const { text, pageStarts } = joinedPages(source.pages);
    const at = text.indexOf(wanted);
    if (at === -1) continue;
    const start = pageStarts.findLast((page) => page.start <= at);
    return { quote, file: source.file, page: start?.number };
  }
  return undefined;
}

// One string per source, so a quote that crosses a page break is found; each page's start maps a match back to its page.
function joinedPages(pages: Page[]): {
  text: string;
  pageStarts: { start: number; number: number | undefined }[];
} {
  let text = "";
  const pageStarts: { start: number; number: number | undefined }[] = [];
  for (const page of pages) {
    pageStarts.push({ start: text.length, number: page.number });
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
