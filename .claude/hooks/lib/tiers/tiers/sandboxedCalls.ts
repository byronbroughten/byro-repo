// Whether the sandbox alone may free a call: one it runs, holding no `gh` or `git push`, since the box lets GitHub in and nothing undoes a GitHub write (R537.1 on #519).
// It reads words, not command position, so a reserved word, wrapper or `xargs` before `gh` can't hide it; a call it can't read gets the tier rows.
import { excludedCommands } from "./excludedCommands.ts";
import { GitCall } from "./GitCall.ts";

// Shell punctuation a quoted word may hold, and the brace expansion bash would run as `gh`, as in `{gh,x}`.
const tokenBreaks = /[\s;&|()`{},]+/;

export const sandboxedCalls = {
  // A heredoc the scan can't confirm as plain text, or `$'…'`, could hide either from the parse.
  isFree(command: string, entries: string[]): boolean {
    const parser = excludedCommands.boxParserOf(command);
    const commands = parser.parsedCommands;
    if (!commands || !parser.isPlainText) return false;
    if (excludedCommands.leavesTheBox(parser, commands, entries)) return false;
    return !commands.some(({ words }) => holdsGitHubCall(words));
  },

  reasonOf(command: string): string {
    return `\`${command}\` runs in the sandbox, which keeps its writes in the workspaces, the git folders and temp and hides the credential files, and it holds no \`gh\` or \`git push\`.`;
  },
};

// A quoted word is split too, so `sh -c 'gh …'` counts.
function holdsGitHubCall(words: string[]): boolean {
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
}
