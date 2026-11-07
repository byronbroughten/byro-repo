// The verdicts on reads that still need a row, free in both modes: `gh label list`, as it holds `gh`, and `ps` and `pgrep`, as they run outside the box.
import type { SimpleCommand } from "../ShellParser.ts";
import type { Verdict } from "../tiers.ts";

// Neither has an option that writes or signals; `pkill` is left out, as it does.
const processListPrograms = new Set(["ps", "pgrep"]);

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
  processListVerdictOf({ words }: SimpleCommand): Verdict | undefined {
    const [program = ""] = words;
    if (!processListPrograms.has(program)) return undefined;
    return {
      permissionDecision: "allow",
      why: `\`${program}\` only reads the process list`,
      needsPlainText: true,
    };
  },
};
