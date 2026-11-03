// The verdict on the one read a box-run call still needs a row for, as it holds `gh`: `gh label list`, free in both modes.
import type { SimpleCommand } from "../ShellParser.ts";
import type { Verdict } from "../tiers.ts";

export const readCommands = {
  labelListVerdictOf({ words, isBare }: SimpleCommand): Verdict | undefined {
    const [program, noun, verb] = words;
    if (!isBare || program !== "gh" || noun !== "label" || verb !== "list") {
      return undefined;
    }
    return {
      permissionDecision: "allow",
      why: "`gh label list` only reads",
      needsPlainText: true,
    };
  },
};
