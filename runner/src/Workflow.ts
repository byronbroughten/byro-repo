// The one seam between the run core and its Workflows: the Workflow type and the pick of a spec's Workflow.
// The core imports a Workflow only through this module; each Workflow's own code is in Workflow/<name>/.
// A ticket follows its spec's Workflow. Labels are Trusted, since only collaborators can add one.

import type {
  TicketState,
  TicketStep,
  TrackedIssue,
} from "./SpecRun/runState.ts";
import { codeWorkflow } from "./Workflow/code/codeWorkflow.ts";

export type WorkflowName = "code" | "piece";

export interface WorkflowStep {
  step: TicketStep;
  // The step the ticket goes on to from the state this one left; the last step has none.
  nextOf?(state: TicketState): TicketStep;
}

export interface Workflow {
  name: WorkflowName;
  stepsOf(ticket: TrackedIssue): WorkflowStep[];
}

const pieceLabel = "piece";

// The piece Workflow isn't registered yet, so a piece spec runs as code until it is.
const registered: Partial<Record<WorkflowName, Workflow>> = {
  code: codeWorkflow,
};

export function workflowNameOf(spec: TrackedIssue): WorkflowName {
  return spec.labels.includes(pieceLabel) ? "piece" : "code";
}

export function workflowOf(spec: TrackedIssue): Workflow {
  return registered[workflowNameOf(spec)] ?? codeWorkflow;
}
