// How a run words its end, waits and refusals: what landed, what waits and why, a Stop it ended on,
// the developer-only edit rule and the command that reruns it.
// The Wait and MemberList these word are ../runState.ts; the state file and progress log paths are statePaths.ts.

import { issueLabelOf, type IssueRef } from "../../IssueWorkspaces.ts";
import { stopOutcomes, type UnhandledStop } from "../../UnhandledStop.ts";
import { type MemberList, type Wait } from "../runState.ts";

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

  // A ticket's blocked wait and a Batch member's end both say it alike.
  blockedBy(label: string, blockers: string[]): string {
    return `${label} is blocked by ${blockers.join(", ")}`;
  },

  // A Batch member's wait on its blocker members and its cycle end both say it alike.
  waitsToLand(label: string, blockers: string[]): string {
    return `${label} waits on ${blockers.join(", ")} to land`;
  },

  waitsOf(waits: Wait[]): string {
    return waits.map(({ text }) => text).join("; ");
  },

  joinedOrNone(items: string[]): string {
    return items.length === 0 ? "none" : items.join(", ");
  },

  landedOf(landed: IssueRef[]): string {
    if (landed.length === 0) return "landed nothing";
    return `landed ${landed.map(issueLabelOf).join(", ")}`;
  },
};
