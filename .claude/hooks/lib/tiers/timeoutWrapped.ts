// The command a `timeout` call wraps, for the tier rows and the excluded-command refusal, which both decide on that command.

// The duration and the timeout's own flags dropped, or undefined when the words aren't a timeout.
export function timeoutWrappedOf(words: string[]): string[] | undefined {
  if (words[0] !== "timeout") return undefined;
  let at = 1;
  while ((words[at] ?? "").startsWith("-")) {
    if (["-s", "-k", "--signal", "--kill-after"].includes(words[at] ?? "")) {
      at++;
    }
    at++;
  }
  const wrapped = words.slice(at + 1);
  return wrapped.length > 0 ? wrapped : undefined;
}
