// The one seam between the run core and its Workflows: the Workflow type, the agent steps' rules and the pick of a
// ticket's Workflow. SpecRun/TicketSequencer.ts reaches a Workflow's Step sequence only through this module, SpecRun/SpecEndRunner.ts
// the union of the spec-end Steps of the Workflows a run's tickets pick, through specEndOf, and every
// collaborator that launches an agent step takes its prompt, record schema and record checks, through agentStepOf, from the Workflow
// SpecRunBase._ticketWorkflowOf picks; SpecRun/TicketSequencer.ts takes its source targets,
// SpecRun/DraftPuller.ts its pull rules, through pullOf, and SpecRun/DraftPusher.ts its push rules, through pushOf.
// Each Workflow's own code is in Workflow/<name>/.
// A ticket's own `code` or `piece` label picks its Workflow, falling back to its spec's, so a Standalone ticket, its own
// spec, picks by its own; a ticket labelled both, or with neither in a spec labelled both, picks none, and a run halts on it. issue:start's
// skill picks by it. Labels are Trusted, since only collaborators can add one.

import type { Docs } from "./Docs.ts";
import type { SectionKey } from "./Docs/markdownDialect.ts";
import type { HaltQuestion } from "./halts.ts";
import { type IssueRef, issueRef } from "./IssueWorkspaces.ts";
import type { SessionSubmit } from "./promptText.ts";
import { sessionOutputSchemaOf } from "./recordSchema.ts";
import type { Command } from "./runKnobs.ts";
import {
  humanLabel,
  type PullBaseline,
  type TicketState,
  type TicketStep,
  type TrackedIssue,
  type Wait,
} from "./SpecRun/runState.ts";
import type {
  DismissedOverlap,
  Finding,
  Handoff,
  ImplementRecord,
  ReadyResearchRecord,
  ResearchHandoff,
  ResearchRecord,
  ResolveRecord,
} from "./stepRecords.ts";
import type { Target } from "./ticketTargets.ts";
import type { StepAgent } from "./transcriptFacts.ts";

const workflowNames = ["code", "piece"] as const;

export type WorkflowName = (typeof workflowNames)[number];

export type Landing = "code" | "research";

// A skill's folder name under `.claude/skills/`, which /start-issue reads.
export type SessionSkill =
  "implement-code" | "research-piece" | "close-project" | "implement-piece";

// A ticket's session skill with the labels it was picked from, which say whether the ticket is drafting.
export interface SkilledTicket {
  skill: SessionSkill;
  labels: string[];
}

// A drafting ticket follows `implement-piece` with no `ready-for-human` label; a developer-only step follows it too, with the label.
export function isDrafting({ skill, labels }: SkilledTicket): boolean {
  return skill === "implement-piece" && !labels.includes(humanLabel);
}

// `/close-project` always takes the parent's number, so an Edit gate's session names its spec, never the gate.
export function isSpecSkill(skill: SessionSkill): boolean {
  return skill === "close-project";
}

export interface WorkflowStep {
  step: TicketStep;
  // The step the ticket goes on to from the state this one left; the last step has none.
  nextOf?(state: TicketState): TicketStep;
}

export interface Workflow {
  name: WorkflowName;
  stepsOf(ticket: Pick<TrackedIssue, "labels">): WorkflowStep[];
  // The skill an interactive session follows on one of the Workflow's tickets.
  sessionSkillOf(ticket: Pick<TrackedIssue, "labels">): SessionSkill;
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
  // Reached through pullOf and pushOf, which throw for a Workflow with no Agent draft.
  pull?: PullRules;
  push?: PushRules;
}

// The push Step: the Agent draft's agent Sections into the Deliverable's Doc, once at the spec's end.
export interface PushRules {
  agentSectionsOf(draft: string): AgentSection[];
  // The draft with each kept Section, by its heading path, marked as the developer's and holding the Doc's text.
  keptOf(draft: string, kept: Map<string, string>): string;
  // A fresh Docs module over the Workflow's Docs port.
  readonly docs: Docs;
}

// An agent Section of the draft: its Markdown, keyed and trimmed as DocRead.sections is, by its heading's headingId and path.
export interface AgentSection extends SectionKey {
  markdown: string;
}

// The pull Step: the Deliverable's Doc into the Piece's Agent draft, on the ticket's branch.
export interface PullRules {
  // The Deliverable's Doc ID the spec names; undefined when it names none.
  deliverableOf(spec: Pick<TrackedIssue, "body">): string | undefined;
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

// A Step that runs once at a spec's end, rather than in each ticket; the core runs each by its name, in this order.
// `judge` ends the run with "judge, then rerun" while any review-list item is undecided, so the Steps after it wait on the developer's judgement.
// `push` writes the Agent draft into the Deliverable once, asking on a push Halt before it writes over a Section the developer changed since the pull.
const specEndSteps = ["gap-check", "judge", "push"] as const;

export type SpecEndStep = (typeof specEndSteps)[number];

export interface SpecEnd {
  // Run in order, each when a member's end finds the steps due.
  steps: SpecEndStep[];
  isDue(waits: Wait[]): boolean;
  // The line a run's end adds once its steps have run: where the developer goes next; undefined for none.
  nextLineOf(spec: TrackedIssue, waits: Wait[]): string | undefined;
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
  workspacePath: string;
  // Set for a fresh step after a handoff; a handoff is cumulative, so only the latest is passed.
  latestHandoff?: ResearchHandoff;
  // Set for the step sent back on a red quote check.
  redQuotes?: RedQuotes;
  // Set for the step a Failure Halt's `retry` answer runs again.
  firstTry?: FirstTry;
}

// What the try before a retry left in the scratch folder, each file's path from the folder.
export interface FirstTry {
  files: string[];
}

export interface RedQuotes {
  record: ReadyResearchRecord;
  // The quote check's command and the last lines of its output.
  failure: string;
}

export interface ResearchRules {
  promptOf(input: ResearchPromptInput): string;
  // A gitignored folder from the workspace root, the runner's to create, so a retry knows where the try before it worked.
  scratchFolderOf(ticket: IssueRef): string;
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

// The ticket fields every agent-step prompt input shares; `ticketSteps.promptFieldsOf` builds them.
export interface TicketPromptFields {
  issue: IssueRef;
  spec: IssueRef;
  title: string;
  // The ticket's, Trusted since only collaborators can add one.
  labels: string[];
  branch: string;
  // The workspace's repos on the issue branch: the issue's own plus any extras it was created with.
  branchedRepos: string[];
  workspacePath: string;
}

export interface ImplementPromptInput extends TicketPromptFields {
  body: string;
  // Takes the repo to promote as its last argument.
  promoteCommand: string;
  // Set for a fresh step after a handoff; a handoff is cumulative, so only the latest is passed.
  latestHandoff?: Handoff;
}

// What a record check may read besides the record: the ticket and where its spec's repo is cloned in the workspace.
export interface ImplementRecordContext {
  spec: TrackedIssue;
  ticket: TrackedIssue;
  specClone: string;
}

// The implementer's steps a handoff can come in or before; red checks and merge-master each name their own.
export type HandoffStep =
  "implement" | "review" | "resolve" | "red-checks" | "merge-master";

// Where the implementer handed off: during a step it was running, or at the boundary before the next.
export interface HandoffPoint {
  relation: "in" | "before";
  step: HandoffStep;
}

export interface HandoffComment {
  handoff: Handoff;
  sessionId: string;
  point: HandoffPoint;
}

export interface ImplementRules {
  promptOf(input: ImplementPromptInput): string;
  outputSchema: object;
  recordOf(output: unknown): ImplementRecord;
  // `output` is the step's whole output, for a Workflow that checks it against outputSchema, since only the real adapter does.
  recordProblems(
    output: unknown,
    hasNewCommit: boolean,
    context: ImplementRecordContext,
  ): string[];
  handoffCommentOf(comment: HandoffComment): string;
  // A gitignored folder from the workspace root, the runner's to create, so every step of the ticket reads the same files.
  keptFolderOf?(ticket: IssueRef): string;
}

export interface ReviewPromptInput extends TicketPromptFields {
  skillName: string;
  // Set when the diff is within the inlineReviewMaxFiles knob, so the review may skip its reviewer subagents.
  isInlineAllowed: boolean;
  // Set for an interactive session's brief; otherwise a run's implementer reviews its own work, in its session or a fresh one after a handoff.
  sessionSubmit?: SessionSubmit;
  // Set when the review runs in the session that implemented the ticket, so it needn't read the ticket again.
  isTicketHeld?: boolean;
  // The committed implement record's, absent for an interactive session, which has none.
  pointsWorthChecking?: string[];
  // Each branched repo's, in order; unset when none has a diff from master, so the review skill's own first step finds it empty.
  commitsSinceMaster?: RepoCommits[];
  // Set for a Workflow whose review rules write them; the review skill gathers only what isn't here.
  suppliedInputs?: SuppliedInput[];
}

// An input the review skill copies word for word, written to its file before launch, or why there is none.
export type SuppliedInput = WrittenInput | AbsentInput;

export interface WrittenInput {
  // As the review skill names it.
  name: string;
  path: string;
}

export interface AbsentInput {
  name: string;
  // A lowercase clause, with no closing period, on what the spec lacks.
  absence: string;
}

// What a review's supplied inputs are written from.
export interface ReviewInputsContext {
  spec: TrackedIssue;
  ticket: IssueRef;
  workspacePath: string;
  // The spec's repo's clone in the workspace.
  specClone: string;
  // The bodies of the comments on each of the spec's other tickets that `isIncluded` keeps, in ticket order.
  commentsOnTicketsOf(
    isIncluded: (ticket: TrackedIssue) => boolean,
  ): Promise<string[]>;
}

// One branched repo's `git log master..HEAD --oneline` lines.
export interface RepoCommits {
  repo: string;
  commits: string[];
}

export interface ReviewRules {
  promptOf(input: ReviewPromptInput): string;
  // The core checks the step's record against it too, since only the real adapter does.
  outputSchema: object;
  // The skill the review step follows, its SKILL.md body inlined in the prompt.
  skillName: string;
  // Set for a skill that spawns reviewer subagents; unset, the review is never checked for them.
  reviewerCheck?: ReviewerCheck;
  // Writes the inputs the skill would copy word for word, before a run's review or a session's brief.
  suppliedInputsOf?(context: ReviewInputsContext): Promise<SuppliedInput[]>;
}

// A review that spawns fewer than `count` subagents is resumed once with `resumePrompt`, unless it was offered inline review.
export interface ReviewerCheck {
  count: number;
  resumePrompt: string;
  // False where the diff's file count says nothing of the review's size, so every review is checked.
  offerInline: boolean;
}

export interface ResolvePromptInput extends TicketPromptFields {
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
}

export interface RedChecksPromptInput extends TicketPromptFields {
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

export interface GapCheckTicket extends Pick<
  TrackedIssue,
  "issue" | "title" | "isOpen"
> {
  // Undefined for a ticket that picks none, which halted its run.
  workflow: WorkflowName | undefined;
}

export interface GapCheckPromptInput {
  spec: IssueRef;
  title: string;
  // Every ticket of the spec, landed or closed as not planned, but for any its Workflow's trigger lets stay open.
  tickets: GapCheckTicket[];
  // One per Workflow the spec's tickets use, in name order.
  sections: GapCheckSection[];
}

// A Workflow's part of the spec's one gap check; promptText.ts's frame holds the rest.
export interface GapCheckSection {
  workflow: WorkflowName;
  // Where the Workflow's tickets' work is, after "against".
  place: string;
  // How a story is checked there.
  checks: string[];
  // The follow-up a gap there drafts, after "the title of".
  followUp: string;
  // The ticket its trigger lets stay open through the gap check.
  heldOpen?: HeldOpenTicket;
}

export interface HeldOpenTicket {
  // As its ticket line marks it.
  name: string;
  // As the prompt's opening describes it, after its name.
  description: string;
}

// The record and its schema are the frame's, every Workflow's alike.
export interface GapCheckRules {
  sectionOf(spec: IssueRef): GapCheckSection;
}

// The label that picks each Workflow, on a ticket or its spec.
export const workflowLabels: Record<WorkflowName, string> = {
  code: "code",
  piece: "piece",
};

// The Workflows a repo's runner config builds; the core picks among them.
export type Workflows = Record<WorkflowName, Workflow>;

type LabelledIssue = Pick<TrackedIssue, "labels">;

type PickedTicket = Pick<TrackedIssue, "issue" | "labels">;

// A Standalone ticket is its own spec.
export interface SpecTicket {
  ticket: PickedTicket;
  spec: LabelledIssue;
}

export interface SpecTickets {
  tickets: PickedTicket[];
  spec: LabelledIssue;
}

// Undefined for a ticket labelled both, which goes through one Step sequence only, and for one with neither in a spec labelled both, since the fallback to the spec's label can't choose.
export function ticketWorkflowNameOf({
  ticket,
  spec,
}: SpecTicket): WorkflowName | undefined {
  if (isLabelledBoth(ticket)) return undefined;
  const own = labelledNameOf(ticket);
  if (own !== undefined) return own;
  if (isLabelledBoth(spec)) return undefined;
  return labelledNameOf(spec) ?? "code";
}

// A ticket that picks none ran no Workflow, so its row keeps the piece name every such row has had, not a guess from its spec's label.
export function rowWorkflowNameOf(specTicket: SpecTicket): WorkflowName {
  return ticketWorkflowNameOf(specTicket) ?? "piece";
}

// A spec's own Workflow, for a Friction note decide files: piece whenever its labels include piece.
export function specWorkflowNameOf(spec: LabelledIssue): WorkflowName {
  return labelledNameOf(spec) ?? "code";
}

// Called only on an issue with at most one of the labels, or, by specWorkflowNameOf, where piece wins over both.
function labelledNameOf({ labels }: LabelledIssue): WorkflowName | undefined {
  if (labels.includes(workflowLabels.piece)) return "piece";
  if (labels.includes(workflowLabels.code)) return "code";
  return undefined;
}

function isLabelledBoth({ labels }: LabelledIssue): boolean {
  return workflowNames.every((name) => labels.includes(workflowLabels[name]));
}

function ticketWorkflowOf(
  specTicket: SpecTicket,
  workflows: Workflows,
): Workflow | undefined {
  const name = ticketWorkflowNameOf(specTicket);
  return name === undefined ? undefined : workflows[name];
}

// For a caller past the run's Halt on a ticket that picks none, or a session, which stops there.
export function pickedWorkflowOf(
  specTicket: SpecTicket,
  workflows: Workflows,
): Workflow {
  const workflow = ticketWorkflowOf(specTicket, workflows);
  if (workflow === undefined) {
    throw new Error(`${unpickedWorkflowOf(specTicket.ticket)}.`);
  }
  return workflow;
}

// The session's throw and the run's Halt both word it.
export function unpickedWorkflowOf(ticket: PickedTicket): string {
  const label = issueRef.labelOf(ticket.issue);
  if (isLabelledBoth(ticket)) {
    return `${label} has both the \`code\` and the \`piece\` label, but a ticket goes through one Workflow only, so ${label} picks no Workflow and must keep only one of them`;
  }
  return `${label} has neither the \`code\` nor the \`piece\` label, and its spec has both, so ${label} picks no Workflow until it gets its missing \`code\` or \`piece\` label`;
}

// Each Workflow once, in name order; a ticket that picks none raises its own Halt when it starts.
export function ticketWorkflowsOf(
  { spec, tickets }: SpecTickets,
  workflows: Workflows,
): Workflow[] {
  const picked = new Set(
    tickets.map((ticket) => ticketWorkflowNameOf({ ticket, spec })),
  );
  return workflowNames
    .filter((name) => picked.has(name))
    .map((name) => workflows[name]);
}

// The skill an interactive session follows on a ticket, from the Workflow a run picks for it.
export function sessionSkillOf(
  specTicket: SpecTicket,
  workflows: Workflows,
): SessionSkill {
  return pickedWorkflowOf(specTicket, workflows).sessionSkillOf(
    specTicket.ticket,
  );
}

export function isWorkflowName(name: string | undefined): name is WorkflowName {
  return workflowNames.some((workflowName) => workflowName === name);
}

// Due when any Workflow's trigger is, so one Workflow's open wait, such as a piece ticket's Edit gate, holds no Step back.
export function specEndOf(workflows: Workflow[]): SpecEnd {
  const ends = workflows.map(({ specEnd }) => specEnd);
  return {
    steps: specEndSteps.filter((step) =>
      ends.some(({ steps }) => steps.includes(step)),
    ),
    isDue(waits) {
      return ends.some((end) => end.isDue(waits));
    },
    nextLineOf(spec, waits) {
      for (const end of ends) {
        const line = end.nextLineOf(spec, waits);
        if (line !== undefined) return line;
      }
      return undefined;
    },
  };
}

export interface SpecGapCheck {
  spec: TrackedIssue;
  tickets: TrackedIssue[];
  // The Workflows the spec's tickets use, as ticketWorkflowsOf names them.
  workflows: Workflow[];
}

// The gap-check prompt's input: each Workflow's section and each ticket marked with the Workflow it picks.
export function gapCheckInputOf({
  spec,
  tickets,
  workflows,
}: SpecGapCheck): GapCheckPromptInput {
  if (workflows.length === 0) {
    throw new Error("The gap check has no Workflow to take its sections from.");
  }
  return {
    spec: spec.issue,
    title: spec.title,
    tickets: tickets.map(({ issue, title, isOpen, labels }) => ({
      issue,
      title,
      isOpen,
      workflow: ticketWorkflowNameOf({ ticket: { issue, labels }, spec }),
    })),
    sections: workflows.map((workflow) =>
      agentStepOf(workflow, "gapCheck").sectionOf(spec.issue),
    ),
  };
}

// The Workflow in the set with an Agent draft, whose pull and push rules the push takes.
export function pushWorkflowOf(workflows: Workflow[]): Workflow {
  const workflow = workflows.find(({ push }) => push !== undefined);
  if (workflow === undefined) {
    throw new Error("No Workflow of the spec's tickets has a push step.");
  }
  return workflow;
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

// The steps that resume the implementer's session in a run; research and the gap check each run in their own.
const sessionStepNames = [
  "implement",
  "review",
  "resolve",
  "redChecks",
  "mergeMaster",
] as const;

// Red-checks and merge-master launch as resolve, so these three step agents cover every session step.
export function sharesImplementerSession(agent: StepAgent): boolean {
  return agent === "implement" || agent === "review" || agent === "resolve";
}

// Every session step launches with it, since a resume under another schema starts without its prompt cache (#722); offering each step's exact schema keeps a step from returning another's fields (#741).
export function sessionSchemaOf(workflow: Workflow): object {
  return sessionOutputSchemaOf(
    sessionStepNames.flatMap((name) => {
      const outputSchema = workflow.agentSteps[name]?.outputSchema;
      return outputSchema === undefined ? [] : [outputSchema];
    }),
  );
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
