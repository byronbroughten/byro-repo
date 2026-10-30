// A `git` call's verb and arguments, read past its global options, and what the tier gate asks of them.
export class GitCall {
  readonly verb: string;
  readonly args: string[];
  // No global option but a path one, so no `-c` config can run a command.
  readonly isPlain: boolean;

  private constructor(verb: string, args: string[], isPlain: boolean) {
    this.verb = verb;
    this.args = args;
    this.isPlain = isPlain;
  }

  static init(words: string[]): GitCall | undefined {
    if (words[0] !== "git") return undefined;
    let isPlain = true;
    for (let i = 1; i < words.length; i++) {
      const word = words[i] ?? "";
      if (gitPathOptions.has(word)) i++;
      else if (word === "-c") {
        isPlain = false;
        i++;
      } else if (
        /^--(git-dir|work-tree)=/.test(word) ||
        word === "--no-pager"
      ) {
        continue;
      } else if (word.startsWith("-")) isPlain = false;
      else return new GitCall(word, words.slice(i + 1), isPlain);
    }
    return undefined;
  }

  get isRead(): boolean {
    return (
      gitVerbs.read.has(this.verb) &&
      !this.args.some(
        (arg) =>
          arg.startsWith("--output") ||
          (this.verb === "grep" && gitGrepPagerFlags.test(arg)),
      )
    );
  }

  get isBranchChange(): boolean {
    return (
      this.verb === "branch" &&
      !this.args.some(
        (arg) =>
          branchDrops.flags.has(arg.split("=")[0] ?? "") ||
          branchDrops.shorthands.test(arg),
      )
    );
  }

  // A forced move or removal can overwrite or drop changes git never saw.
  get isTrackedFileChange(): boolean {
    return (
      gitVerbs.file.has(this.verb) &&
      !this.args.some((arg) => arg === "--force" || /^-[^-]*f/.test(arg))
    );
  }

  // Git takes any unambiguous prefix of `--no-verify`, which skips the merge's hooks.
  get isHookedMerge(): boolean {
    return (
      this.verb === "merge" &&
      !this.args.some((arg) => arg.startsWith("--no-v"))
    );
  }
}

export const gitPathOptions = new Set(["-C", "--git-dir", "--work-tree"]);

const gitVerbs = {
  read: new Set([
    "log",
    "show",
    "status",
    "diff",
    "rev-parse",
    "ls-files",
    "blame",
    "merge-base",
    "grep",
  ]),
  file: new Set(["mv", "rm"]),
} as const;
// `git grep -O` opens the matched files in a pager, which can be any program.
const gitGrepPagerFlags = /^(-[^-]*O|--open-files-in-pager)/;
// Deleting a branch, or forcing one over another, loses commits git can't bring back but by its reflog.
const branchDrops = {
  flags: new Set(["--delete", "--force"]),
  shorthands: /^-[^-]*[dDfMC]/,
} as const;
