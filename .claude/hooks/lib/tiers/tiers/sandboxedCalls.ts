// Whether the sandbox alone may free a call: one it runs, holding no `gh` or `git push`, since the box lets GitHub in and nothing undoes a GitHub write (R537.1 on #519).
// In a call it runs that holds either, only those commands keep their rows; the box bounds the rest as it bounds a sandboxed call.
// It reads words, not command position, so a reserved word, wrapper or `xargs` before `gh` can't hide it; a call it can't read gets the tier rows.
import { excludedCommands } from "./excludedCommands.ts";
import { GitCall } from "./GitCall.ts";

// Shell punctuation a quoted word may hold, and the brace expansion bash would run as `gh`, as in `{gh,x}`.
const tokenBreaks = /[\s;&|()`{},]+/;

const boxBounds =
  "the sandbox, which keeps writes in the workspaces, the git folders and temp and hides the credential files";

export const sandboxedCalls = {
  // A heredoc the scan can't confirm as plain text, or `$'…'`, could hide either from the parse.
  runsInBox(command: string, entries: string[]): boolean {
    const parser = excludedCommands.boxParserOf(command);
    const commands = parser.parsedCommands;
    if (!commands || !parser.isPlainText) return false;
    return !excludedCommands.leavesTheBox(parser, commands, entries);
  },

  isFree(command: string, entries: string[]): boolean {
    const commands = excludedCommands.boxParserOf(command).parsedCommands;
    return (
      sandboxedCalls.runsInBox(command, entries) &&
      commands?.some(({ words }) => sandboxedCalls.holdsGitHubCall(words)) ===
        false
    );
  },

  // A quoted word is split too, so `sh -c 'gh …'` counts.
  holdsGitHubCall(words: string[]): boolean {
    const tokens = words.flatMap((word) =>
      word
        .split(tokenBreaks)
        .filter((token) => token !== "")
        .map((token) => token.replace(/^.*\/(?=(gh|git)$)/, "")),
    );
    return tokens.some(
      (token, at) =>
        token === "gh" ||
        (token === "git" && GitCall.init(tokens.slice(at))?.verb === "push"),
    );
  },

  reasonOf(command: string): string {
    return `\`${command}\` runs in ${boxBounds}, and it holds no \`gh\` or \`git push\`.`;
  },

  othersReasonOf(command: string): string {
    return `The rest of \`${command}\` runs in ${boxBounds}.`;
  },
};
