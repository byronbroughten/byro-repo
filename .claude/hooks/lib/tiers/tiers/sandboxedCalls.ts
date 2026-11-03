// Whether the sandbox alone may free a call: one it runs, holding no `gh` or `git push`, since the box lets GitHub in and nothing undoes a GitHub write (R537.1 on #519).
// It reads words, not command position, so a reserved word, wrapper or `xargs` before `gh` can't hide it; a call it can't read gets the tier rows.
import type { SimpleCommand } from "../ShellParser.ts";
import { excludedCommands } from "./excludedCommands.ts";
import { gitWrites } from "./gitWrites.ts";

// Shell punctuation a quoted word may hold, and the brace expansion bash would run as `gh`, as in `{gh,x}`.
const tokenBreaks = /[\s;&|()`{},]+/;

const boxBounds =
  "the sandbox, which keeps writes in the workspaces, the git folders and temp and hides the credential files";

export const sandboxedCalls = {
  // The call's commands as the box reads them, undefined when it doesn't run them all; a heredoc the scan can't confirm as plain text, or `$'…'`, could hide one from the parse.
  boxCommandsOf(
    command: string,
    entries: string[],
  ): SimpleCommand[] | undefined {
    const parser = excludedCommands.boxParserOf(command);
    const commands = parser.parsedCommands;
    if (!commands || !parser.isPlainText) return undefined;
    if (excludedCommands.leavesTheBox(parser, commands, entries)) {
      return undefined;
    }
    return commands;
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
        (token === "git" && gitWrites.isPushOf(tokens.slice(at))),
    );
  },

  reasonOf(command: string): string {
    return `\`${command}\` runs in ${boxBounds}, and it holds no \`gh\` or \`git push\`.`;
  },

  restReasonOf(command: string): string {
    return `The rest of \`${command}\` runs in ${boxBounds}.`;
  },
};
