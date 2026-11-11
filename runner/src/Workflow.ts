// The one seam between the run core and its Workflows: the Workflow type, the agent steps' rules and the pick of a
// spec's Workflow. SpecRun/TicketSequencer.ts reaches a Workflow's Step sequence only through this module, SpecRun/ReviewListPoster.ts
// its spec-end Steps, and every
// collaborator that launches an agent step takes its prompt, record schema and record checks, through agentStepOf, from the Workflow
// SpecRunBase._workflowOf picks; SpecRun/TicketSequencer.ts takes its source targets,
// SpecRun/DraftPuller.ts its pull rules, through pullOf, and SpecRun/DraftPusher.ts its push rules, through pushOf.
// Each Workflow's own code is in Workflow/<name>/.
// A ticket follows its spec's Workflow. Labels are Trusted, since only collaborators can add one.

import type { Docs } from "./Docs.ts";
import type { HaltQuestion } from "./halts.ts";
import type { IssueRef } from "./IssueWorkspaces.ts";
import type { Command } from "./runKnobs.ts";
import type {
  PullBaseline,
  TicketState,
  TicketStep,
  TrackedIssue,
  Wait,
} from "./SpecRun/runState.ts";
import type {
  DismissedOverlap,
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

const workflowNames = ["code", "piece"] as const;

export type WorkflowName = (typeof workflowNames)[number];

export type Landing = "code" | "research";

export interface WorkflowStep {
  step: TicketStep;
  // The step the ticket goes on to from the state this one left; the last step has none.
  nextOf?(state: TicketState): TicketStep;
}

export interface Workflow {
  name: WorkflowName;
  stepsOf(ticket: TrackedIssue): WorkflowStep[];
  // The files outside the repo every step of the spec's tickets may read, on top of each ticket's own targets.
  sourceTargetsOf(spec: TrackedIssue): Target[];
  // Reached through agentStepOf, which throws for a step the Workflow leaves out.
  agentSteps: Partial<AgentSteps>;
  // What the ticket's checks and landing are: a code ticket's checks and branches, or a research ticket's quote check and comment.
  landingOf(ticket: TrackedIssue): Landing;
  // Run from a workspace or primary root: after review in each ticket, and in a master set when they go red in a ticket.
  checks: Command[];
  // A Workflow's own checks on a ticket's work, run after `checks`; a red one goes to the red-checks step as a red command does.
  ticketChecksOf?(input: TicketChecksInput): Promise<string | undefined>;
  specEnd: SpecEnd;
  // The outcome row's "What review caught" cell; undefined when the review kept nothing.
  whatReviewCaughtOf(records: ResolveRecord[]): string | undefined;
  // Reached through pullOf and pushOf, which throw for a Workflow with no Agent draft.
  pull?: PullRules;
  push?: PushRules;
}

// The push Step: the Agent draft's agent Sections into the Deliverable's Doc, once at the spec's end.
export interface PushRules {
  // Each agent Section's Markdown by its heading, keyed and trimmed as DocRead.sections is.
  agentSectionsOf(draft: string): Map<string, string>;
  // The draft with each kept Section, by its heading, marked as the developer's and holding the Doc's text.
  keptOf(draft: string, kept: Map<string, string>): string;
  // A fresh Docs module over the Workflow's Docs port.
  readonly docs: Docs;
}

// The pull Step: the Deliverable's Doc into the Piece's Agent draft, on the ticket's branch.
export interface PullRules {
  // The Deliverable's Doc ID the spec names; undefined when it names none.
  deliverableOf(spec: TrackedIssue): string | undefined;
  // From the root of the spec's repo.
  draftPathOf(spec: IssueRef): string;
  pulledOf(input: PullInput): Promise<PulledDraft>;
}

export interface PullInput {
  documentId: string;
  // The Agent draft as the branch holds it; undefined before the spec's first pull.
  draft: string | undefined;
}

export interface PulledDraft {
  draft: string;
  baseline: PullBaseline;
}

export interface TicketChecksInput {
  spec: TrackedIssue;
  ticket: TrackedIssue;
  state: TicketState;
  workspacePath: string;
  // The spec's repo's clone in the workspace.
  specClone: string;
}

// A Step that runs once at a spec's end, rather than in each ticket; the core runs each by its name.
// `judge` ends the run with "judge, then rerun" while any review-list item is undecided, so the Steps after it wait on the developer's judgement.
// `push` writes the Agent draft into the Deliverable once, asking on a push Halt before it writes over a Section the developer changed since the pull.
export type SpecEndStep = "gap-check" | "judge" | "push";

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
  // The tickets that Halt holds.
  isDrafting(ticket: TrackedIssue): boolean;
}

export interface ImplementPromptInput {
  issue: IssueRef;
  spec: IssueRef;
  title: string;
  body: string;
  // The ticket's, Trusted since only collaborators can add one.
  labels: string[];
  branch: string;
  // The workspace's repos on the issue branch: the issue's own plus any extras it was created with.
  branchedRepos: string[];
  // Takes the repo to promote as its last argument.
  promoteCommand: string;
  // Set for a fresh step after a handoff; a handoff is cumulative, so only the latest is passed.
  latestHandoff?: Handoff;
  workspacePath: string;
}

export interface ImplementRules {
  promptOf(input: ImplementPromptInput): string;
  outputSchema: object;
  recordOf(output: unknown): ImplementRecord;
  // `output` is the step's whole output, for a Workflow that checks it against outputSchema, since only the real adapter does.
  recordProblems(output: unknown, hasNewCommit: boolean): string[];
  handoffCommentOf(handoff: Handoff, sessionId: string): string;
  // A gitignored folder from the workspace root, the runner's to create, so every step of the ticket reads the same files.
  keptFolderOf?(ticket: IssueRef): string;
}

export interface ReviewPromptInput {
  issue: IssueRef;
  spec: IssueRef;
  title: string;
  labels: string[];
  skillName: string;
  branch: string;
  branchedRepos: string[];
  workspacePath: string;
}

export interface ReviewRules {
  promptOf(input: ReviewPromptInput): string;
  // The core checks the step's record against it too, since only the real adapter does.
  outputSchema: object;
  // The skill the review step follows, through the Skill tool or, for a user-invoked skill, read by its path.
  skillName: string;
}

export interface ResolvePromptInput {
  issue: IssueRef;
  spec: IssueRef;
  title: string;
  labels: string[];
  branch: string;
  branchedRepos: string[];
  workspacePath: string;
  // As the review record lists them; the prompt numbers them from 1.
  findings: Finding[];
  // The overlap hits the piece review judged no copy; empty for a review that returns none.
  dismissedOverlaps: DismissedOverlap[];
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
  spec: IssueRef;
  title: string;
  branch: string;
  branchedRepos: string[];
  workspacePath: string;
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

export type GapCheckTicket = Pick<TrackedIssue, "issue" | "title" | "isOpen">;

export interface GapCheckPromptInput {
  spec: IssueRef;
  title: string;
  // Every ticket of the spec, landed or closed as not planned, but for any its Workflow's trigger lets stay open.
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

export function workflowNameOf({
  labels,
}: Pick<TrackedIssue, "labels">): WorkflowName {
  return labels.includes(pieceLabel) ? "piece" : "code";
}

export function isWorkflowName(name: string | undefined): name is WorkflowName {
  return workflowNames.some((workflowName) => workflowName === name);
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
    throw new Error(`The ${missingStepOf(workflow, name)}.`);
  }
  return rules;
}

export function hasAgentStep(
  workflow: Workflow,
  name: keyof AgentSteps,
): boolean {
  return workflow.agentSteps[name] !== undefined;
}

// "<name> Workflow has no <step> step", for every message that names a step a Workflow leaves out.
export function missingStepOf(workflow: Workflow, step: string): string {
  return `${workflow.name} Workflow has no ${step} step`;
}

export function pullOf(workflow: Workflow): PullRules {
  if (workflow.pull === undefined) {
    throw new Error(`The ${missingStepOf(workflow, "pull")}.`);
  }
  return workflow.pull;
}

export function pushOf(workflow: Workflow): PushRules {
  if (workflow.push === undefined) {
    throw new Error(`The ${missingStepOf(workflow, "push")}.`);
  }
  return workflow.push;
}
