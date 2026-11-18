// Finds one `## ` section of a ticket's body, for the readers of its machine-read sections.

export function ticketSectionOf(
  body: string,
  heading: string,
): string | undefined {
  return sectionsOf(body).find(
    (part) => part.split("\n")[0]?.trim() === heading,
  );
}

// Empty for an empty body; the text before the first heading counts as a section.
export function lastTicketSectionOf(body: string): string {
  return sectionsOf(body).at(-1) ?? "";
}

function sectionsOf(body: string): string[] {
  return body.split(/^(?=## )/m);
}
