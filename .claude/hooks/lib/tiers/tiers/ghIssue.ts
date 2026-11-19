// Reads a `gh issue` command's subcommand past the flags gh accepts before it, so no classifier takes a leading `-R <owner>/<repo>` for the verb.
export interface GhIssueCall {
  verb: string;
  // The words after the verb.
  args: string[];
}

// The persistent flags of `gh issue` that take their value as the next word; spelled `-R=x`, `-Rx` or `--repo=x`, the value rides in the flag's own word.
const valueFlags = new Set(["-R", "--repo"]);

export const ghIssue = {
  // Undefined for any command that isn't `gh issue <verb>`, or whose flags leave no verb.
  callOf(words: string[]): GhIssueCall | undefined {
    const [program, noun, ...rest] = words;
    if (program !== "gh" || noun !== "issue") return undefined;
    let at = 0;
    while (rest[at]?.startsWith("-")) {
      at += valueFlags.has(rest[at] ?? "") ? 2 : 1;
    }
    const verb = rest[at];
    if (verb === undefined) return undefined;
    return { verb, args: rest.slice(at + 1) };
  },
};
