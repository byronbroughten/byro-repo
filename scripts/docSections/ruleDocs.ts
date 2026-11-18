// The repo rule docs `npm run doc:sections` prints, whole or by `##` section: the read-first gate's docs and the ticket rules.
import { join, normalize } from "node:path";

import { ticketSectionOf } from "@byronbroughten/spec-runner/ticketSections";

import {
  codeStylePath,
  frameworkStylePath,
  proseStylePath,
  tierTablePath,
  writingDocPaths,
} from "../../.claude/hooks/lib/readFirstGate.ts";

const usage = "usage: npm run doc:sections -- <doc> [<section>...]";
const knownPaths = [
  codeStylePath,
  frameworkStylePath,
  proseStylePath,
  writingDocPaths.voice,
  writingDocPaths.craft,
  tierTablePath,
  join("docs", "agents", "tickets.md"),
];

export const ruleDocs = {
  // args are the doc's repo-relative path, then the headings of the sections to print, without their `## `.
  textOf(args: string[], readDoc: (path: string) => string): string {
    const [docArg, ...headings] = args;
    if (docArg === undefined) throw new Error(usage);
    const path = normalize(docArg);
    if (!knownPaths.includes(path)) {
      throw new Error(
        `\`${docArg}\` is no doc \`npm run doc:sections\` prints; it prints ${knownPaths.map((known) => `\`${known}\``).join(", ")}`,
      );
    }
    const text = readDoc(path);
    if (headings.length === 0) return text;
    return headings
      .map((heading) => sectionOf(text, path, heading))
      .join("\n\n");
  },
};

function sectionOf(text: string, path: string, heading: string): string {
  const section = ticketSectionOf(text, `## ${heading}`);
  if (section === undefined) {
    throw new Error(`\`${path}\` has no \`## ${heading}\` section`);
  }
  return section.trimEnd();
}
