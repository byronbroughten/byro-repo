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
      (gitReads.get(this.verb)?.(this.args) ?? false) &&
      !this.args.some(
        (arg) =>
          arg.startsWith("--output") ||
          (this.verb === "grep" && gitGrepPagerFlags.test(arg)),
      )
    );
  }

  get isBranchChange(): boolean {
    return this.verb === "branch" && !this.args.some(isBranchDrop);
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
  file: new Set(["mv", "rm"]),
} as const;
// `git grep -O` opens the matched files in a pager, which can be any program.
const gitGrepPagerFlags = /^(-[^-]*O|--open-files-in-pager)/;
// Deleting a branch, or forcing one over another, loses commits git can't bring back but by its reflog.
const branchDrops = {
  flags: new Set(["--delete", "--force"]),
  shorthands: /^-[^-]*[dDfMC]/,
} as const;
// The flags that tell a read form of a writing verb from its writes. Git takes one action per `config` call, so a read action beside a write one fails.
const readFormFlags = {
  verbose: new Set(["-v", "--verbose"]),
  list: new Set(["-l", "--list"]),
  configReads: new Set(["--get", "--get-all", "--list", "-l"]),
  configWrites: new Set([
    "--add",
    "--unset",
    "--unset-all",
    "--replace-all",
    "--rename-section",
    "--remove-section",
    "-e",
    "--edit",
  ]),
  tagDrops: new Set(["-d", "--delete", "-f", "--force"]),
} as const;

// Each git read by verb and, for a verb that also writes, its read forms: listed reads, since a blocklist of writes would miss the next `reset --hard`. The network reads (`ls-remote`, `fetch`, `remote show`, `update`, `prune`) stay out.
const gitReads = new Map<string, (args: string[]) => boolean>([
  ...[
    "log",
    "show",
    "status",
    "diff",
    "rev-parse",
    "ls-files",
    "blame",
    "merge-base",
    "grep",
    "cat-file",
    "rev-list",
    "for-each-ref",
    "describe",
    "shortlog",
  ].map((verb): [string, () => boolean] => [verb, () => true]),
  ["remote", isRemoteRead],
  [
    "reflog",
    ([subcommand]) => subcommand === undefined || subcommand === "show",
  ],
  ["worktree", ([subcommand]) => subcommand === "list"],
  [
    "config",
    (args) =>
      args.some((arg) => readFormFlags.configReads.has(arg)) &&
      !args.some((arg) => readFormFlags.configWrites.has(arg)),
  ],
  [
    "branch",
    (args) =>
      args.some((arg) => readFormFlags.list.has(arg)) &&
      !args.some(isBranchDrop),
  ],
  [
    "tag",
    (args) =>
      args.some((arg) => readFormFlags.list.has(arg)) &&
      !args.some((arg) => readFormFlags.tagDrops.has(arg)),
  ],
]);

function isBranchDrop(arg: string): boolean {
  return (
    branchDrops.flags.has(arg.split("=")[0] ?? "") ||
    branchDrops.shorthands.test(arg)
  );
}

// `git remote` with no subcommand lists, as does `-v`; `get-url` reads one remote's URL.
function isRemoteRead(args: string[]): boolean {
  const [subcommand] = args.filter((arg) => !readFormFlags.verbose.has(arg));
  return subcommand === undefined || subcommand === "get-url";
}
