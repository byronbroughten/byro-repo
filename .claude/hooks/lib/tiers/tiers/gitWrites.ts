// The verdict on the one git write a box-run call still needs a row for: a raw push, which asks.
import type { SimpleCommand } from "../ShellParser.ts";
import type { Verdict } from "../tiers.ts";

// The global options whose value comes as the next word, which would otherwise be taken for the verb.
const optionsWithValue = new Set(["-C", "--git-dir", "--work-tree", "-c"]);

export const gitWrites = {
  pushVerdictOf({ words }: SimpleCommand): Verdict | undefined {
    if (!gitWrites.isPushOf(words)) return undefined;
    return {
      permissionDecision: "ask",
      why: "pushes outside `npm run wrap-up`, and a push can't be taken back",
    };
  },

  // The verb is read past git's global options, so `git -C <dir> push` counts.
  isPushOf(words: string[]): boolean {
    if (words[0] !== "git") return false;
    for (let i = 1; i < words.length; i++) {
      const word = words[i] ?? "";
      if (optionsWithValue.has(word)) i++;
      else if (!word.startsWith("-")) return word === "push";
    }
    return false;
  },
};
