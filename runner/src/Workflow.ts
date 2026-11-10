// The one seam between the run core and its Workflows: the Workflow type, the agent steps' rules and the pick of a
// spec's Workflow. SpecRun/TicketSequencer.ts reaches a Workflow's Step sequence only through this module, SpecRun/ReviewListPoster.ts
// its spec-end Steps, and every
// collaborator that launches an agent step takes its prompt, record schema and record checks, through agentStepOf, from the Workflow
// SpecRunBase._workflowOf picks; SpecRun/PreflightChecker.ts takes its ticket refusal, and SpecRun/TicketSequencer.ts its source targets.
// Each Workflow's own code is in Workflow/<name>/.
// A ticket follows its spec's Workflow. Labels are Trusted, since only collaborators can add one.

import type { HaltQuestion } from "./halts.ts";
import type { IssueRef } from "./IssueWorkspaces.ts";
import type { Command } from "./runKnobs.ts";
import type {
  TicketState,
  TicketStep,
  TrackedIssue,
  Wait,
} from "./SpecRun/runState.ts";
import type {
  Finding,
  GapCheckRecord,
  Handoff,
  ImplementRecord,
  ReadyResearchRecord,
  ResearchHandoff,
  ResearchRecord,
  ResolveRecord,
} from "./stepRecords.ts";
import type { Target } from "./ticketTargets.ts";

export type WorkflowName = "code" | "piece";

export type Landing = "code" | "research";

export interface WorkflowStep {
  step: TicketStep;
  // The step the ticket goes on to from the state this one left; the last step has none.
  nextOf?(state: TicketState): TicketStep;
}

export interface Workflow {
  name: WorkflowName;
  stepsOf(ticket: TrackedIssue): WorkflowStep[];
  // The preflight's refusal of the spec's launchable tickets, a Standalone run's own ticket among them; undefined when none refused.
  ticketRefusalOf(launchable: TrackedIssue[]): string | undefined;
  // The files outside the repo every step of the spec's tickets may read, on top of each ticket's own targets.
  sourceTargetsOf(spec: TrackedIssue): Target[];
  // Reached through agentStepOf, which throws for a step the Workflow leaves out.
  agentSteps: Partial<AgentSteps>;
  // What the ticket's checks and landing are: a code ticket's checks and branches, or a research ticket's quote check and comment.
  landingOf(ticket: TrackedIssue): Landing;
  // Run from a workspace or primary root: after review in each ticket, and in a master set when they go red in a ticket.
  checks: Command[];
  specEnd: SpecEnd;
}

// A Step that runs once at a spec's end, rather than in each ticket; the core runs each by its name.
export type SpecEndStep = "gap-check";

export interface SpecEnd {
  // Run in order, each when a member's end finds the steps due.
  steps: SpecEndStep[];
  isDue(waits: Wait[]): boolean;
}

export interface AgentSteps {
  implement: ImplementRules;
  review: ReviewRules;
  resolve: ResolveRules;
  redChecks: RedChecksRules;
  mergeMaster: MergeMasterRules;
  gapCheck: GapCheckRules;
  research: ResearchRules;
}

export interface ResearchPromptInput {
  issue: IssueRef;
  title: string;
  body: string;
  // Set for a fresh step after a handoff; a handoff is cumulative, so only the latest is passed.
  latestHandoff?: ResearchHandoff;
  // Set for the step sent back on a red quote check.
  redQuotes?: RedQuotes;
}

export interface RedQuotes {
  record: ReadyResearchRecord;
  // The quote check's command and the last lines of its output.
  failure: string;
}

export interface ResearchRules {
  promptOf(input: ResearchPromptInput): string;
  outputSchema: object;
  recordOf(output: unknown): ResearchRecord;
  // Checks the output against outputSchema too, since only the real adapter does; `cwd` resolves a relative path.
  recordProblems(output: unknown, cwd: string): string[];
  handoffCommentOf(handoff: ResearchHandoff, sessionId: string): string;
  // The ticket's checks: the Workflow's quote check on the record's comment and texts.
  quoteCheckOf(record: ReadyResearchRecord): Command;
  // How many times a red quote check sends the step back before a Failure Halt; the prompt says the same count.
  sendBacks: number;
  // The ticket closes on it once its comment is posted.
  closingCommentOf(record: ReadyResearchRecord): string;
  // What the developer settles before drafting starts; undefined when the record leaves nothing to settle.
  haltOf(record: ReadyResearchRecord): HaltQuestion | undefined;
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
  // Called through the Skill tool by the review step.
  skillName: string;
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
export type Workflows = Record<WorkflowName, Workflow>;

export function workflowNameOf(spec: TrackedIssue): WorkflowName {
  return spec.labels.includes(pieceLabel) ? "piece" : "code";
}

export function workflowOf(spec: TrackedIssue, workflows: Workflows): Workflow {
  return workflows[workflowNameOf(spec)];
}

export function agentStepOf<SN extends keyof AgentSteps>(
  workflow: Workflow,
  name: SN,
): AgentSteps[SN] {
  const rules = workflow.agentSteps[name];
  if (rules === undefined) {
    throw new Error(`The ${workflow.name} Workflow has no ${name} step.`);
  }
  return rules;
}
