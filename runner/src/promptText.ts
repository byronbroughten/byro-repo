// Wording shared by the agent-step prompts.

// The implement and resolve steps' write scope; the why is in byro-repo's docs/claude-code-guardrails.md.
export const stepWriteLine =
  "You may do what the tier list allows in your workspace. `node` runs only scratch helpers, in `$TMPDIR` or a gitignored folder; a script being built runs through its tests or its `npm run` alias. Use `git -C <dir>` rather than `cd <dir> && git`. When a write is denied, record one `denied-tool` blocker instead of trying a workaround.";

export function codeListOf(words: readonly string[]): string {
  const quoted = words.map((word) => `\`${word}\``);
  if (quoted.length < 2) return quoted.join("");
  return `${quoted.slice(0, -1).join(", ")} or ${quoted.at(-1)}`;
}

export function sectionOf(heading: string, bullets: string[]): string {
  return `## ${heading}\n\n${bullets.map((bullet) => `- ${bullet}`).join("\n")}`;
}
