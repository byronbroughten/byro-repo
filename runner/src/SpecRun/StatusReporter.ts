// What a caller outside the run asks of it: `status`, each member's block and the account's reading,
// and `requestStop`, which leaves the stop request RunLoop.ts takes between tickets; the request's path is the Base's.
// A Batch's record (../BatchRecords.ts) lets either take any member's number for the whole Batch.
// ../SpecRun.ts delegates status and requestStop to it; it builds its own TicketSelector for each member's waits,
// and its own ReviewListPoster to read whether a member's gap check is done.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";

import {
  ActiveAccountUnknown,
  noActiveAccountPhraseOf,
} from "../ActiveAccountUnknown.ts";
import { type Halt } from "../halts.ts";
import {
  holderLabelOf,
  issueLabelOf,
  type IssueRef,
} from "../IssueWorkspaces.ts";
import { readingLabelOf } from "../limitGuard.ts";
import { ReviewListPoster } from "./ReviewListPoster.ts";
import {
  type BatchView,
  isLanded,
  joinedOrNone,
  memberBlockedWaitOf,
  type Run,
  unlandedBlockersOf,
  type Wait,
  waitsTextOf,
} from "./runState.ts";
import { runHalts } from "./runState/runHalts.ts";
import { SpecRunBase } from "./SpecRunBase.ts";
import { TicketSelector } from "./TicketSelector.ts";

interface Waiting extends BatchView {
  openHalts: Halt[];
}

export class StatusReporter extends SpecRunBase {
  private get reviewListPoster(): ReviewListPoster {
    return new ReviewListPoster(this.config);
  }

  private get ticketSelector(): TicketSelector {
    return new TicketSelector(this.config);
  }

  // Posts nothing and saves no run state, so it's safe beside a live run; an answer the run hasn't read yet shows as open.
  async status(specIssue: IssueRef): Promise<string> {
    const memberIssues = this.batchRecords.membersOf(specIssue);
    const [leadIssue, ...otherIssues] = memberIssues;
    const isBatch = otherIssues.length > 0;
    const lead = await this._startRun(leadIssue);
    const runs = [lead];
    for (const otherIssue of otherIssues) {
      runs.push(await this._startRun(otherIssue));
    }
    const landedMembers: IssueRef[] = [];
    if (isBatch) {
      for (const run of runs) {
        if (await this._isMemberLanded(run)) landedMembers.push(run.spec.issue);
      }
    }
    const blocks: string[] = [];
    for (const run of runs) {
      blocks.push(
        await this._statusBlockOf(run, { memberIssues, landedMembers }),
      );
    }
    const lines: string[] = [];
    if (isBatch) {
      lines.push(`Batch of ${memberIssues.map(issueLabelOf).join(", ")}.`, "");
    }
    lines.push(
      blocks.join("\n\n"),
      `Account: ${await this._activeReadingLabelOf(lead)}.`,
    );
    const isStopRequested = memberIssues.some((memberIssue) =>
      existsSync(this._stopRequestPathOf(memberIssue)),
    );
    if (isStopRequested) {
      const subject = isBatch ? "Batch" : "run";
      lines.push(
        `A stop is requested; the ${subject} ends after its current ticket.`,
      );
    }
    return lines.join("\n");
  }

  // Read between tickets and while idle, a Batch's on its first member whichever member named it; one made with no run going is dropped as the next run starts.
  requestStop(specIssue: IssueRef): void {
    const [lead] = this.batchRecords.membersOf(specIssue);
    mkdirSync(this.config.stateFolder, { recursive: true });
    writeFileSync(this._stopRequestPathOf(lead), "");
  }

  // The loop's reading of a member finished with nothing waiting, taken from the saved state and the spec's comments:
  // every ticket landed or closed, no open Halt, and a spec member's gap check done.
  private async _isMemberLanded(run: Run): Promise<boolean> {
    if (runHalts.openHaltsOf(run).length > 0) return false;
    for (const ticket of run.tickets) {
      if (isLanded(run, ticket)) continue;
      if ((await this.config.github.issueOf(ticket)).isOpen) return false;
    }
    return this.reviewListPoster._isGapChecked(run);
  }

  private async _statusBlockOf(run: Run, batch: BatchView): Promise<string> {
    const openHalts = runHalts.openHaltsOf(run);
    const waits = await this._waitsOf(run, { ...batch, openHalts });
    const landed = run.tickets.filter((ticket) => isLanded(run, ticket));
    const current = waits.flatMap((wait) => currentTextOf(run, wait));
    const others = waits.filter(({ holder }) => holder?.kind !== "run");
    return [
      `${issueLabelOf(run.spec.issue)}, "${run.spec.title}"`,
      `Landed: ${joinedOrNone(landed.map(issueLabelOf))}.`,
      `Current: ${joinedOrNone(current)}.`,
      `Open Halts: ${joinedOrNone(openHalts.map(openHaltTextOf))}.`,
      `Waiting: ${others.length === 0 ? "none" : waitsTextOf(others)}.`,
    ].join("\n");
  }

  // A member held by blocker members shows only that wait, as the loop picks nothing from it.
  private async _waitsOf(
    run: Run,
    { openHalts, ...batch }: Waiting,
  ): Promise<Wait[]> {
    const member = run.spec.issue;
    const blockers = await this._memberBlockersOf(member, batch);
    if (blockers.length > 0) return [memberBlockedWaitOf(member, blockers)];
    const survey = await this.ticketSelector._survey(run, {
      openHalts,
      landedMembers: batch.landedMembers,
    });
    return survey.waits;
  }

  private async _memberBlockersOf(
    member: IssueRef,
    batch: BatchView,
  ): Promise<IssueRef[]> {
    if (batch.memberIssues.length === 1) return [];
    const open = await this.config.github.openBlockersOf(member);
    return unlandedBlockersOf(open, batch);
  }

  private async _activeReadingLabelOf(run: Run): Promise<string> {
    try {
      const { account, usage } = await this._activeReadingOf(run);
      return readingLabelOf(account, usage);
    } catch (error) {
      if (!(error instanceof ActiveAccountUnknown)) throw error;
      return `unknown; ${noActiveAccountPhraseOf()}`;
    }
  }
}

function currentTextOf(run: Run, { ticket, holder }: Wait): string[] {
  if (holder?.kind !== "run") return [];
  const step = run.state.tickets[issueLabelOf(ticket)]?.step ?? "implement";
  return [`${issueLabelOf(ticket)} at ${step} (${holderLabelOf(holder)})`];
}

function openHaltTextOf(halt: Halt): string {
  return `${halt.id} on ${issueLabelOf(halt.ticket)}`;
}
