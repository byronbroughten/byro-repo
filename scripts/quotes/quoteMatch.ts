// Finds each quoted span of a Research comment in the text of the sources it cites, page by page.
// Whitespace, line-end hyphens, ligatures and curly quotes are ignored on both sides, so a quote copied from a PDF's line breaks still matches.
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
    for (const page of source.pages) {
      if (normalize(page.text, true).includes(wanted)) {
        return { quote, file: source.file, page: page.number };
      }
    }
  }
  return undefined;
}

function normalize(text: string, isSource: boolean): string {
  const unified = text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/ﬁ/g, "fi")
    .replace(/ﬂ/g, "fl")
    .replace(/ﬀ/g, "ff")
    .replace(/ﬃ/g, "ffi")
    .replace(/ﬄ/g, "ffl");
  const dehyphenated = isSource ? unified.replace(/-\s*\n\s*/g, "") : unified;
  return dehyphenated.replace(/\s+/g, "").toLowerCase();
}
