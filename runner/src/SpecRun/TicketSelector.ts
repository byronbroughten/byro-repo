// The run's pick: posts unposted Halts, reads the developer's answers to posted ones, then surveys every open ticket
// for what holds it (a lease, a Stop, a skip, an open Halt in scope, the developer, a blocker) and picks the next one.
// A ticket with every Halt answered goes first, oldest answered set first, then the blocking graph's frontier.
// RunLoop.ts calls _select each pick and _survey for status().
// It builds its own LeaseKeeper and HaltRaiser; Halt formats and reply matching are ../halts.ts.

import {
  answeredNoteOf,
  failureAnswerOf,
  type Halt,
  haltNameOf,
  ignoredNoteOf,
  repliesTo,
  shortRefOf,
} from "../halts.ts";
import {
  holderLabelOf,
  issueLabelOf,
  type IssueRef,
} from "../IssueWorkspaces.ts";
import { HaltRaiser } from "./HaltRaiser.ts";
import { LeaseKeeper } from "./LeaseKeeper.ts";
import {
  downstreamIn,
  haltsOf,
  idListOf,
  isGapCheckHalt,
  isLaunchable,
  isStopSpec,
  openHaltsOf,
  type Run,
  ticketStateOf,
  type TrackedIssue,
  undeliveredHaltsOf,
  type Wait,
} from "./runState.ts";
import { SpecRunBase } from "./SpecRunBase.ts";

interface HoldCheck {
  halt: Halt;
  // `<repo>#<n>`.
  ticket: string;
  downstreamOf: Map<string, string[]>;
}

interface Survey {
  waits: Wait[];
  answered: { ticket: TrackedIssue; at: string }[];
  launchable: TrackedIssue[];
  stoppedAgain?: { ticket: TrackedIssue; stop: string };
}

type Selection =
  | { kind: "launch"; ticket: TrackedIssue }
  | { kind: "stopped-again"; ticket: TrackedIssue; stop: string }
  | { kind: "stop-spec"; halts: Halt[] }
  | { kind: "none"; waits: Wait[] };

export class TicketSelector extends SpecRunBase {
  private get haltRaiser(): HaltRaiser {
    return new HaltRaiser(this.config);
  }

  private get leaseKeeper(): LeaseKeeper {
    return new LeaseKeeper(this.config);
  }

  // Read afresh each pick; a ticket with every Halt answered goes first, oldest answered set first, then the frontier.
  async _select(run: Run): Promise<Selection> {
    await this.haltRaiser._postUnpostedHalts(run);
    const stopSpecs = await this._readAnswers(run);
    if (stopSpecs.length > 0) return { kind: "stop-spec", halts: stopSpecs };
    const survey = await this._survey(run, openHaltsOf(run));
    const { waits, answered, launchable, stoppedAgain } = survey;
    if (stoppedAgain !== undefined) {
      return { kind: "stopped-again", ...stoppedAgain };
    }
    answered.sort((first, second) => first.at.localeCompare(second.at));
    const [first] = [...answered.map(({ ticket }) => ticket), ...launchable];
    if (first === undefined) return { kind: "none", waits };
    return { kind: "launch", ticket: first };
  }

  async _survey(run: Run, openHalts: Halt[]): Promise<Survey> {
    const downstreamOf = await this._scopeDownstreamOf(run, openHalts);
    const survey: Survey = { waits: [], answered: [], launchable: [] };
    const { waits } = survey;
    const gapCheckHalts = openHalts.filter(isGapCheckHalt);
    if (gapCheckHalts.length > 0) {
      const text = `The gap check waits on Halt ${idListOf(gapCheckHalts)}`;
      waits.push({ ticket: run.spec.issue, reason: "halted", text });
    }
    for (const ticket of run.tickets) {
      const tracked = await this.config.github.issueOf(ticket);
      if (!tracked.isOpen) continue;
      const label = issueLabelOf(ticket);
      const holder = await this.leaseKeeper._otherHolderOf(ticket);
      if (holder !== undefined) {
        const text = `${label} is leased by ${holderLabelOf(holder)}`;
        waits.push({ ticket, reason: "leased", text, holder });
        continue;
      }
      const { step, stop } = ticketStateOf(run, ticket);
      if (stop !== undefined) {
        if (survey.stoppedAgain === undefined) {
          survey.stoppedAgain = { ticket: tracked, stop };
        }
        const text = `${label} stopped on ${stop}`;
        waits.push({ ticket, reason: "stopped", text });
        continue;
      }
      if (run.skipped.has(label)) {
        waits.push({ ticket, reason: "skipped", text: `${label} was skipped` });
        continue;
      }
      const holding = openHalts.filter((halt) =>
        isHeldBy({ halt, ticket: shortRefOf(ticket), downstreamOf }),
      );
      if (holding.length > 0) {
        const text = `${label} waits on Halt ${idListOf(holding)}`;
        waits.push({ ticket, reason: "halted", text });
        continue;
      }
      const stopSpecs = undeliveredHaltsOf(run, ticket).filter(isStopSpec);
      if (stopSpecs.length > 0) {
        const text = `${label}'s Halt ${idListOf(stopSpecs)} was answered \`stop spec\``;
        waits.push({ ticket, reason: "stop-spec", text });
        continue;
      }
      if (!isLaunchable(tracked)) {
        const text = developerWaitTextOf(
          label,
          await this._downstreamLabelsOf(run, ticket),
        );
        waits.push({ ticket, reason: "developer", text });
        continue;
      }
      const blockers = await this.config.github.openBlockersOf(ticket);
      if (blockers.length > 0) {
        const text = `${label} is blocked by ${blockers.map(issueLabelOf).join(", ")}`;
        waits.push({ ticket, reason: "blocked", text });
        continue;
      }
      if (step === "halted") {
        survey.answered.push({
          ticket: tracked,
          at: lastAnswerAtOf(run, ticket),
        });
      } else {
        survey.launchable.push(tracked);
      }
    }
    return survey;
  }

  private async _downstreamLabelsOf(
    run: Run,
    issue: IssueRef,
  ): Promise<string[]> {
    const downstream = await this.haltRaiser._downstreamOf(run, issue);
    return run.tickets
      .filter((ticket) => downstream.includes(shortRefOf(ticket)))
      .map(issueLabelOf);
  }

  // The first reply naming an open Halt answers it; a later one is noted as ignored, once.
  private async _readAnswers(run: Run): Promise<Halt[]> {
    const posted = haltsOf(run).filter(({ isPosted }) => isPosted);
    if (posted.length === 0) return [];
    const stopSpecs: Halt[] = [];
    const comments = await this.config.github.authoredCommentsOf(
      run.spec.issue,
    );
    const { developer } = this.config;
    for (const halt of posted) {
      const [first, ...later] = repliesTo({ halt, comments, developer });
      if (first === undefined) continue;
      if (halt.answer === undefined) {
        halt.answer = {
          replyId: first.id,
          text: first.body,
          at: this.config.clock.now().toISOString(),
        };
        this._saveState(run);
        this._log(
          run,
          `${haltNameOf(halt)} on ${issueLabelOf(halt.ticket)} is answered.`,
        );
        await this._comment(run, answeredNoteOf(halt));
        if (isStopSpec(halt)) stopSpecs.push(halt);
        if (isSkipAnswered(halt) && !isGapCheckHalt(halt)) {
          run.skipped.add(issueLabelOf(halt.ticket));
        }
      }
      const ignored = [first, ...later].filter(
        ({ id }) =>
          id !== halt.answer?.replyId && !halt.ignoredReplies.includes(id),
      );
      for (const reply of ignored) {
        halt.ignoredReplies.push(reply.id);
        this._saveState(run);
        await this._comment(run, ignoredNoteOf(halt, reply));
      }
    }
    return stopSpecs;
  }

  // Each ticket an open Halt names in its scope, to the tickets downstream of it; read only when a Halt names one.
  private async _scopeDownstreamOf(
    run: Run,
    openHalts: Halt[],
  ): Promise<Map<string, string[]>> {
    const named = new Set(
      openHalts.flatMap(({ scope }) => (scope === "spec" ? [] : scope)),
    );
    const downstreamOf = new Map<string, string[]>();
    if (named.size === 0) return downstreamOf;
    const blockersOf = await this.haltRaiser._blockersByTicketOf(run);
    named.forEach((ticket) => {
      downstreamOf.set(ticket, downstreamIn({ run, blockersOf, ticket }));
    });
    return downstreamOf;
  }
}

// The halted ticket itself, every ticket for a `spec` scope, else the named tickets and their downstream.
function isHeldBy({ halt, ticket, downstreamOf }: HoldCheck): boolean {
  const { scope } = halt;
  if (shortRefOf(halt.ticket) === ticket || scope === "spec") return true;
  return scope.some(
    (named) =>
      named === ticket || (downstreamOf.get(named) ?? []).includes(ticket),
  );
}

function lastAnswerAtOf(run: Run, ticket: IssueRef): string {
  const times = undeliveredHaltsOf(run, ticket).map(
    ({ answer }) => answer?.at ?? "",
  );
  return times.sort().at(-1) ?? "";
}

function isSkipAnswered(halt: Halt): boolean {
  if (halt.kind !== "failure" || halt.answer === undefined) return false;
  return failureAnswerOf(halt, halt.answer).kind === "skip";
}

function developerWaitTextOf(label: string, downstream: string[]): string {
  if (downstream.length === 0) return `${label} waits on you`;
  return `${label} waits on you and blocks ${downstream.join(", ")}`;
}
