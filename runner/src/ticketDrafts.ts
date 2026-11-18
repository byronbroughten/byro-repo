// `npm run issue:file`'s draft format, its order and its refusals; the format is documented in docs/agents/issue-tracker.md.
// One file's read into a draft is ticketDrafts/TicketDraftReader.ts's.

import { TicketDraftReader } from "./ticketDrafts/TicketDraftReader.ts";
import { ticketReadiness } from "./ticketReadiness.ts";

export interface DraftFile {
  fileName: string;
  text: string;
}

export interface TicketDraft {
  number: number;
  fileName: string;
  title: string;
  // The kind's triage label first.
  labels: string[];
  blockers: number[];
  body: string;
}

export const ticketDrafts = {
  // In draft order, refusing any draft that can't file and any blocker number with no draft.
  draftsOf(files: DraftFile[]): TicketDraft[] {
    if (files.length === 0) throw new Error("The folder holds no drafts.");
    const drafts = files
      .map((file) => TicketDraftReader.init(file).draft)
      .sort((a, b) => a.number - b.number);
    for (const [at, draft] of drafts.entries()) {
      const earlier = drafts[at - 1];
      if (earlier?.number === draft.number) {
        throw new Error(
          `${draft.fileName} has draft number ${draft.number}, as ${earlier.fileName} does.`,
        );
      }
    }
    const numbers = new Set(drafts.map(({ number }) => number));
    for (const draft of drafts) {
      const missing = draft.blockers.filter((blocker) => !numbers.has(blocker));
      if (missing.length > 0) {
        throw new Error(
          `${draft.fileName} is blocked by draft ${missing.join(", ")}, which the folder doesn't hold.`,
        );
      }
    }
    const unready = drafts.flatMap(
      ({ fileName, labels: [triage = ""], body }) =>
        ticketReadiness.isChecked(triage)
          ? ticketReadiness.gapsOf(body).map((gap) => `${fileName} ${gap}.`)
          : [],
    );
    if (unready.length > 0) {
      throw new Error(
        `Filing nothing: each agent or interactive draft needs docs/agents/tickets.md's ## Where and a last ## Model fit.\n${unready.join("\n")}`,
      );
    }
    return drafts;
  },
  // Each blocker before the drafts naming it, otherwise in draft order.
  filingOrderOf(drafts: TicketDraft[]): TicketDraft[] {
    const filed = new Set<number>();
    const order: TicketDraft[] = [];
    let waiting = drafts;
    while (waiting.length > 0) {
      const next = waiting.find(({ blockers }) =>
        blockers.every((blocker) => filed.has(blocker)),
      );
      if (next === undefined) throw new Error(cycleMessageOf(waiting));
      filed.add(next.number);
      order.push(next);
      waiting = waiting.filter((draft) => draft !== next);
    }
    return order;
  },
};

// Every draft left waiting is in a cycle or waits on one, so the message trims those that block or wait on no other kept draft.
function cycleMessageOf(waiting: TicketDraft[]): string {
  let inCycle = waiting;
  let isShrinking = true;
  while (isShrinking) {
    const keptNumbers = new Set(inCycle.map(({ number }) => number));
    const blocking = new Set(inCycle.flatMap(({ blockers }) => blockers));
    const kept = inCycle.filter(
      ({ number, blockers }) =>
        blocking.has(number) &&
        blockers.some((blocker) => keptNumbers.has(blocker)),
    );
    isShrinking = kept.length < inCycle.length;
    inCycle = kept;
  }
  const names = inCycle.map(({ fileName }) => fileName).join(", ");
  return `The drafts' blockers form a cycle among ${names}.`;
}
