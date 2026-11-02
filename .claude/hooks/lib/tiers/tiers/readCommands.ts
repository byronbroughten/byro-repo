// The verdict on a command that only reads: the read programs, `cd`, git's reads and the stdout filters with no write or exec.
import type { SimpleCommand } from "../ShellParser.ts";
import { stdoutFilters } from "../stdoutFilters.ts";
import type { Verdict } from "../tiers.ts";
import { GitCall } from "./GitCall.ts";

// jq has no option that runs a program or writes a file.
const readPrograms = new Set([
  "grep",
  "rg",
  "cat",
  "head",
  "tail",
  "wc",
  "ls",
  "jq",
]);
const findActions = new Set([
  "-exec",
  "-execdir",
  "-ok",
  "-okdir",
  "-delete",
  "-fprint",
  "-fprint0",
  "-fprintf",
  "-fls",
]);
// ripgrep runs the program each of these names.
const rgRunFlags = ["--pre", "--hostname-bin"];

export const readCommands = {
  verdictOf(simple: SimpleCommand): Verdict | undefined {
    const readWhy = simple.isBare ? readWhyOf(simple.words) : undefined;
    if (!readWhy) return undefined;
    return { permissionDecision: "allow", why: readWhy, needsPlainText: true };
  },
};

// Programs match by bare name only, since a path could be any program.
function readWhyOf(words: string[]): string | undefined {
  const [program = "", ...args] = words;
  if (program === "cd") return "`cd` changes no file";
  const git = GitCall.init(words);
  if (git) {
    return git.isPlain && git.isRead
      ? `\`git ${git.verb}\` only reads`
      : undefined;
  }
  return isProgramRead(program, args) ? `\`${program}\` only reads` : undefined;
}

function isProgramRead(program: string, args: string[]): boolean {
  const isFilterRead = stdoutFilters.get(program);
  if (isFilterRead) return isFilterRead(args);
  if (program === "find") return !args.some((arg) => findActions.has(arg));
  if (program === "rg") {
    return !args.some((arg) => rgRunFlags.some((flag) => arg.startsWith(flag)));
  }
  if (program === "gh") return args[0] === "label" && args[1] === "list";
  return readPrograms.has(program);
}
