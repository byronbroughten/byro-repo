// Outline edits a Research Halt proposes: their `E<n>` ids and words, which an answer approves, and their
// word-for-word application to a spec body's `## Outline`, which never throws and applies nothing twice.
// The run applies them in ./SpecRun/OutlineEditApplier.ts; a repo command imports this module as `@byronbroughten/spec-runner/outlineEdits`.

import type { OutlineEdit } from "./stepRecords.ts";
import { ticketSectionOf } from "./ticketSections.ts";

const outlineHeading = "## Outline";

export interface AppliedEdits {
  body: string;
  // The edit objects given, never copies, in their order, so a caller finds each one's id by `indexOf` in its Halt's list.
  unapplied: OutlineEdit[];
}

export const outlineEdits = {
  // `index` is the edit's place in its Halt's list, from 0.
  idOf(index: number): string {
    return `E${index + 1}`;
  },

  textOf({ section, oldText, newText, reason }: OutlineEdit): string {
    return `${section}: replace "${oldText}" with "${newText}" (${reason})`;
  },

  // An edit as a Halt lists it, under its id.
  lineOf(edit: OutlineEdit, index: number): string {
    return `**${outlineEdits.idOf(index)}** ${outlineEdits.textOf(edit)}`;
  },

  // Each edit an `approve E<n>` in the answer names.
  approvedOf(answerText: string, edits: OutlineEdit[]): OutlineEdit[] {
    const approved = new Set(
      [...answerText.matchAll(/\bapprove\s+E(\d+)\b/gi)].map(([, id]) =>
        Number(id),
      ),
    );
    return edits.filter((_, index) => approved.has(index + 1));
  },

  // An edit whose old text is gone and whose new text is there counts as applied, so a run killed partway can apply them again.
  applyTo(body: string, edits: OutlineEdit[]): AppliedEdits {
    const section = ticketSectionOf(body, outlineHeading);
    if (section === undefined) return { body, unapplied: [...edits] };
    const applied = edits.reduce<AppliedEdits>(
      (appliedEdits, edit) => {
        if (isApplied(appliedEdits.body, edit)) return appliedEdits;
        if (countOf(appliedEdits.body, edit.oldText) !== 1) {
          appliedEdits.unapplied.push(edit);
          return appliedEdits;
        }
        appliedEdits.body = splicedOf(appliedEdits.body, edit);
        return appliedEdits;
      },
      { body: section, unapplied: [] },
    );
    return {
      body: splicedOf(body, { oldText: section, newText: applied.body }),
      unapplied: applied.unapplied,
    };
  },
};

// Every old text left sits inside a new text, so a new text holding its old one isn't applied twice; a deletion counts once its old text is gone.
function isApplied(text: string, { oldText, newText }: OutlineEdit): boolean {
  const left =
    countOf(text, oldText) - countOf(text, newText) * countOf(newText, oldText);
  return left === 0 && (newText === "" || countOf(text, newText) > 0);
}

// Sliced rather than String.replace, so a `$` in the new text stays as written.
function splicedOf(
  text: string,
  { oldText, newText }: Pick<OutlineEdit, "oldText" | "newText">,
): string {
  const start = text.indexOf(oldText);
  return `${text.slice(0, start)}${newText}${text.slice(start + oldText.length)}`;
}

function countOf(text: string, phrase: string): number {
  if (phrase === "") return 0;
  return text.split(phrase).length - 1;
}
