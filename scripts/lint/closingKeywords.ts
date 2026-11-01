// GitHub's closing keywords before an issue reference, which commitMsg.ts refuses: a ticket closes only through the runner or /judge-findings.

// Git drops a verbose commit's diff from this line down, and every `#` line above it.
const scissorsLine = "# ------------------------ >8 ------------------------";

const closingPhrase =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)(?::\s*|\s+)((?:[\w.-]+\/[\w.-]+)?#\d+)/gi;

export function closingPhrasesOf(message: string): string[] {
  return [...messageTextOf(message).matchAll(closingPhrase)].map(
    ([phrase]) => phrase,
  );
}

export function refusalOf(phrases: [string, ...string[]]): string {
  const quoted = phrases.map((phrase) => `"${phrase}"`).join(" and ");
  const reference = referenceOf(phrases[0]);
  const issues = phrases.length > 1 ? "their issues" : "its issue";
  return `commit-msg: ${quoted} would close ${issues} once the commit reaches the default branch, and only the runner or /judge-findings closes a ticket. Reword it, for example "review of ${reference}" or "for ${reference}", and commit again.`;
}

function messageTextOf(message: string): string {
  const scissorsAt = message.indexOf(scissorsLine);
  const kept = scissorsAt === -1 ? message : message.slice(0, scissorsAt);
  return kept
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n");
}

function referenceOf(phrase: string): string {
  return phrase.replace(new RegExp(closingPhrase.source, "i"), "$1");
}
