// What a caller outside the run asks of it: `status`, each member's block and the account's reading,
// and `requestStop`, which leaves the stop request RunLoop.ts takes between tickets; the request's path is the Base's.
// A Batch's record (../BatchRecords.ts) lets either take any member's number for the whole Batch.
// ../SpecRun.ts delegates status and requestStop to it; it builds its own TicketSelector for each member's waits,
// and its own SpecEndRunner to read whether a member's gap check is done.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";

import {
  ActiveAccountUnknown,
  noActiveAccountPhraseOf,
} from "../ActiveAccountUnknown.ts";
import { type Halt } from "../halts.ts";
import { type IssueRef, issueRef, leaseHolder } from "../IssueWorkspaces.ts";
import { readingLabelOf } from "../limitGuard.ts";
import {
  type BatchView,
  memberBlocking,
  type Run,
  runTickets,
  type Wait,
} from "./runState.ts";
import { runHalts } from "./runState/runHalts.ts";
import { runText } from "./runState/runText.ts";
import { SpecEndRunner } from "./SpecEndRunner.ts";
import { SpecRunBase } from "./SpecRunBase.ts";
import { TicketSelector } from "./TicketSelector.ts";

interface Waiting extends BatchView {
  openHalts: Halt[];
}

export class StatusReporter extends SpecRunBase {
  private get specEndRunner(): SpecEndRunner {
    return new SpecEndRunner(this.config);
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
      lines.push(
        `Batch of ${memberIssues.map(issueRef.labelOf).join(", ")}.`,
        "",
      );
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
    if (runHalts.openOf(run).length > 0) return false;
    for (const ticket of run.tickets) {
      if (runTickets.isLanded(run, ticket)) continue;
      if ((await this.config.github.issueOf(ticket)).isOpen) return false;
    }
    return this.specEndRunner._isGapChecked(run);
  }

  private async _statusBlockOf(run: Run, batch: BatchView): Promise<string> {
    const openHalts = runHalts.openOf(run);
    const waits = await this._waitsOf(run, { ...batch, openHalts });
    const landed = run.tickets.filter((ticket) =>
      runTickets.isLanded(run, ticket),
    );
    const current = waits.flatMap((wait) => currentTextOf(run, wait));
    const others = waits.filter(({ holder }) => holder?.kind !== "run");
    return [
      `${issueRef.labelOf(run.spec.issue)}, "${run.spec.title}"`,
      `Landed: ${runText.joinedOrNone(landed.map(issueRef.labelOf))}.`,
      `Current: ${runText.joinedOrNone(current)}.`,
      `Open Halts: ${runText.joinedOrNone(openHalts.map(openHaltTextOf))}.`,
      `Waiting: ${others.length === 0 ? "none" : runText.waitsOf(others)}.`,
    ].join("\n");
  }

  // A member held by blocker members shows only that wait, as the loop picks nothing from it.
  private async _waitsOf(
    run: Run,
    { openHalts, ...batch }: Waiting,
  ): Promise<Wait[]> {
    const member = run.spec.issue;
    const blockers = await this._memberBlockersOf(member, batch);
    if (blockers.length > 0) return [memberBlocking.waitOf(member, blockers)];
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
    return memberBlocking.unlandedOf(open, batch);
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
  const step = run.state.tickets[issueRef.labelOf(ticket)]?.step ?? "implement";
  return [
    `${issueRef.labelOf(ticket)} at ${step} (${leaseHolder.labelOf(holder)})`,
  ];
}

function openHaltTextOf(halt: Halt): string {
  return `${halt.id} on ${issueRef.labelOf(halt.ticket)}`;
}
