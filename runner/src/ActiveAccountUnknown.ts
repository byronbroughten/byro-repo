import { RunStop } from "./RunStop.ts";

// A step has no account to launch on: a run Stops on it, and a session's review or resolve refuses.
export class ActiveAccountUnknown extends RunStop {
  constructor() {
    super(
      `${noActiveAccountPhraseOf()}, so no step launched; check \`cswap list --json\`, then rerun.`,
    );
    this.name = "ActiveAccountUnknown";
  }
}

export function noActiveAccountPhraseOf(): string {
  return "cswap gave no readable active account";
}
