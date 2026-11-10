// The one seam between the run core and its Workflows: the Workflow type, the agent steps' rules and the pick of a
// spec's Workflow. SpecRun/TicketSequencer.ts reaches a Workflow's Step sequence only through this module, and every
// collaborator that launches an agent step takes its prompt, record schema and record checks from agentStepsOf.
// Each Workflow's own code is in Workflow/<name>/.
// A ticket follows its spec's Workflow. Labels are Trusted, since only collaborators can add one.

import type { IssueRef } from "./IssueWorkspaces.ts";
import type { Command } from "./runKnobs.ts";
import type {
  TicketState,
  TicketStep,
  TrackedIssue,
} from "./SpecRun/runState.ts";
import type {
  Finding,
  GapCheckRecord,
  Handoff,
  ImplementRecord,
  ResolveRecord,
} from "./stepRecords.ts";

export type WorkflowName = "code" | "piece";

export interface WorkflowStep {
  step: TicketStep;
  // The step the ticket goes on to from the state this one left; the last step has none.
  nextOf?(state: TicketState): TicketStep;
}

export interface Workflow {
  name: WorkflowName;
  stepsOf(ticket: TrackedIssue): WorkflowStep[];
  agentSteps: AgentSteps;
  // Run from a workspace or primary root: after review in each ticket, and in a master set when they go red in a ticket.
  checks: Command[];
  // Called through the Skill tool by the review step.
  reviewSkillName: string;
}

export interface AgentSteps {
  implement: ImplementRules;
  review: ReviewRules;
  resolve: ResolveRules;
  redChecks: RedChecksRules;
  mergeMaster: MergeMasterRules;
  gapCheck: GapCheckRules;
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
  // Set for a fresh step after a handoff; a handoff is cumulative, so only the latest is passed.
  latestHandoff?: Handoff;
}

export interface ImplementRules {
  promptOf(input: ImplementPromptInput): string;
  outputSchema: object;
  recordOf(output: unknown): ImplementRecord;
  recordProblems(record: ImplementRecord, hasNewCommit: boolean): string[];
  handoffCommentOf(handoff: Handoff, sessionId: string): string;
}

export interface ReviewPromptInput {
  issue: IssueRef;
  title: string;
  skillName: string;
  branch: string;
  branchedRepos: string[];
}

export interface ReviewRules {
  promptOf(input: ReviewPromptInput): string;
  outputSchema: object;
}

export interface ResolvePromptInput {
  issue: IssueRef;
  title: string;
  branch: string;
  branchedRepos: string[];
  // As the review record lists them; the prompt numbers them from 1.
  findings: Finding[];
}

export interface ResolveCommits {
  records: ResolveRecord[];
  // Whether the committed tree differs from the one the resolve started on; a reverted fix leaves it unchanged.
  hasChangedTree: boolean;
  // The repos the resolver left uncommitted changes in.
  dirtyRepos: string[];
}

export interface ResolveRules {
  promptOf(input: ResolvePromptInput): string;
  retryPromptOf(problems: string[]): string;
  outputSchema: object;
  // A step's output passed outputSchema already; a session's records file did not.
  outputProblems(output: unknown): string[];
  recordsOf(output: unknown): ResolveRecord[];
  withReviewerFields(
    records: ResolveRecord[],
    findings: Finding[],
  ): ResolveRecord[];
  recordProblems(findingCount: number, records: ResolveRecord[]): string[];
  commitProblems(commits: ResolveCommits): string[];
  numberedFindingsOf(findings: Finding[]): string;
  // Absent, every resolve runs as a fresh session.
  resumes?: StepResumption;
}

// A step that resumes an earlier Step's session under the ticket budget, and what a fresh session gets in its place.
export interface StepResumption {
  step: "implement";
  // A refused record's retry prompt leans on the resumed conversation, so a fresh session gets the step's prompt too.
  freshRetryPromptOf(input: ResolvePromptInput, problems: string[]): string;
}

export interface RedChecksPromptInput {
  issue: IssueRef;
  title: string;
  branch: string;
  branchedRepos: string[];
  // Each failing check's command and the last lines of its output.
  failures: string;
}

export interface RedChecksRules {
  promptOf(input: RedChecksPromptInput): string;
  outputSchema: object;
}

export interface MergeMasterPromptInput {
  issue: IssueRef;
  title: string;
  branch: string;
  branchedRepos: string[];
  // The repos the runner left mid-merge.
  mergingRepos: string[];
  // The wrap-up's conflict message.
  conflict: string;
}

export interface MergeMasterRules {
  promptOf(input: MergeMasterPromptInput): string;
  outputSchema: object;
}

export type GapCheckTicket = Pick<TrackedIssue, "issue" | "title">;

export interface GapCheckPromptInput {
  spec: IssueRef;
  title: string;
  // Every ticket of the spec, each closed, whether landed or closed as not planned.
  tickets: GapCheckTicket[];
}

export interface GapCheckRules {
  promptOf(input: GapCheckPromptInput): string;
  outputSchema: object;
  recordOf(output: unknown): GapCheckRecord;
}

const pieceLabel = "piece";

// The Workflows a repo's runner config builds; the core picks among them.
export interface Workflows {
  code: Workflow;
}

export function workflowNameOf(spec: TrackedIssue): WorkflowName {
  return spec.labels.includes(pieceLabel) ? "piece" : "code";
}

export function workflowOf(spec: TrackedIssue, workflows: Workflows): Workflow {
  const registered: Record<WorkflowName, Workflow> = {
    code: workflows.code,
    // The piece Workflow isn't registered yet, so a piece spec runs as code until it is.
    piece: workflows.code,
  };
  return registered[workflowNameOf(spec)];
}

export function agentStepsOf(
  spec: TrackedIssue,
  workflows: Workflows,
): AgentSteps {
  return workflowOf(spec, workflows).agentSteps;
}
