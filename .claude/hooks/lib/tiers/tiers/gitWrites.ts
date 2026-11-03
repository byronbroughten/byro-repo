// The verdict on the one git write a box-run call still needs a row for: a raw push, which asks.
import type { SimpleCommand } from "../ShellParser.ts";
import type { Verdict } from "../tiers.ts";
import { GitCall } from "./GitCall.ts";

export const gitWrites = {
  pushVerdictOf({ words }: SimpleCommand): Verdict | undefined {
    if (GitCall.init(words)?.verb !== "push") return undefined;
    return {
      permissionDecision: "ask",
      why: "pushes outside `npm run wrap-up`, and a push can't be taken back",
    };
  },
};
