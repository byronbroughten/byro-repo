// The progress-log lines the Run board reads back, worded once here for the run that writes them and the board that parses them.
// Every other progress line is free text; SpecRun/SpecRunBase.ts appends each with its timestamp, and runBoard.ts reads them.

import { issueLabelOf, type IssueRef } from "./IssueWorkspaces.ts";

export interface StepLaunch {
  subject: string; // `<repo> #<n>: <agent>` for a ticket's step, else the spec-level step's name.
  account: number;
  streamPath: string;
}

const linePatterns = {
  ticket: /^(\S+ #\d+): /, // issueLabelOf's shape opening the line.
  stepLaunch: /^(.*) step on account (\d+), raw stream in (.*)\.$/,
  stepTook: / took \d+s\.$/,
} as const;

const limitWaitPrefix = "Limit wait: ";

export function ticketLaunchLineOf(
  ticket: IssueRef,
  pairLabel: string,
  step: string,
): string {
  return `${issueLabelOf(ticket)}: launching on ${pairLabel} from ${step}.`;
}

export function stepTookLineOf(
  ticket: IssueRef,
  step: string,
  seconds: number,
): string {
  return `${issueLabelOf(ticket)}: ${step} took ${seconds}s.`;
}

export function stepLaunchLineOf({
  subject,
  account,
  streamPath,
}: StepLaunch): string {
  return `${subject} step on account ${account}, raw stream in ${streamPath}.`;
}

export function limitWaitLineOf(detail: string): string {
  return `${limitWaitPrefix}${detail}`;
}

export function ticketOfLine(line: string): string | undefined {
  return linePatterns.ticket.exec(line)?.[1];
}

// A ticket's step starts at its launch or at the end of the step before it.
export function isStepBoundaryLine(line: string, ticket: string): boolean {
  const prefix = `${ticket}: `;
  if (!line.startsWith(prefix)) return false;
  const rest = line.slice(prefix.length);
  return rest.startsWith("launching on ") || linePatterns.stepTook.test(rest);
}

export function stepLaunchOfLine(line: string): StepLaunch | undefined {
  const match = linePatterns.stepLaunch.exec(line);
  if (match === null) return undefined;
  const [, subject = "", account, streamPath = ""] = match;
  return { subject, account: Number(account), streamPath };
}

export function isLimitWaitLine(line: string): boolean {
  return line.startsWith(limitWaitPrefix);
}
