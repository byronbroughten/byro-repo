// The refusal of a call that holds an `excludedCommands` entry but stays in the sandbox, where it fails without naming the box or, for the research push, pushes past the tier gate.
// Claude Code lets a call out only when every command in it matches an entry, with nothing beside them but `&&`, `||`, `;` or `2>&1`.
import { callOfItsOwn } from "@byronbroughten/spec-runner/callOfItsOwn";

import { ShellParser, type SimpleCommand } from "../ShellParser.ts";
import { timeoutWrappedOf } from "../timeoutWrapped.ts";
import { npmCommands } from "./npmCommands.ts";

const sandboxCant = {
  google: "can't reach Google",
  claude: "can't launch `claude`",
  ps: "can't run `ps`",
  pgrep: "can't run `pgrep`",
  open: "can't reach Launch Services, which `open` needs",
  jev: "can't run the jev client's fetch",
  other: "can't run it",
} as const;
// The box reaches GitHub and frees a call holding no `git push`, so a script's push would go out with no tier row deciding it.
const hiddenPushReason =
  "where the tier gate can't see its push: the box frees a call that names no `git push`, a runner step's included";
// Matched against an entry with any `npm run ` dropped, so a bare program's entry is matched whole.
const reasonsByScript: [RegExp, string][] = [
  [/^ps\b/, boxFailureOf(sandboxCant.ps)],
  [/^pgrep\b/, boxFailureOf(sandboxCant.pgrep)],
  [/^open\b/, boxFailureOf(sandboxCant.open)],
  [/^(app|dev)\b/, boxFailureOf(sandboxCant.google)],
  [/^(runner|session:probe)\b/, boxFailureOf(sandboxCant.claude)],
  [/^(test|check|issue|wrap-up)\b/, boxFailureOf(sandboxCant.ps)],
  [/^jev\b/, boxFailureOf(sandboxCant.jev)],
  [/^research:push\b/, hiddenPushReason],
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
      const form = boxFormOf(words);
      const entry = entryOf(form, entries);
      return entry ? [{ form, entry }] : [];
    });
    const [first] = held;
    if (!first || excludedCommands.leavesTheBox(parser, commands, entries)) {
      return undefined;
    }
    return `\`${command}\` keeps \`${first.form}\` in the sandbox, ${reasonOf(first.entry)}. ${callOfItsOwn(`Run \`${first.form}\``)}`;
  },

  // Every command in the call matches an entry, read as the refusal reads it; a heredoc the scan can't confirm as plain text, or `$'…'`, could hide one that doesn't.
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
    if (/\$\(|`|<</.test(parser.command)) return false;
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

// A timed command keeps the box as its wrapped command does.
function boxFormOf(words: string[]): string {
  return npmCommands.unflaggedFormOf(timeoutWrappedOf(words) ?? words);
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
  const script = entry.replace(/^npm (run )?/, "");
  const reason = reasonsByScript.find(([pattern]) => pattern.test(script));
  return reason?.[1] ?? boxFailureOf(sandboxCant.other);
}

function boxFailureOf(cant: string): string {
  return `where it fails without naming the box: the sandbox ${cant}`;
}
