import { RunStop } from "./RunStop.ts";

// A fresh step has no account to launch on: a run Stops on it, and a session's review or resolve refuses.
export class ActiveAccountUnknown extends RunStop {
  constructor() {
    super(
      "cswap reported no active account, so no step launched; check `cswap list --json`, then rerun.",
    );
    this.name = "ActiveAccountUnknown";
  }
}
