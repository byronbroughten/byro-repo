// The /implement-piece skill's text: the piece implement step's drafting lines (implementStep.ts) with an interactive
// opening from `piece:pull`'s committed draft and printed headings, and the generated skills' shared ending in place of
// the step's record-returning one. The committed skill is runner/skills/implement-piece/SKILL.md; byro-repo's drift test regenerates it from byro-repo's commands.

import { callOfItsOwn } from "../../callOfItsOwn.ts";
import { stepReadLine } from "../../IssueReader.ts";
import { commitMessageLine, sectionOf } from "../../promptText.ts";
import type { Command } from "../../runKnobs.ts";
import { implementBody } from "../../stepPrompts/implementText.ts";
import {
  generatedNoteOf,
  interactiveOpeningOf,
  type InteractiveSkillCommands,
  interactiveSkillOf,
} from "../../stepPrompts/interactiveSkill.ts";
import { agentDraft } from "./agentDraft.ts";
import { draftingScope } from "./draftingScope.ts";
import {
  commitDraftLineOf,
  draftingLinesOf,
  noGitHubWriteLine,
  passagesFolderOf,
} from "./implementStep.ts";
import { pieceChecks } from "./pieceChecks.ts";

export interface ImplementPieceSkillInput extends InteractiveSkillCommands {
  overlapCommand: Command;
  // Written with `<repo>` and `<n>` placeholders.
  piecePullCommand: string;
}

// The ending's lines in place of the code skill's, which allow editing docs and the ticket's GitHub writes.
const driftLine =
  "Before review, grep the docs for every name, command or behavior your draft makes untrue, and name each in your report; never edit one.";
const onlyWritesLine =
  "Those commits are your only writes outside the workspace's files, and you make no GitHub write: never push, merge, rebase or reset.";

const placeholders = {
  draftPath: agentDraft.pathOf("<spec n>"),
  specRepo: "<spec repo>",
  specNumber: "<spec n>",
  passagesFolder: passagesFolderOf({ repo: "<repo>", number: "<n>" }),
} as const;

export function implementPieceSkillOf({
  promoteCommand,
  overlapCommand,
  piecePullCommand,
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
    driftLine,
    onlyWritesLine,
    body: [
      frontmatter,
      "`/implement-piece <repo> <n>` drafts one piece ticket in an interactive session, from the same lines as the spec runner's implement step; only the opening from `piece:pull`'s output and the ending differ. `<spec repo>` and `<spec n>` are the ticket's parent, or the ticket itself when it has none.",
      interactiveOpeningOf({
        promoteCommand,
        ticketKindLine:
          "A `research` ticket: read `.claude/skills/research-piece/SKILL.md` and follow it on the same issue instead; it is user-invoked, so the Skill tool can't reach it.",
      }),
      pulledDraftSection(piecePullCommand),
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

// piece:pull runs the run's pull Step into the workspace, so its output stands in for reading the Doc or the whole draft.
function pulledDraftSection(piecePullCommand: string): string {
  return sectionOf("Open from the pulled draft", [
    `When \`/start-issue\` ran \`${piecePullCommand}\`, it committed the Agent draft on the ticket's branch and printed the Deliverable's ID and the draft's Sections by heading path.`,
    `A session that reached this skill without \`/start-issue\`, or holds no such output, ${callOfItsOwn(`runs \`${piecePullCommand}\` first`)}.`,
    "Read only the Sections you draft, and an earlier Section you open for what leads into them, each by its printed heading path; never read the whole Agent draft or the Deliverable's Doc.",
    "What you draft reaches the Doc only through the run's push at the end of the spec, never from this session; push checks it against the Doc as the run's last pull saw it.",
  ]);
}

function draftingSection(): string {
  const { draftPath, specRepo, specNumber, passagesFolder } = placeholders;
  return sectionOf("What you draft", [
    ...draftingLinesOf({
      draftPath,
      specRepo,
      specNumber,
      specRef: `${specRepo}#${specNumber}`,
      sections: draftingScope.sectionsOfAnyTicket,
      passagesFolder,
      pulled:
        "`piece:pull` brought the Deliverable's Doc into it and committed it on the ticket's branch.",
    }),
    commitDraftLineOf({ draftPath, specRepo, specNumber }),
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
