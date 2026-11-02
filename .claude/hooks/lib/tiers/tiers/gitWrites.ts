// The verdicts on git calls that write: commits, staging, branches, merges and tracked-file moves are free, and a raw push asks.
import type { SimpleCommand } from "../ShellParser.ts";
import type { Verdict } from "../tiers.ts";
import { GitCall } from "./GitCall.ts";

export const gitWrites = {
  commitVerdictOf({ words }: SimpleCommand): Verdict | undefined {
    if (GitCall.init(words)?.verb !== "commit") return undefined;
    return { permissionDecision: "allow", why: "git can undo a commit" };
  },
  addVerdictOf(simple: SimpleCommand): Verdict | undefined {
    if (plainGitOf(simple)?.verb !== "add") return undefined;
    return {
      permissionDecision: "allow",
      why: "git can undo staging a file",
      needsPlainText: true,
    };
  },
  branchVerdictOf(simple: SimpleCommand): Verdict | undefined {
    if (!plainGitOf(simple)?.isBranchChange) return undefined;
    return {
      permissionDecision: "allow",
      why: "git can undo a branch create, copy, rename or upstream change",
      needsPlainText: true,
    };
  },
  mergeVerdictOf(simple: SimpleCommand): Verdict | undefined {
    if (!plainGitOf(simple)?.isHookedMerge) return undefined;
    return {
      permissionDecision: "allow",
      why: "git can undo a merge (`git merge --abort`, or a reset to `ORIG_HEAD`)",
      needsPlainText: true,
    };
  },
  trackedFileVerdictOf(simple: SimpleCommand): Verdict | undefined {
    if (!plainGitOf(simple)?.isTrackedFileChange) return undefined;
    return {
      permissionDecision: "allow",
      why: "git can undo moving or removing a tracked file",
      needsPlainText: true,
    };
  },
  pushVerdictOf({ words }: SimpleCommand): Verdict | undefined {
    if (GitCall.init(words)?.verb !== "push") return undefined;
    return {
      permissionDecision: "ask",
      why: "pushes outside `npm run wrap-up`, and a push can't be taken back",
    };
  },
};

// A git call with no global option but a path one, and no env prefix or redirect around it.
function plainGitOf(simple: SimpleCommand): GitCall | undefined {
  const git = GitCall.init(simple.words);
  return git?.isPlain && simple.isBare ? git : undefined;
}
