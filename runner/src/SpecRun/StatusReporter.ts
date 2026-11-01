// What a caller outside the run asks of it: `status`, each member's block and the account's reading,
// and `requestStop`, which leaves the stop request RunLoop.ts takes between tickets; the request's path is the Base's.
// A Batch's record (../BatchRecords.ts) lets either take any member's number for the whole Batch.
// ../SpecRun.ts delegates status and requestStop to it; it builds its own TicketSelector for each member's waits.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";

import {
  ActiveAccountUnknown,
  noActiveAccountPhraseOf,
} from "../ActiveAccountUnknown.ts";
import { BatchRecords } from "../BatchRecords.ts";
import { type Halt } from "../halts.ts";
import {
  holderLabelOf,
  issueLabelOf,
  type IssueRef,
} from "../IssueWorkspaces.ts";
import { readingLabelOf } from "../limitGuard.ts";
import {
  isLanded,
  joinedOrNone,
  openHaltsOf,
  type Run,
  type Wait,
  waitsTextOf,
} from "./runState.ts";
import { SpecRunBase } from "./SpecRunBase.ts";
import { TicketSelector } from "./TicketSelector.ts";

export class StatusReporter extends SpecRunBase {
  private get ticketSelector(): TicketSelector {
    return new TicketSelector(this.config);
  }

  private get batchRecords(): BatchRecords {
    return BatchRecords.init(this.config.stateFolder);
  }

  // Posts nothing and saves no run state, so it's safe beside a live run; an answer the run hasn't read yet shows as open.
  async status(specIssue: IssueRef): Promise<string> {
    const memberIssues = this.batchRecords.membersOf(specIssue);
    const [leadIssue, ...otherIssues] = memberIssues;
    const isBatch = otherIssues.length > 0;
    const lead = await this._startRun(leadIssue);
    const blocks = [await this._statusBlockOf(lead)];
    for (const otherIssue of otherIssues) {
      blocks.push(await this._statusBlockOf(await this._startRun(otherIssue)));
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

  private async _statusBlockOf(run: Run): Promise<string> {
    const openHalts = openHaltsOf(run);
    const { waits } = await this.ticketSelector._survey(run, {
      openHalts,
      landedMembers: [],
    });
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
