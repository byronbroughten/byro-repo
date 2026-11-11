// The /implement-piece skill's text: the piece implement step's drafting lines (implementStep.ts) with an interactive
// opening, a pull the session makes itself, and the generated skills' shared ending in place of the step's record-returning
// one. The committed skill is runner/skills/implement-piece/SKILL.md; byro-repo's drift test regenerates it from byro-repo's commands.

import { stepReadLine } from "../../IssueReader.ts";
import { commitMessageLine, sectionOf } from "../../promptText.ts";
import type { Command } from "../../runKnobs.ts";
import {
  generatedNoteOf,
  implementBody,
  interactiveOpeningOf,
  type InteractiveSkillCommands,
  interactiveSkillOf,
} from "../../stepPrompts.ts";
import { agentDraft } from "./agentDraft.ts";
import { draftingScope } from "./draftingScope.ts";
import {
  commitDraftLineOf,
  draftCommitCommandsOf,
  draftingLinesOf,
  noGitHubWriteLine,
  passagesFolderOf,
} from "./implementStep.ts";
import { pieceChecks } from "./pieceChecks.ts";

export interface ImplementPieceSkillInput extends InteractiveSkillCommands {
  overlapCommand: Command;
  // Takes the Doc's ID last.
  docPrintCommand: string;
}

const placeholders = {
  draftPath: agentDraft.pathOf("<spec n>"),
  specRepo: "<spec repo>",
  passagesFolder: passagesFolderOf({ repo: "<repo>", number: "<n>" }),
} as const;

export function implementPieceSkillOf({
  promoteCommand,
  overlapCommand,
  docPrintCommand,
  ...ending
}: ImplementPieceSkillInput): string {
  const { specRepo, passagesFolder } = placeholders;
  const overlapRun = pieceChecks.overlapRunOf({
    overlapCommand,
    specRepo,
    passagesFolder,
  });
  return interactiveSkillOf({
    ...ending,
    body: [
      frontmatter,
      "`/implement-piece <repo> <n>` drafts one piece ticket in an interactive session, from the same lines as the spec runner's implement step; only the pull and the ending differ. `<spec repo>` and `<spec n>` are the ticket's parent, or the ticket itself when it has none.",
      interactiveOpeningOf({
        promoteCommand,
        ticketKindLine:
          "A `research` ticket: read `.claude/skills/research-piece/SKILL.md` and follow it on the same issue instead; it is user-invoked, so the Skill tool can't reach it.",
      }),
      pullSection(docPrintCommand),
      draftingSection(),
      workingSection(),
      checksSection(),
      sectionOf("GitHub", [noGitHubWriteLine, stepReadLine]),
    ].join("\n\n"),
    checkCommand: overlapRun,
  });
}

const frontmatter = `---
name: implement-piece
description: "Draft one piece ticket into its Agent draft in its issue workspace, review it with the spec runner, report, and land it with wrap-up once the developer says go. Invoked as /implement-piece <repo> <n>."
argument-hint: "<repo> <n>"
disable-model-invocation: true
---

${generatedNoteOf({
  sourcePath: "runner/src/Workflow/piece/implementPieceSkill.ts",
  testPath: "scripts/runner/implementPieceSkill.test.ts",
})}`;

// A run's pull is a runner Step, with no command a session can call, so the session follows the same rules.
function pullSection(docPrintCommand: string): string {
  return sectionOf("Pull the Deliverable first", [
    `Read the Doc the spec's \`## Deliverable\` section names with \`${docPrintCommand} <the Deliverable's ID>\`, and bring it into the Agent draft by \`docs/pieces/agent-draft.md\`'s Pull rules, skipping its run-state baseline.`,
    `Commit the Agent draft on the ticket's branch before drafting, as its own commit, and commit nothing when the file already matched: ${draftCommitCommandsOf(placeholders.draftPath)}.`,
  ]);
}

function draftingSection(): string {
  const { draftPath, specRepo, passagesFolder } = placeholders;
  return sectionOf("What you draft", [
    ...draftingLinesOf({
      draftPath,
      specRepo,
      specRef: `${specRepo}#<spec n>`,
      sections: draftingScope.sectionsOfAnyTicket,
      passagesFolder,
      pulled: "Your pull brought the Deliverable's Doc into it.",
    }),
    commitDraftLineOf({ draftPath, specRepo }),
  ]);
}

function workingSection(): string {
  return sectionOf("How you work", [
    implementBody.oneCommand,
    commitMessageLine,
  ]);
}

function checksSection(): string {
  return sectionOf("The piece checks", [
    pieceChecks.overlapFixLineOf(
      `the overlap check prints in ${draftingScope.sectionsOfAnyTicket}, unless review dismissed it`,
    ),
    `On a \`final-pass\` ticket, or when this ticket's Sections are every Section of the Agent draft, also ${draftingScope.lengthRuleClause}`,
  ]);
}
