// The commands and assertions the generated /implement-* skills' tests share for the ending interactiveSkill.ts words.
import { expect } from "vitest";

import type { InteractiveSkillCommands } from "./interactiveSkill.ts";

export const endingCommands = {
  promoteCommand: "npm run issue:promote -- <repo> <n>",
  reviewCommand: "npm run runner -- review <owner>/<repo> <n>",
  resolveCommand: "npm run runner -- resolve <owner>/<repo> <n>",
  decideCommand: "npm run runner -- decide <owner>/<repo> <spec> R<n>.<k>",
  wrapUpCommand: "npm run wrap-up -- <repo> <n>",
  closeParentCommand: "npm run issue:close-parent -- <repo> <p>",
  closeProjectPath: ".claude/skills/close-project/SKILL.md",
} as const satisfies InteractiveSkillCommands;

// The parent's announcement before wrap-up and the announced chain's close-out after it, in order.
export const parentCloseOutSteps = [
  "run `npm run issue:close-parent -- <repo> <p>` on it",
  "this ticket is #<p>'s last open sub-issue and names each parent above it that the brief's `## Parent check` chain shows ready to close",
  "The go-ahead to land covers closing out exactly the announced chain.",
  '`npm run wrap-up -- <repo> <n> --closing "<what landed>"',
  "read `.claude/skills/close-project/SKILL.md` by path",
  "stopping at the first gap or refusal",
  "report what it closed and the comment it posted",
  "report it with `/close-project <its repo> <its number>` and close nothing more",
] as const;

export function expectInOrder(skill: string, steps: readonly string[]): void {
  const positions = steps.map((step) => skill.indexOf(step));
  expect(positions).not.toContain(-1);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
}
