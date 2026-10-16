// The implement step: the prompt the runner sends, a non-interactive fork of upstream `implement`
// recorded in byro-repo's .claude/skills/upstream.json, and the implement record it returns.
// AgentStep.ts launches the step; StepStream.ts checks the output against implementOutputSchema.

import { stepReadLine } from "./IssueReader.ts";
import type { IssueRef } from "./IssueWorkspaces.ts";
import {
  type GitHubWrite,
  gitHubWriteActions,
  type UndoneBox,
} from "./WrapUp.ts";

export type ImplementRecord =
  CommittedRecord | AppliedRecord | BlockedRecord | HandoffRecord;

export interface CommittedRecord extends RecordBody {
  status: "committed";
}

// A ticket that needed only GitHub writes and no code.
export interface AppliedRecord extends RecordBody {
  status: "applied";
  githubWrites: GitHubWrite[];
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
  closingComment: string;
  boxesUndone: UndoneBox[];
  blockers: Blocker[];
}

export interface CommittedBranch {
  repo: string;
  branch: string;
  sha: string;
}

const blockerKinds = ["gated-action", "spec-ambiguity", "denied-tool"] as const;

export interface Blocker {
  kind: (typeof blockerKinds)[number];
  detail: string;
  recommendation: string;
}

export interface Handoff {
  conclusion: string;
  filesToOpen: { path: string; lines: string }[];
  ruledOut: string[];
  filesChanged: string[];
  stillFailing: string[];
}

export interface ImplementPromptInput {
  issue: IssueRef;
  title: string;
  body: string;
  branch: string;
  // The workspace's repos on the issue branch: the issue's own plus any extras it was created with.
  branchedRepos: string[];
  // Takes the repo to promote as its last argument.
  promoteCommand: string;
  allowedWriteGlobs: string[];
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
    gitHubSection(),
    workingSection(input),
    promptSections.finishing,
    promptSections.handoff,
    ...(latestHandoff ? [previousHandoffSection(latestHandoff)] : []),
    `## The ticket\n\n${body}`,
  ].join("\n\n");
}

function workspaceSection({
  branch,
  branchedRepos,
  promoteCommand,
}: ImplementPromptInput): string {
  return `## Where you work

- Your working directory is the ticket's issue workspace root. These repos are on the ticket's branch, \`${branch}\`: ${branchedRepos.join(", ")}. Every other repo is detached at master.
- To change a detached repo, first put it onto \`${branch}\` with \`${promoteCommand} <repo>\`. Never switch, create or delete a branch yourself.`;
}

function gitHubSection(): string {
  return `## GitHub

- Some tickets need only GitHub writes and no code. Run \`gh issue edit\` and \`gh issue comment\` only as the ticket describes them. Never close an issue, never change a triage label (such as \`ready-for-agent\`) on this ticket or another ticket of its spec, and make no other GitHub write.
- ${stepReadLine} When you need a field the reader doesn't print, record a \`denied-tool\` blocker naming it.`;
}

function workingSection({ allowedWriteGlobs }: ImplementPromptInput): string {
  return `## How you work

- Work test-first: if a \`tdd\` skill is available, call it, at the seams the ticket names or, with none named, seams you pick yourself; never stop to confirm them.
- Run typechecking regularly, single test files regularly, and the full test suite once at the end.
- Read and search with the Read and Grep tools. Give Bash one command per call, run from the workspace root: no \`cd\`, no \`;\` or \`&&\` chains, no variables.
- You can Edit or Write skills, agent definitions and hooks under \`.claude/\` matching ${codeListOf(allowedWriteGlobs)}; you can't move or delete them with Bash, and can't write \`.claude/settings*.json\` or anything else under \`.claude/\`, by any tool or path. When a write there is denied, record one \`denied-tool\` blocker listing those files instead of trying a workaround.
- Never ask. When the ticket is ambiguous, a command needs a yes nobody gave, or a tool is denied, don't stall: record it as a blocker (\`spec-ambiguity\`, \`gated-action\` or \`denied-tool\`) with what happened and what you recommend the developer do. Carry on with the reading the ticket best supports when the work can go on without it; otherwise stop with status \`blocked\`.`;
}

function codeListOf(words: readonly string[]): string {
  const quoted = words.map((word) => `\`${word}\``);
  if (quoted.length < 2) return quoted.join("");
  return `${quoted.slice(0, -1).join(", ")} or ${quoted.at(-1)}`;
}

const promptSections = {
  finishing: `## When you're done

- Commit once in each repo you changed, on the ticket's branch. That commit and the GitHub writes the ticket describes are your only writes outside the workspace's files: never push, merge, rebase or reset, never close an issue, and never run the wrap-up. Don't call code review; the runner reviews after you.
- Then stop and return the implement record as \`record\`:
  - \`status\`: \`committed\`; \`applied\` when the ticket needed only GitHub writes and you committed nothing; or \`blocked\` when a blocker stopped you before any commit.
  - \`branches\`: each repo you committed in, its branch and the commit's sha, in landing order (a repo lands before any repo that depends on it; a package clone before the root). Empty unless committed.
  - \`githubWrites\`: only when applied, each GitHub write you made: its issue as \`owner/repo#n\`, its action (\`edit\` or \`comment\`), its URL and a one-line summary.
  - \`closingComment\`: what landed, for the ticket's closing comment.
  - \`boxesUndone\`: each acceptance box you left undone, with why.
  - \`blockers\`: each blocker, as above.`,

  handoff: `## If a context nudge fires

Finish the step in hand, then stop: commit nothing, post nothing, and return status \`handoff\` with no branches and every \`handoff\` field: \`conclusion\`, \`filesToOpen\` (path and line range), \`ruledOut\`, \`filesChanged\`, and \`stillFailing\` (empty when the code is green). A handoff is cumulative: carry over whatever still matters from any handoff you started from.`,
} as const;

function previousHandoffSection(handoff: Handoff): string {
  return `## Handoff from the previous step

The tree holds uncommitted work from the previous step. Don't reset, stash, check out or clean it; build on it.

${handoffText(handoff)}`;
}

function handoffText(handoff: Handoff): string {
  const filesToOpen = handoff.filesToOpen.map(
    ({ path, lines }) => `${path}:${lines}`,
  );
  return [
    `Conclusion: ${handoff.conclusion}`,
    `Files to open:${bulletsOf(filesToOpen)}`,
    `Ruled out:${bulletsOf(handoff.ruledOut)}`,
    `Files changed:${bulletsOf(handoff.filesChanged)}`,
    `Still failing:${bulletsOf(handoff.stillFailing)}`,
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
    return [newCommitProblem("a handoff must leave its work uncommitted")];
  }
  if (record.status === "applied" && hasNewCommit) {
    return [newCommitProblem("an applied record must commit nothing")];
  }
  if (record.status === "blocked" && hasNewCommit) {
    return [newCommitProblem("a blocked record must commit nothing")];
  }
  return [];
}

function newCommitProblem(rule: string): string {
  return `${rule}, but the step made a new commit`;
}

const stringSchema = { type: "string" };

const branchSchema = objectSchema({
  repo: stringSchema,
  branch: stringSchema,
  sha: stringSchema,
});

const blockerSchema = objectSchema({
  kind: { enum: blockerKinds },
  detail: stringSchema,
  recommendation: stringSchema,
});

const gitHubWriteSchema = objectSchema({
  issue: stringSchema,
  action: { enum: gitHubWriteActions },
  url: stringSchema,
  summary: stringSchema,
});

const handoffSchema = objectSchema({
  conclusion: stringSchema,
  filesToOpen: arraySchema(
    objectSchema({ path: stringSchema, lines: stringSchema }),
  ),
  ruledOut: arraySchema(stringSchema),
  filesChanged: arraySchema(stringSchema),
  stillFailing: arraySchema(stringSchema),
});

// One variant per status, so only the status that needs a field carries it.
const recordVariantsSchema = {
  oneOf: [
    recordSchema("committed", {
      branches: arraySchema(branchSchema, { minItems: 1 }),
    }),
    recordSchema("applied", {
      branches: arraySchema(branchSchema, { maxItems: 0 }),
      githubWrites: arraySchema(gitHubWriteSchema, { minItems: 1 }),
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

// The API refuses a top-level oneOf in a tool's input schema, so the record sits under `record`.
export const implementOutputSchema = objectSchema({
  record: recordVariantsSchema,
});

export function implementRecordOf(output: unknown): ImplementRecord {
  return (output as { record: ImplementRecord }).record;
}

function recordSchema(
  status: ImplementRecord["status"],
  overrides: Record<string, object>,
): object {
  return objectSchema({
    status: { const: status },
    branches: arraySchema(branchSchema),
    closingComment: stringSchema,
    boxesUndone: arraySchema(
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

interface ArrayBounds {
  minItems?: number;
  maxItems?: number;
}

function arraySchema(items: object, bounds: ArrayBounds = {}): object {
  return { type: "array", items, ...bounds };
}
