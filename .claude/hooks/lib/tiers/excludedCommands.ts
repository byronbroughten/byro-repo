// The settings' `excludedCommands`, and the refusal of a call that holds one but stays in the sandbox, where it fails without naming the box.
// Claude Code lets a call out only when every command in it matches an entry, with nothing beside them but `&&`, `||`, `;` or `2>&1`.
import { ShellParser, type SimpleCommand } from "./ShellParser.ts";
import { npmCommands } from "./tiers/npmCommands.ts";

const sandboxCant = {
  google: "can't reach Google",
  claude: "can't launch `claude`",
  ps: "can't run `ps`",
  jev: "can't run the jev client's fetch",
  other: "can't run it",
} as const;
const reasonsByScript: [RegExp, string][] = [
  [/^(app|dev)\b/, sandboxCant.google],
  [/^(runner|session:probe)\b/, sandboxCant.claude],
  [/^(test|check|issue|wrap-up)\b/, sandboxCant.ps],
  [/^jev\b/, sandboxCant.jev],
];
// Claude Code's Sandboxing page lists it as no bar to leaving the box, and #535's probe saw it leave.
const stderrToStdout = /(^|[ \t])2>&1(?=[ \t]|$)/gm;
const callJoiners = new Set(["&&", "||", ";"]);

export const excludedCommands = {
  // None when the sandbox is off or the settings are unreadable.
  entriesOf(settings: unknown): string[] {
    const sandbox = (settings as { sandbox?: unknown } | undefined)?.sandbox;
    if (!sandbox || typeof sandbox !== "object") return [];
    const { enabled, excludedCommands: entries } = sandbox as {
      enabled?: unknown;
      excludedCommands?: unknown;
    };
    if (enabled !== true || !Array.isArray(entries)) return [];
    return entries.filter((entry) => typeof entry === "string");
  },
  refusalOf(command: string, entries: string[]): string | undefined {
    if (entries.length === 0) return undefined;
    const parser = ShellParser.init(command.replace(stderrToStdout, "$1"));
    const commands = parser.parsedCommands;
    if (!commands) return undefined;
    const held = commands.flatMap((simple) => {
      const form = npmCommands.unflaggedFormOf(simple.words);
      const entry = entries.find((pattern) => matchesEntry(form, pattern));
      return entry ? [{ form, entry }] : [];
    });
    const [first] = held;
    if (!first || leavesTheBox(parser, commands, entries)) return undefined;
    return `\`${command}\` keeps \`${first.form}\` in the sandbox, where it fails without naming the box: the sandbox ${reasonOf(first.entry)}. ${excludedCommands.callOfItsOwn(`Run \`${first.form}\``)}`;
  },
  // The way out of the box, for every message that names it.
  callOfItsOwn(instruction: string): string {
    return `${instruction} in a call of its own, with no pipe, \`cd\`, \`$(…)\`, redirect other than \`2>&1\`, heredoc, flag before the script name, env prefix or other command beside it`;
  },
};

// The parser has already read the whole call, so its operators can't throw.
function leavesTheBox(
  parser: ShellParser,
  commands: SimpleCommand[],
  entries: string[],
): boolean {
  if (/\$\(|`|<</.test(parser.command)) return false;
  const isJoinedOnly = parser.operators.every((operator) =>
    callJoiners.has(operator),
  );
  return (
    isJoinedOnly &&
    commands.every(
      ({ words, isBare }) =>
        isBare && entries.some((entry) => matchesEntry(words.join(" "), entry)),
    )
  );
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
  return reason?.[1] ?? sandboxCant.other;
}
