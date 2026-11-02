// Whether the sandbox alone may free a call: one it runs, holding no `gh` or `git push`, since the box lets GitHub in and nothing undoes a GitHub write (R537.1 on #519).
// It reads words, not command position, so a reserved word, wrapper or `xargs` before `gh` can't hide it; a call it can't read gets today's rows.
import { ShellParser } from "../ShellParser.ts";
import { excludedCommands } from "./excludedCommands.ts";
import { GitCall } from "./GitCall.ts";

export const sandboxedCalls = {
  isFree(command: string, entries: string[]): boolean {
    if (excludedCommands.leavesTheBox(command, entries)) return false;
    return !reachesGitHub(command);
  },

  reasonOf(command: string): string {
    return `\`${command}\` runs in the sandbox, which keeps its writes in the workspaces, the git folders and temp and hides the credential files, and it holds no \`gh\` or \`git push\`.`;
  },
};

// A heredoc the scan can't confirm as plain text, or `$'…'`, could hide either from the parser.
function reachesGitHub(command: string): boolean {
  const parser = ShellParser.init(command);
  const commands = parser.parsedCommands;
  if (!commands) return true;
  if (/\$'/.test(command)) return true;
  if (/<</.test(command)) {
    const { heredocs } = parser;
    if (!heredocs?.every(({ isQuoted }) => isQuoted)) return true;
  }
  return commands.some(({ words }) => holdsGitHubCall(words));
}

// A quoted word is split too, so `sh -c 'gh …'` counts.
function holdsGitHubCall(words: string[]): boolean {
  const tokens = words.flatMap((word) =>
    word
      .split(/[\s;&|()`]+/)
      .map((token) => token.replace(/^.*\/(?=(gh|git)$)/, "")),
  );
  return tokens.some(
    (token, at) =>
      token === "gh" ||
      (token === "git" && GitCall.init(tokens.slice(at))?.verb === "push"),
  );
}
