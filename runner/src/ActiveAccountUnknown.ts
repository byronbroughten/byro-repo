import { RunStop } from "./RunStop.ts";

// A fresh step has no account to launch on: a run Stops on it, and a session's review or resolve refuses.
export class ActiveAccountUnknown extends RunStop {
  constructor() {
    super(
      "No active account could be read from cswap, so no step launched; check `cswap list --json`, then rerun.",
    );
    this.name = "ActiveAccountUnknown";
  }
}
