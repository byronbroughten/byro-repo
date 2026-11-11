// How a run words its end, waits and refusals: what landed, what waits and why, a Stop it ended on,
// the developer-only edit rule and the command that reruns it.
// The Wait and MemberList these word are ../runState.ts; the state file and progress log paths are statePaths.ts.

import { type IssueRef, issueRef } from "../../IssueWorkspaces.ts";
import { undecidedTextOf } from "../../reviewList.ts";
import { stopOutcomes, type UnhandledStop } from "../../UnhandledStop.ts";
import type { SpecEndStep } from "../../Workflow.ts";
import { type Judgement, type MemberList, type Wait } from "../runState.ts";

const specEndStepNames: Record<SpecEndStep, string> = {
  "gap-check": "The gap check",
  judge: "The judge Step",
  push: "The push",
};

export interface JudgedMember {
  issue: IssueRef;
  judgement: Judgement | undefined;
}

export const runText = {
  stoppedOn({ outcome, message, logPath }: UnhandledStop): string {
    return `stopped on ${stopOutcomes[outcome]}: ${message} Log: \`${logPath}\``;
  },

  onlyDeveloperEdits(developer: string, bodies: string): string {
    return `Only ${developer} may write or edit ${bodies}`;
  },

  // Every member is in one repo, the first's.
  rerunCommandOf(owner: string, ...members: MemberList): string {
    const [{ repo }] = members;
    const numbers = members.map(({ number }) => number).join(" ");
    return `npm run runner -- ${owner}/${repo} ${numbers}`;
  },

  // A push's, a ticket's and a spec-end Step's stop all tell the operator to retry alike.
  rerunToRetryOf(rerunCommand: string): string {
    return `Rerun to retry it: \`${rerunCommand}\`.`;
  },

  // A ticket's blocked wait and a Batch member's end both say it alike.
  blockedBy(label: string, blockers: string[]): string {
    return `${label} is blocked by ${blockers.join(", ")}`;
  },

  // A Batch member's wait on its blocker members and its cycle end both say it alike.
  waitsToLand(label: string, blockers: string[]): string {
    return `${label} waits on ${blockers.join(", ")} to land`;
  },

  // Every member is in one repo, the first's; a member with nothing to judge has undefined.
  judgeLineOf(judged: JudgedMember[]): string {
    const toJudge = judged.filter(({ judgement }) => judgement !== undefined);
    const [first] = toJudge;
    if (first === undefined) return "Review lists: nothing needs judging.";
    const counts = judged.map(
      ({ issue, judgement }) =>
        `#${issue.number} ${judgement === undefined ? "none" : runText.judgementOf(judgement)}`,
    );
    const numbers = toJudge.map(({ issue }) => issue.number).join(" ");
    return `Review lists: ${counts.join(", ")}. Judge them: \`/judge-findings ${first.issue.repo} ${numbers}\`.`;
  },

  // `runner judgeable`'s lines and a run's judge line both say it alike.
  judgementOf(judgement: Judgement): string {
    if (judgement === "ready to close") return judgement;
    return undecidedTextOf(judgement);
  },

  // A spec-end `judge` Step's stop: the developer judges the review lists before the Steps after it run.
  judgeThenRerunOf(rerunCommand: string): string {
    return `The review lists hold undecided items: judge, then rerun: \`${rerunCommand}\`.`;
  },

  // Each spec-end Step's name as a run's end message and its wait open with it.
  stepNameOf(step: SpecEndStep): string {
    return specEndStepNames[step];
  },

  waitsOf(waits: Wait[]): string {
    return waits.map(({ text }) => text).join("; ");
  },

  joinedOrNone(items: string[]): string {
    return items.length === 0 ? "none" : items.join(", ");
  },

  // A run's end and the judge Step's stop both open alike.
  runEndedOf(landed: IssueRef[], rest: string): string {
    return `Run ended: ${runText.landedOf(landed)}. ${rest}`;
  },

  landedOf(landed: IssueRef[]): string {
    if (landed.length === 0) return "landed nothing";
    return `landed ${landed.map(issueRef.labelOf).join(", ")}`;
  },
};
