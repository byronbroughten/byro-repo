// The settings' `excludedCommands`, and the refusal of a call that holds one but stays in the sandbox, where it fails without naming the box.
// Claude Code lets a call out only when every command in it matches an entry, with nothing beside them but `&&`, `||`, `;` or `2>&1`.
import { ShellParser, type SimpleCommand } from "./ShellParser.ts";

const sandboxCant = {
  google: "can't reach Google",
  claude: "can't launch `claude`",
  ps: "can't run `ps`",
  jev: "can't run the jev client's fetch",
  other: "can't run it",
} as const;
// The reason an entry runs outside the box, by the npm script it names; an entry with none gets `other`.
const reasonsByScript: [RegExp, string][] = [
  [/^(app|dev)\b/, sandboxCant.google],
  [/^(runner|session:probe)\b/, sandboxCant.claude],
  [/^(test|check|issue|wrap-up)\b/, sandboxCant.ps],
  [/^jev\b/, sandboxCant.jev],
];
// npm options that take the next word as their value.
const npmValueFlags = new Set([
  "--prefix",
  "-C",
  "-w",
  "--workspace",
  "--loglevel",
  "--userconfig",
  "--cache",
  "--registry",
  "--script-shell",
]);
const npmVerbs = new Map([
  ["run", "run"],
  ["run-script", "run"],
  ["test", "test"],
  ["t", "test"],
  ["tst", "test"],
]);
// Claude Code's Sandboxing page lists it as no bar to leaving the box, and #535's probe saw it leave.
const stderrToStdout = /(^|[ \t])2>&1(?=[ \t]|$)/gm;
const callJoiners = new Set(["&&", "||", ";"]);

export const excludedCommands = {
  // The entries of a settings file whose sandbox is on; none when it's off or unreadable.
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
  // The refusal's sentence for a call holding an excluded command the box keeps in, mixed or spelled as a variant; undefined for any other call.
  refusalOf(command: string, entries: string[]): string | undefined {
    if (entries.length === 0) return undefined;
    const call = command.replace(stderrToStdout, "$1");
    const commands = substitutedCommandsOf(call);
    if (!commands) return undefined;
    const held = commands.flatMap((simple) => {
      const form = sandboxFormOf(simple.words);
      const entry = entries.find((pattern) => matchesEntry(form, pattern));
      return entry ? [{ form, entry }] : [];
    });
    const [first] = held;
    if (!first || leavesTheBox(call, commands, entries)) return undefined;
    return `\`${command}\` keeps \`${first.form}\` in the sandbox, where it fails without naming the box: the sandbox ${reasonOf(first.entry)}. Run \`${first.form}\` in a call of its own, with no pipe, \`cd\`, \`$(…)\`, redirect other than \`2>&1\`, heredoc, flag before the script name, env prefix or other command beside it`;
  },
};

function substitutedCommandsOf(command: string): SimpleCommand[] | undefined {
  try {
    return ShellParser.init(command).substitutedCommands;
  } catch {
    return undefined;
  }
}

// Every command bare and matching an entry as written, joined only by `&&`, `||` or `;`.
function leavesTheBox(
  call: string,
  commands: SimpleCommand[],
  entries: string[],
): boolean {
  if (/\$\(|`|<</.test(call)) return false;
  const isJoinedOnly = ShellParser.init(call).operators.every((operator) =>
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

// The words as an excluded entry spells them: npm's flags before the script name dropped and its verb's alias named in full; the parser has already dropped an env prefix.
function sandboxFormOf(words: string[]): string {
  if (words[0] !== "npm") return words.join(" ");
  const verbAt = afterFlagsOf(words, 1);
  const verb = npmVerbs.get(words[verbAt] ?? "");
  if (verb === undefined) return words.join(" ");
  if (verb === "test") {
    return ["npm", "test", ...words.slice(verbAt + 1)].join(" ");
  }
  const scriptAt = afterFlagsOf(words, verbAt + 1);
  return ["npm", "run", ...words.slice(scriptAt)].join(" ");
}

// The index of the first word from `at` that is neither an npm flag nor a flag's value.
function afterFlagsOf(words: string[], at: number): number {
  let index = at;
  while ((words[index] ?? "").startsWith("-") && words[index] !== "--") {
    index += npmValueFlags.has(words[index] ?? "") ? 2 : 1;
  }
  return index;
}

function reasonOf(entry: string): string {
  const script = entry.replace(/^npm (run )?/, "");
  const reason = reasonsByScript.find(([pattern]) => pattern.test(script));
  return reason?.[1] ?? sandboxCant.other;
}
