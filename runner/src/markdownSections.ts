// Finds one `## ` section of a Markdown body, for the readers of a ticket's machine-read sections and `npm run doc:sections`.

export function markdownSectionOf(
  body: string,
  heading: string,
): string | undefined {
  return sectionsOf(body).find(
    (part) => part.split("\n")[0]?.trim() === heading,
  );
}

// Empty for an empty body; the text before the first heading counts as a section.
export function lastMarkdownSectionOf(body: string): string {
  return sectionsOf(body).at(-1) ?? "";
}

function sectionsOf(body: string): string[] {
  return body.split(/^(?=## )/m);
}
