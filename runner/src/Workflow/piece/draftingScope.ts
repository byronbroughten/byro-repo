// A drafting ticket's scope: the Sections it names, or every agent Section on a final pass, read from its labels.
// pieceChecks.ts checks that scope, and the implement, review and resolve prompts word it from here.

const finalPassLabel = "final-pass";

export const draftingScope = {
  isFinalPass(labels: string[]): boolean {
    return labels.includes(finalPassLabel);
  },

  // Fits after "only" or "Draft", as the prompts word a Section rule.
  sectionsOf(labels: string[]): string {
    if (draftingScope.isFinalPass(labels)) {
      return "every Section marked `<!-- agent -->`, whichever ticket drafted it, since this is a final-pass ticket";
    }
    return "the Sections this ticket names";
  },

  // Fits before "keep", as a prompt words the length rule of a whole-scope ticket.
  lengthRuleOf(labels: string[]): string {
    if (draftingScope.isFinalPass(labels)) {
      return "Since this is a final-pass ticket, also";
    }
    return "When this ticket's Sections are every Section of the Agent draft, also";
  },
};
