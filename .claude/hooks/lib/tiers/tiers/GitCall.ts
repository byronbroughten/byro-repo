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
      trackedFileVerbs.has(this.verb) &&
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

const trackedFileVerbs = new Set(["mv", "rm"]);
// `git grep -O` opens the matched files in a pager, which can be any program.
const gitGrepPagerFlags = /^(-[^-]*O|--open-files-in-pager)/;
// Deleting a branch or tag, or forcing one over another, loses commits git can't bring back but by its reflog.
const refDrops = {
  branchFlags: new Set(["--delete", "--force"]),
  branchShorthands: /^-[^-]*[dDfMC]/,
  tagFlags: new Set(["-d", "--delete", "-f", "--force"]),
} as const;
// The flags and words that tell a read form of a writing verb from its writes.
const readForms = {
  verbose: new Set(["-v", "--verbose"]),
  list: new Set(["-l", "--list"]),
  // Each sets git's list mode, in which a tag name is only a pattern.
  tagLists: new Set([
    "-l",
    "--list",
    "--contains",
    "--no-contains",
    "--merged",
    "--no-merged",
    "--points-at",
  ]),
  tagLineCounts: /^-n\d*$/,
  // Git takes one action per `config` call, so a read action beside a write one fails.
  configReads: new Set([
    "--get",
    "--get-all",
    "--get-regexp",
    "--get-urlmatch",
    "--list",
    "-l",
  ]),
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
  configSubcommandReads: new Set(["get", "list"]),
  // Options whose value may come as the next word, which would shift which word is the key or subcommand.
  configValueOptions: new Set([
    "-f",
    "--file",
    "--blob",
    "--type",
    "--default",
    "--comment",
  ]),
  reflogReads: new Set(["show", "exists", "list"]),
  // A word git could take as a reflog subcommand: theirs are bare lowercase words.
  reflogSubcommandShape: /^[a-z-]+$/,
  stashReads: new Set(["list", "show"]),
  symbolicRefWrites: new Set(["-d", "--delete", "-m"]),
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
    "ls-tree",
    "show-ref",
    "name-rev",
    "check-ignore",
    "check-attr",
    "cherry",
    "range-diff",
    "count-objects",
    "whatchanged",
    "diff-tree",
    "diff-index",
    "diff-files",
    "var",
    "version",
  ].map((verb): [string, () => boolean] => [verb, () => true]),
  ["remote", isRemoteRead],
  ["reflog", isReflogRead],
  ["worktree", ([subcommand]) => subcommand === "list"],
  ["stash", ([subcommand = ""]) => readForms.stashReads.has(subcommand)],
  [
    "symbolic-ref",
    (args) =>
      wordsOf(args).length <= 1 &&
      !args.some((arg) => readForms.symbolicRefWrites.has(arg)),
  ],
  ["config", isConfigRead],
  [
    "branch",
    (args) =>
      args.some((arg) => readForms.list.has(arg)) && !args.some(isBranchDrop),
  ],
  ["tag", isTagRead],
]);

function isBranchDrop(arg: string): boolean {
  return (
    refDrops.branchFlags.has(arg.split("=")[0] ?? "") ||
    refDrops.branchShorthands.test(arg)
  );
}

// The arguments that aren't options: an option's separate value among them.
function wordsOf(args: string[]): string[] {
  return args.filter((arg) => !arg.startsWith("-"));
}

// `git remote` with no subcommand lists, as does `-v`; `get-url` reads one remote's URL.
function isRemoteRead(args: string[]): boolean {
  const [subcommand] = args.filter((arg) => !readForms.verbose.has(arg));
  return subcommand === undefined || subcommand === "get-url";
}

// Git reads the first word as a subcommand, and any word that isn't one sends it and the rest to `show`, so a ref there, or an option's value, reads.
function isReflogRead(args: string[]): boolean {
  const [word] = wordsOf(args);
  return (
    word === undefined ||
    readForms.reflogReads.has(word) ||
    !readForms.reflogSubcommandShape.test(word)
  );
}

// `git config <key>` with one dotted key reads it; a subcommand has no dot, so `git config edit` stays out.
function isConfigRead(args: string[]): boolean {
  if (args.some((arg) => readForms.configWrites.has(arg))) return false;
  if (args.some((arg) => readForms.configReads.has(arg))) return true;
  if (args.some((arg) => readForms.configValueOptions.has(arg))) return false;
  const words = wordsOf(args);
  if (readForms.configSubcommandReads.has(words[0] ?? "")) return true;
  return words.length === 1 && (words[0] ?? "").includes(".");
}

// Git lists tags with no tag name, or under a flag that sets its list mode.
function isTagRead(args: string[]): boolean {
  if (args.some((arg) => refDrops.tagFlags.has(arg))) return false;
  return (
    wordsOf(args).length === 0 ||
    args.some(
      (arg) =>
        readForms.tagLists.has(arg.split("=")[0] ?? "") ||
        readForms.tagLineCounts.test(arg),
    )
  );
}
