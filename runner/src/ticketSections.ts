// Finds one `## ` section of a ticket's body, for the readers of its machine-read sections.

export function ticketSectionOf(
  body: string,
  heading: string,
): string | undefined {
  return body
    .split(/^(?=## )/m)
    .find((part) => part.split("\n")[0]?.trim() === heading);
}
