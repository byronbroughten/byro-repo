// A drafting ticket's scope: the Sections it names, or every agent Section on a final pass, read from its labels.
// pieceChecks.ts checks that scope, and the implement, review and resolve prompts word it from here.

const finalPassLabel = "final-pass";

const sectionWords = {
  named: "the Sections this ticket names",
  finalPass:
    "every Section marked `<!-- agent -->`, whichever ticket drafted it",
} as const;

export const draftingScope = {
  isFinalPass(labels: string[]): boolean {
    return labels.includes(finalPassLabel);
  },

  // Fits after "only" or "Draft", as the prompts word a Section rule.
  sectionsOf(labels: string[]): string {
    if (draftingScope.isFinalPass(labels)) {
      return `${sectionWords.finalPass}, since this is a final-pass ticket`;
    }
    return sectionWords.named;
  },

  // For text written before a ticket's labels are known, as a generated skill is.
  sectionsOfAnyTicket: `${sectionWords.named} (on a \`final-pass\` ticket, ${sectionWords.finalPass})`,

  // Fits after a length rule's opening, from lengthRuleOf or a generated skill's own.
  lengthLimit:
    "keep the agent Sections' words, headings and author marks left out, within the spec's Form `Length:` line.",

  // Fits before "keep", as a prompt words the length rule of a whole-scope ticket.
  lengthRuleOf(labels: string[]): string {
    if (draftingScope.isFinalPass(labels)) {
      return "Since this is a final-pass ticket, also";
    }
    return "When this ticket's Sections are every Section of the Agent draft, also";
  },
};
