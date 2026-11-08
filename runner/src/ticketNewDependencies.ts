// Reads a ticket's `## New dependencies` section: the packages its landing may add, one `- <name>` line each.

import { ticketSectionOf } from "./ticketSections.ts";

const sectionHeading = "## New dependencies";
const bulletLine = /^- `?([^\s`]+)`?$/;

// A body with no section names no packages.
export function newDependenciesOf(body: string): string[] {
  const section = ticketSectionOf(body, sectionHeading);
  if (section === undefined) return [];
  return section.split("\n").flatMap((line) => {
    const name = bulletLine.exec(line.trim())?.[1];
    return name === undefined ? [] : [name];
  });
}
