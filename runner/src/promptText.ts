// Wording shared by the agent-step prompts.

export function codeListOf(words: readonly string[]): string {
  const quoted = words.map((word) => `\`${word}\``);
  if (quoted.length < 2) return quoted.join("");
  return `${quoted.slice(0, -1).join(", ")} or ${quoted.at(-1)}`;
}

export function sectionOf(heading: string, bullets: string[]): string {
  return `## ${heading}\n\n${bullets.map((bullet) => `- ${bullet}`).join("\n")}`;
}
