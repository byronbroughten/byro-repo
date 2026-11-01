// GitHub's closing keywords before an issue reference, which commitMsg.ts refuses: a ticket closes only through the runner or /judge-findings.

export interface ClosingPhrase {
  phrase: string;
  // The `#n` or `owner/repo#n` the phrase would close.
  reference: string;
}

// Git drops a verbose commit's diff from this line down.
const scissorsLine = "# ------------------------ >8 ------------------------";

const closingPhrase =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)(?::\s*|\s+)((?:[\w.-]+\/[\w.-]+)?#\d+)/gi;

// `#` lines are checked too: `git commit -m` and a custom comment character keep them in the message.
export function closingPhrasesOf(message: string): ClosingPhrase[] {
  return [...messageTextOf(message).matchAll(closingPhrase)].map(
    ([phrase, reference]) => ({ phrase, reference: reference ?? "" }),
  );
}

export function refusalOf([first, ...rest]: [
  ClosingPhrase,
  ...ClosingPhrase[],
]): string {
  const quoted = [first, ...rest]
    .map(({ phrase }) => `"${phrase}"`)
    .join(" and ");
  const issues = rest.length > 0 ? "their issues" : "its issue";
  return `commit-msg: ${quoted} would close ${issues} once the commit reaches the default branch, and only the runner or /judge-findings closes a ticket. Reword it, for example "review of ${first.reference}" or "for ${first.reference}", and commit again.`;
}

function messageTextOf(message: string): string {
  const scissorsAt = message.indexOf(scissorsLine);
  if (scissorsAt === -1) return message;
  return message.slice(0, scissorsAt);
}
