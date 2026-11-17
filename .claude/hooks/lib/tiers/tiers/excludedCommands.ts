// The refusal of a call that holds an `excludedCommands` entry but stays in the sandbox, where it fails without naming the box or, for the research push, pushes past the tier gate.
// Claude Code lets a call out only when every command in it matches an entry, with nothing beside them but `&&`, `||`, `;` or `2>&1`.
import { callOfItsOwn } from "@byronbroughten/spec-runner/callOfItsOwn";

import { ShellParser, type SimpleCommand } from "../ShellParser.ts";
import { timeoutWrappedOf } from "../timeoutWrapped.ts";
import { npmCommands } from "./npmCommands.ts";

// Why a boxed entry is refused: what the box can't do, or for the research push, that the box would free its push.
const boxReasons = {
  cant: {
    google: "can't reach Google",
    agentToken:
      "can't read the gworkspace server's credentials or reach Google",
    claude: "can't launch `claude`",
    ps: "can't run `ps`",
    pgrep: "can't run `pgrep`",
    open: "can't reach Launch Services, which `open` needs",
    jev: "can't run the jev client's fetch",
    claudeFiles: "can't delete a worktree's protected `.claude` files",
    other: "can't run it",
  },
  hiddenProcess:
    "there `ps` can't see the test's own process, so lease and process-liveness tests fail",
  // The box reaches GitHub and frees a call holding no `git push`, so a script's push would go out with no tier row deciding it.
  hiddenPush:
    "where the tier gate can't see its push: the box frees a call that names no `git push`, a runner step's included",
} as const;
// Each is matched against an entry with any `npm run ` dropped, so a bare program's entry is matched whole.
const entryScripts = {
  researchPush: /^research:push\b/,
  wrapUp: /^wrap-up\b/,
  test: /^(test|check)\b/,
} as const;
const substitutionText = /\$\(|`/;
// vitest's subcommands other than `run`: a call naming one first isn't a test run.
const otherVitestSubcommands = new Set([
  "bench",
  "dev",
  "init",
  "list",
  "related",
  "typecheck",
  "watch",
]);
const cantsByScript: [RegExp, string][] = [
  [/^ps\b/, boxReasons.cant.ps],
  [/^pgrep\b/, boxReasons.cant.pgrep],
  [/^open\b/, boxReasons.cant.open],
  [/^(app|dev)\b/, boxReasons.cant.google],
  [/^(google:script|doc:print|piece:pull)\b/, boxReasons.cant.agentToken],
  [/^(runner|session:probe)\b/, boxReasons.cant.claude],
  [/^(issue|wrap-up)\b/, boxReasons.cant.ps],
  [/^jev\b/, boxReasons.cant.jev],
  [/^ws:rm\b/, boxReasons.cant.claudeFiles],
];
// Claude Code's Sandboxing page lists it as no bar to leaving the box, and #535's probe saw it leave.
const stderrToStdout = /(^|[ \t])2>&1(?=[ \t]|$)/gm;
const callJoiners = new Set(["&&", "||", ";"]);

export const excludedCommands = {
  refusalOf(command: string, entries: string[]): string | undefined {
    if (entries.length === 0) return undefined;
    const parser = excludedCommands.boxParserOf(command);
    const commands = parser.parsedCommands;
    if (!commands) return undefined;
    const held = commands.flatMap(({ words }) => {
      const form = vitestFormOf(words) ?? boxFormOf(words);
      const entry = entryOf(form, entries);
      return entry ? [{ form, entry }] : [];
    });
    const [first] = held;
    if (!first || excludedCommands.leavesTheBox(parser, commands, entries)) {
      return undefined;
    }
    const refusal = `\`${command}\` keeps \`${first.form}\` in the sandbox, ${reasonOf(first.entry)}. ${callOfItsOwn(`Run \`${first.form}\``)}`;
    if (
      !entryScripts.wrapUp.test(scriptOf(first.entry)) ||
      !substitutionText.test(command)
    ) {
      return refusal;
    }
    return `${refusal}. A \`$(\` or backtick keeps it in the sandbox even quoted or escaped, so pass the closing note with \`--closing-file <path>\``;
  },

  // Every command in the call matches an entry, read as the refusal reads it but for a vitest run, which the off ask leaves as it was; a heredoc the scan can't confirm as plain text, or `$'…'`, could hide one that doesn't.
  isMadeOf(command: string, entries: string[]): boolean {
    const parser = excludedCommands.boxParserOf(command);
    const commands = parser.parsedCommands;
    if (!commands || !parser.isPlainText) return false;
    return commands.every(
      ({ words }) => entryOf(boxFormOf(words), entries) !== undefined,
    );
  },

  // The call as the box reads it, `2>&1` dropped.
  boxParserOf(command: string): ShellParser {
    return ShellParser.init(command.replace(stderrToStdout, "$1"));
  },

  // The parser has already read the whole call, so its operators can't throw.
  leavesTheBox(
    parser: ShellParser,
    commands: SimpleCommand[],
    entries: string[],
  ): boolean {
    // #594's probe: Claude Code reads `$(` and a backtick in the raw text, quoted or escaped, but a `<<` only as a heredoc.
    if (substitutionText.test(parser.command)) return false;
    if (parser.heredocs?.length !== 0) return false;
    // A reserved word such as `if` or `{` is no operator, so a compound call isn't taken for commands only joined.
    const isJoinedOnly =
      parser.operators.every((operator) => callJoiners.has(operator)) &&
      parser.segments.every(({ isNested }) => !isNested);
    return (
      isJoinedOnly &&
      commands.every(
        ({ words, isBare }) =>
          isBare && entryOf(words.join(" "), entries) !== undefined,
      )
    );
  },
};

function boxFormOf(words: string[]): string {
  return npmCommands.unflaggedFormOf(unwrappedOf(words));
}

// A vitest test run fails in the box as `npm test` does, so it's read as `npm test -- <args>`; undefined for any other command.
function vitestFormOf(words: string[]): string | undefined {
  const run = npmCommands.programRunOf(unwrappedOf(words));
  if (run?.program !== "vitest") return undefined;
  const [first, ...rest] = run.args;
  if (otherVitestSubcommands.has(first ?? "")) return undefined;
  const args = first === "run" ? rest : run.args;
  if (args.length === 0) return "npm test";
  return ["npm", "test", "--", ...args].join(" ");
}

// A timed command keeps the box as its wrapped command does.
function unwrappedOf(words: string[]): string[] {
  return timeoutWrappedOf(words) ?? words;
}

function entryOf(command: string, entries: string[]): string | undefined {
  return entries.find((entry) => matchesEntry(command, entry));
}

// Claude Code's rule matching: `*` matches anything, a space before it included, and a legacy `:*` suffix matches the prefix as a whole word.
function matchesEntry(command: string, entry: string): boolean {
  if (entry.endsWith(":*")) {
    const prefix = entry.slice(0, -2);
    return command === prefix || command.startsWith(`${prefix} `);
  }
  const pattern = entry
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${pattern}$`, "s").test(command);
}

function reasonOf(entry: string): string {
  const script = scriptOf(entry);
  if (entryScripts.researchPush.test(script)) return boxReasons.hiddenPush;
  if (entryScripts.test.test(script)) {
    return failsUnnamedOf(boxReasons.hiddenProcess);
  }
  const cant =
    cantsByScript.find(([pattern]) => pattern.test(script))?.[1] ??
    boxReasons.cant.other;
  return failsUnnamedOf(`the sandbox ${cant}`);
}

function failsUnnamedOf(why: string): string {
  return `where it fails without naming the box: ${why}`;
}

function scriptOf(entry: string): string {
  return entry.replace(/^npm (run )?/, "");
}
