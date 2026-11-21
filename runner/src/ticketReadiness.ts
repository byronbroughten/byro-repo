// The check `npm run issue:file` and `npm run issue:ready` share before a ticket holds an agent or interactive label:
// docs/agents/tickets.md's `## Where` section, any `## Targets` section's `- <target>` lines, as ticketTargets.ts reads them,
// and last `## Model fit` section, a pair line then a reason ending in `~NK`.

import { markdownSectionOf } from "./markdownSections.ts";
import {
  estimateOf,
  isModelFitLast,
  modelFitHeading,
  pairOf,
} from "./modelFit.ts";
import {
  humanLabel,
  interactiveLabel,
  readyLabel,
} from "./SpecRun/runState.ts";
import {
  targetLineShapes,
  targetsHeading,
  targetsOf,
} from "./ticketTargets.ts";

const whereHeading = "## Where";

export const ticketReadiness = {
  // docs/agents/triage-labels.md's `ready-*` labels.
  readyLabels: [readyLabel, interactiveLabel, humanLabel] as readonly string[],
  // What both refusals cite.
  rule: `docs/agents/tickets.md's ${whereHeading}, any ${targetsHeading} well formed and a last ${modelFitHeading}`,
  // A `ready-for-human` ticket isn't checked.
  needsCheck(label: string): boolean {
    return label === readyLabel || label === interactiveLabel;
  },
  hasModelFit(body: string): boolean {
    return markdownSectionOf(body, modelFitHeading) !== undefined;
  },
  // Each missing or malformed section, worded to follow the ticket's name; empty when the body passes.
  gapsOf(body: string): string[] {
    const gaps: string[] = [];
    if (markdownSectionOf(body, whereHeading) === undefined) {
      gaps.push(`has no ${whereHeading} section`);
    }
    gaps.push(...targetsGapsOf(body));
    gaps.push(...modelFitGapsOf(body));
    return gaps;
  },
};

function targetsGapsOf(body: string): string[] {
  const reading = targetsOf(body);
  if (reading.status === "valid") return [];
  return [
    `has a ${targetsHeading} line \`${reading.line}\` that isn't ${targetLineShapes}`,
  ];
}

function modelFitGapsOf(body: string): string[] {
  if (!ticketReadiness.hasModelFit(body)) {
    return [`has no ${modelFitHeading} section`];
  }
  if (!isModelFitLast(body)) {
    return [modelFitGap("that isn't the last section")];
  }
  const gaps: string[] = [];
  if (pairOf(body) === undefined) {
    gaps.push(modelFitGap("whose first line names none of the six pairs"));
  }
  if (estimateOf(body) === undefined) {
    gaps.push(modelFitGap("with no reason ending in its estimate as ~NK"));
  }
  return gaps;
}

function modelFitGap(fault: string): string {
  return `has a ${modelFitHeading} section ${fault}`;
}
