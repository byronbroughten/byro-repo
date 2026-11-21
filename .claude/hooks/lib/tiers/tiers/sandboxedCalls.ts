// Whether the sandbox alone may free a call: one it runs, holding no `gh` or `git push`, since the box lets GitHub in and nothing undoes a GitHub write (R537.1 on #519), and no live-spreadsheet call whose row asks or refuses.
// It reads words, not command position, so a reserved word, wrapper or `xargs` before `gh` can't hide it; a call it can't read gets the tier rows.
import type { SimpleCommand } from "../ShellParser.ts";
import type { CommandVerdict } from "../tiers.ts";
import { timeoutUnwrappedOf } from "../timeoutWrapped.ts";
import { excludedCommands } from "./excludedCommands.ts";
import { gitWrites } from "./gitWrites.ts";
import { interactiveScripts } from "./interactiveScripts.ts";
import { npmCommands } from "./npmCommands.ts";
import { liveFlags, npmVerdicts } from "./npmVerdicts.ts";

// Shell punctuation a quoted word may hold, and the brace expansion bash would run as `gh`, as in `{gh,x}`.
const tokenBreaks = /[\s;&|()`{},]+/;

const boxBounds =
  "the sandbox, which keeps writes in the workspaces, the git folders, temp and the gworkspace attachments folder and hides the credential files";

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

  // A command whose own row decides it in the box, as the box frees the rest.
  keepsItsRow(commandVerdict: CommandVerdict): boolean {
    return (
      sandboxedCalls.holdsGitHubCall(commandVerdict.words) ||
      keepsLiveRow(commandVerdict)
    );
  },

  // A quoted word is split too, so `sh -c 'gh …'` counts.
  holdsGitHubCall(words: string[]): boolean {
    const tokens = tokensOf(words).map((token) =>
      token.replace(/^.*\/(?=(gh|git)$)/, ""),
    );
    if (interactiveScripts.countsAsGitHubCall(words)) return true;
    return tokens.some(
      (token, at) =>
        token === "gh" ||
        (token === "git" && gitWrites.isPushOf(tokens.slice(at))),
    );
  },

  reasonOf(command: string): string {
    return `\`${command}\` runs in ${boxBounds}, and it holds no \`gh\`, \`git push\` or live-spreadsheet call whose row asks or refuses.`;
  },

  restReasonOf(command: string): string {
    return `The rest of \`${command}\` runs in ${boxBounds}.`;
  },
};

// A live call the rows read keeps an ask or refusal; one behind a wrapper they can't read, such as `sh -c`, isn't freed when it holds a live flag, as `gh` isn't.
function keepsLiveRow({ words, verdict }: CommandVerdict): boolean {
  const runWords = timeoutUnwrappedOf(words);
  if (
    npmCommands.liveAliasOf(runWords) ||
    npmVerdicts.namesNoTarget(runWords)
  ) {
    return verdict !== undefined && verdict.permissionDecision !== "allow";
  }
  const tokens = tokensOf(words);
  return (
    tokens.some(npmCommands.isLiveAliasName) &&
    Object.values(liveFlags).some((flag) => npmCommands.holdsFlag(tokens, flag))
  );
}

function tokensOf(words: string[]): string[] {
  return words.flatMap((word) =>
    word.split(tokenBreaks).filter((token) => token !== ""),
  );
}
