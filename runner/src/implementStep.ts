// The implement step: the prompt the runner sends, a non-interactive fork of upstream `implement`
// recorded in byro-repo's .claude/skills/upstream.json, and the implement record it returns.
// AgentStep.ts launches the step; StepStream.ts checks the record against implementRecordSchema.

import type { IssueRef } from "./IssueWorkspaces.ts";
import type { UndoneBox } from "./WrapUp.ts";

export type ImplementRecord = CommittedRecord | BlockedRecord | HandoffRecord;

export interface CommittedRecord extends RecordBody {
  status: "committed";
}

export interface BlockedRecord extends RecordBody {
  status: "blocked";
}

export interface HandoffRecord extends RecordBody {
  status: "handoff";
  handoff: Handoff;
}

interface RecordBody {
  // In landing order: a repo lands before any repo that depends on it.
  branches: CommittedBranch[];
  closing_comment: string;
  boxes_undone: UndoneBox[];
  blockers: Blocker[];
}

export interface CommittedBranch {
  repo: string;
  branch: string;
  sha: string;
}

export interface Blocker {
  kind: "gated-action" | "spec-ambiguity" | "denied-tool";
  detail: string;
  recommendation: string;
}

export interface Handoff {
  conclusion: string;
  files_to_open: { path: string; lines: string }[];
  ruled_out: string[];
  files_changed: string[];
  // Empty when the code is green.
  still_failing: string[];
}

export interface ImplementPromptInput {
  issue: IssueRef;
  title: string;
  body: string;
  branch: string;
  // Run with a repo name appended, it puts that detached repo in the workspace onto the issue branch.
  promoteCommand: string;
  // Set for a fresh step after a handoff; a handoff is cumulative, so only the latest is passed.
  latestHandoff?: Handoff;
}

// Sent with --resume once a step crosses the live ceiling without handing off.
export const handoffOnlyPrompt =
  "Stop now; return a handoff record only, no file changes.";

export function implementPrompt(input: ImplementPromptInput): string {
  const { issue, title, body, latestHandoff } = input;
  return [
    `You are the implement step of an unattended run. Implement ${issue.repo}#${issue.number}, "${title}". Nobody is watching this session: never ask a question or wait for an answer.`,
    workspaceSection(input),
    workingSection,
    finishingSection,
    handoffSection,
    ...(latestHandoff ? [previousHandoffSection(latestHandoff)] : []),
    `## The ticket\n\n${body}`,
  ].join("\n\n");
}

function workspaceSection({
  issue,
  branch,
  promoteCommand,
}: ImplementPromptInput): string {
  return `## Where you work

- Your working directory is the ticket's issue workspace root. The ${issue.repo} checkout is on the ticket's branch, \`${branch}\`; every other repo is detached at master.
- To change a detached repo, first put it onto \`${branch}\` with \`${promoteCommand} <repo>\`. Never switch, create or delete a branch yourself.`;
}

const workingSection = `## How you work

- Work test-first: if a \`tdd\` skill is available, call it, at the seams the ticket names or, with none named, seams you pick yourself; never stop to confirm them.
- Run typechecking regularly, single test files regularly, and the full test suite once at the end.
- Never ask. When the ticket is ambiguous, a command needs a yes nobody gave, or a tool is denied, don't stall: record it as a blocker (\`spec-ambiguity\`, \`gated-action\` or \`denied-tool\`) with what happened and what you recommend the developer do. Carry on with the reading the ticket best supports when the work can go on without it; otherwise stop with status \`blocked\`.`;

const finishingSection = `## When you're done

- Commit once in each repo you changed, on the ticket's branch. That commit is your only write outside the workspace's files: never push, merge, rebase or reset, never comment on or close an issue, and never run the wrap-up. Don't call code review; the runner reviews after you.
- Then stop and return the implement record:
  - \`status\`: \`committed\`, or \`blocked\` when a blocker stopped you before any commit.
  - \`branches\`: each repo you committed in, its branch and the commit's sha, in landing order (a repo lands before any repo that depends on it; a package clone before the root). Empty unless committed.
  - \`closing_comment\`: what landed, for the ticket's closing comment.
  - \`boxes_undone\`: each acceptance box you left undone, with why.
  - \`blockers\`: each blocker, as above.`;

const handoffSection = `## If a context nudge fires

Finish the step in hand, then stop: commit nothing, post nothing, and return status \`handoff\` with no branches and every \`handoff\` field: \`conclusion\`, \`files_to_open\` (path and line range), \`ruled_out\`, \`files_changed\`, and \`still_failing\` (empty when the code is green). A handoff is cumulative: carry over whatever still matters from any handoff you started from.`;

function previousHandoffSection(handoff: Handoff): string {
  return `## Handoff from the previous step

The tree holds uncommitted work from the previous step. Don't reset, stash, check out or clean it; build on it.

${handoffText(handoff)}`;
}

function handoffText(handoff: Handoff): string {
  const filesToOpen = handoff.files_to_open.map(
    ({ path, lines }) => `${path}:${lines}`,
  );
  return [
    `Conclusion: ${handoff.conclusion}`,
    `Files to open:${bulletsOf(filesToOpen)}`,
    `Ruled out:${bulletsOf(handoff.ruled_out)}`,
    `Files changed:${bulletsOf(handoff.files_changed)}`,
    `Still failing:${bulletsOf(handoff.still_failing)}`,
  ].join("\n");
}

function bulletsOf(items: string[]): string {
  if (items.length === 0) return " none";
  return items.map((item) => `\n- ${item}`).join("");
}

// What the schema can't see: whether the step's status matches the commits git shows it made.
export function implementRecordProblems(
  record: ImplementRecord,
  hasNewCommit: boolean,
): string[] {
  if (record.status === "committed" && !hasNewCommit) {
    return ["the record says committed, but the step made no new commit"];
  }
  if (record.status === "handoff" && hasNewCommit) {
    return [
      "a handoff must leave its work uncommitted, but the step made a new commit",
    ];
  }
  if (record.status === "blocked" && hasNewCommit) {
    return [
      "a blocked record must commit nothing, but the step made a new commit",
    ];
  }
  return [];
}

const stringSchema = { type: "string" };

const branchSchema = objectSchema({
  repo: stringSchema,
  branch: stringSchema,
  sha: stringSchema,
});

const blockerSchema = objectSchema({
  kind: { enum: ["gated-action", "spec-ambiguity", "denied-tool"] },
  detail: stringSchema,
  recommendation: stringSchema,
});

const handoffSchema = objectSchema({
  conclusion: stringSchema,
  files_to_open: arraySchema(
    objectSchema({ path: stringSchema, lines: stringSchema }),
  ),
  ruled_out: arraySchema(stringSchema),
  files_changed: arraySchema(stringSchema),
  still_failing: arraySchema(stringSchema),
});

// One variant per status, so a handoff alone carries `handoff` and only a committed record names branches.
export const implementRecordSchema = {
  type: "object",
  oneOf: [
    recordSchema("committed", {
      branches: arraySchema(branchSchema, { minItems: 1 }),
    }),
    recordSchema("blocked", {
      branches: arraySchema(branchSchema, { maxItems: 0 }),
      blockers: arraySchema(blockerSchema, { minItems: 1 }),
    }),
    recordSchema("handoff", {
      branches: arraySchema(branchSchema, { maxItems: 0 }),
      handoff: handoffSchema,
    }),
  ],
};

function recordSchema(
  status: ImplementRecord["status"],
  overrides: Record<string, object>,
): object {
  return objectSchema({
    status: { const: status },
    branches: arraySchema(branchSchema),
    closing_comment: stringSchema,
    boxes_undone: arraySchema(
      objectSchema({ box: stringSchema, reason: stringSchema }),
    ),
    blockers: arraySchema(blockerSchema),
    ...overrides,
  });
}

function objectSchema(properties: Record<string, object>): object {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function arraySchema(items: object, bounds: object = {}): object {
  return { type: "array", items, ...bounds };
}
