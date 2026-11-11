// The /implement-code skill's text: the implement step's shared body (stepPrompts/implementText.ts) with an interactive opening and
// the generated skills' shared ending in place of the step's record-returning one. The committed skill is
// runner/skills/implement-code/SKILL.md; byro-repo's drift test regenerates it from byro-repo's commands.

import { stepReadLine } from "../../IssueReader.ts";
import { sectionOf } from "../../promptText.ts";
import {
  implementBody,
  ticketBindsSection,
} from "../../stepPrompts/implementText.ts";
import {
  generatedNoteOf,
  interactiveOpeningOf,
  type InteractiveSkillCommands,
  interactiveSkillOf,
} from "../../stepPrompts/interactiveSkill.ts";

export type ImplementCodeSkillInput = InteractiveSkillCommands;

export function implementCodeSkillOf({
  promoteCommand,
  ...ending
}: ImplementCodeSkillInput): string {
  return interactiveSkillOf({
    ...ending,
    driftLine: implementBody.drift,
    onlyWritesLine: `${implementBody.onlyWrites}.`,
    body: [
      frontmatter,
      "`/implement-code <repo> <n>` implements one ticket in an interactive session, from the same body as the spec runner's implement step; only the ending differs.",
      interactiveOpeningOf({
        promoteCommand,
        ticketKindLine:
          "A `ready-for-interactive` ticket is an Interactive ticket: implement it here, since its work needs the developer's yes, which this session can ask for.",
      }),
      workingSection(),
      ticketBindsSection(),
      gitHubSection(),
    ].join("\n\n"),
    checkCommand: "npm run check",
  });
}

const frontmatter = `---
name: implement-code
description: "Implement one code ticket in its issue workspace, review it with the spec runner, report, and land it with wrap-up once the developer says go. Invoked as /implement-code <repo> <n>."
disable-model-invocation: true
---

${generatedNoteOf({
  sourcePath: "runner/src/Workflow/code/implementCodeSkill.ts",
  testPath: "scripts/runner/implementCodeSkill.test.ts",
})}`;

function workingSection(): string {
  return sectionOf("How you work", [
    implementBody.testFirst,
    implementBody.checking,
    implementBody.oneCommand,
  ]);
}

function gitHubSection(): string {
  return sectionOf("GitHub", [implementBody.gitHubWrites, stepReadLine]);
}
