// A run's Halts: raising them into the run state, reading them by ticket, answer or kind,
// delivering answered Failure Halts, the downstream tickets one holds, and the order answers are read in.
// The Halt shape, its comments and answers are ../../halts.ts; the run state they live in is ../runState.ts.

import {
  failureAnswerOf,
  failureOptions,
  type Halt,
  type HaltDraft,
  isAnswered,
  isStopSpecAnswer,
  sessionHaltIdOf,
  shortRefOf,
} from "../../halts.ts";
import { isSameIssue, type IssueRef } from "../../IssueWorkspaces.ts";
import { type Run, ticketStateOf, type TicketStep } from "../runState.ts";

interface DownstreamSearch {
  run: Run;
  blockersOf: Map<string, string[]>;
  ticket: string;
}

export const runHalts = {
  // Saved with the step's own state when it advances, so a rerun of the step never raises them twice.
  raise(
    run: Run,
    { ticket, drafts }: { ticket: IssueRef; drafts: HaltDraft[] },
  ): void {
    run.state.halts ??= [];
    const { halts } = run.state;
    const { sessionReview } = run;
    drafts.forEach((draft) => {
      const index = halts.length + 1;
      halts.push({
        ...draft,
        id:
          sessionReview === undefined
            ? `H${index}`
            : sessionHaltIdOf(ticket, sessionReview.earlierHalts + index),
        ticket,
        isPosted: false,
        isDelivered: false,
        ignoredReplies: [],
      });
    });
  },

  of(run: Run): Halt[] {
    return run.state.halts ?? [];
  },

  ofTicket(run: Run, ticket: IssueRef): Halt[] {
    return runHalts.of(run).filter((halt) => isSameIssue(halt.ticket, ticket));
  },

  isAuthorship({ bodyHash }: Halt): boolean {
    return bodyHash !== undefined;
  },

  isStopSpec(halt: Halt): boolean {
    return isAnswered(halt) && isStopSpecAnswer(halt);
  },

  undeliveredOf(run: Run, ticket: IssueRef): Halt[] {
    return runHalts
      .ofTicket(run, ticket)
      .filter(({ isDelivered }) => !isDelivered);
  },

  idListOf(halts: Halt[]): string {
    return halts.map(({ id }) => id).join(", ");
  },

  // Marks answered Failure Halts delivered, clears the retry counts and acts on the latest answer; a `skip` read on a later run is a retry.
  deliverFailures(
    run: Run,
    { ticket, extraTurns }: { ticket: IssueRef; extraTurns: number },
  ): TicketStep | undefined {
    const state = ticketStateOf(run, ticket);
    const failures = runHalts
      .undeliveredOf(run, ticket)
      .filter(isTicketFailureHalt);
    const latest = failures.at(-1);
    if (!isAnswered(latest)) return undefined;
    failures.forEach((halt) => {
      halt.isDelivered = true;
    });
    state.crashes = undefined;
    state.redCheckResumes = undefined;
    state.redChecksLogPath = undefined;
    state.conflictResumes = undefined;
    state.continuation = undefined;
    state.guidance = undefined;
    const answer = failureAnswerOf(latest);
    // A continuation another Halt never offered would resume a session with nothing to continue.
    if (
      answer.kind === "retry-record" &&
      isOffered(latest, failureOptions.retryRecord)
    ) {
      state.continuation = { kind: "record" };
    }
    if (answer.kind === "more-turns" && isOffered(latest, "`resume +")) {
      state.continuation = { kind: "turns", turns: answer.turns ?? extraTurns };
    }
    if (
      answer.kind === "more-handoffs" &&
      isOffered(latest, failureOptions.moreHandoffs)
    ) {
      state.extraHandoffs = (state.extraHandoffs ?? 0) + 1;
    }
    if (answer.kind === "rerun") state.pair = answer.pair;
    if (answer.kind === "guidance") state.guidance = answer.text;
    return latest.failedStep;
  },

  isGapCheck({ failedStep }: Halt): boolean {
    return failedStep === "gap-check";
  },

  // The tickets downstream of one, each `<repo>#<n>`, through the blocking graph.
  downstreamIn({ run, blockersOf, ticket }: DownstreamSearch): string[] {
    const downstream: string[] = [];
    let frontier = [ticket];
    while (frontier.length > 0) {
      const next = run.tickets.map(shortRefOf).filter((label) => {
        if (label === ticket || downstream.includes(label)) return false;
        const blockers = blockersOf.get(label) ?? [];
        return blockers.some((blocker) => frontier.includes(blocker));
      });
      downstream.push(...next);
      frontier = next;
    }
    return downstream;
  },

  // Answered Halts go oldest answer first, within one spec and across a Batch's members.
  oldestAnsweredOf<AN extends { at: string }>(answered: AN[]): AN | undefined {
    return [...answered].sort((first, second) =>
      first.at.localeCompare(second.at),
    )[0];
  },

  openOf(run: Run): Halt[] {
    return runHalts.of(run).filter(({ answer }) => answer === undefined);
  },
};

function isTicketFailureHalt(
  halt: Halt,
): halt is Halt & { failedStep: TicketStep } {
  return (
    halt.kind === "failure" &&
    halt.failedStep !== undefined &&
    !runHalts.isGapCheck(halt)
  );
}

function isOffered(halt: Halt, option: string): boolean {
  return halt.options.some((offered) => offered.startsWith(option));
}
