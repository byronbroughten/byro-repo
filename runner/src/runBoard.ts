// The Run board: one block per run lock in the state folder, or per Batch for its members' locks, read from that spec's run state and progress log,
// its tickets left from each member's run state.
// It writes nothing, so it's safe beside any run; a lock whose pid is dead is marked rather than skipped.
// byro-repo's `npm run runner -- status` prints it once and `-- watch` redraws it, both with no spec.
// RunLock.ts lists the lock files, BatchRecords.ts finds a member's Batch and SpecRun/runState/statePaths.ts names the run state and progress log paths.
// SpecRun/SpecRunBase.ts writes both; savedFormats.ts reads the run state and ProgressLog.ts the progress lines, worded where the run writes them.

import { BatchRecords } from "./BatchRecords.ts";
import { type IssueRef, issueRef } from "./IssueWorkspaces.ts";
import { ProgressLog } from "./ProgressLog.ts";
import { RunLock } from "./RunLock.ts";
import { runStateAt } from "./savedFormats.ts";
import { type MemberList, type RunState } from "./SpecRun/runState.ts";
import { statePaths } from "./SpecRun/runState/statePaths.ts";

interface BoardWatch {
  render: () => string;
  draw: (board: string) => void;
  pollMs: number;
  sleep: (ms: number) => Promise<void>;
}

const boardTexts = {
  noRuns: "No runs are running.",
  gone: "process gone; Vanished unless its event file ends in a run-ended line",
} as const;

export function runBoardOf(stateFolder: string, now: Date): string {
  return new RunBoard(stateFolder).textAt(now);
}

// Returns only by throwing, which a Ctrl-C does by ending the process instead.
export async function watchBoard({
  render,
  draw,
  pollMs,
  sleep,
}: BoardWatch): Promise<never> {
  for (;;) {
    draw(render());
    await sleep(pollMs);
  }
}

interface TicketCount {
  left: number;
  total: number;
}

interface MemberProgress {
  spec: IssueRef;
  log: ProgressLog;
  // None while the run hasn't written its state yet.
  state: RunState | undefined;
}

// The board over one state folder.
class RunBoard {
  private readonly stateFolder: string;

  constructor(stateFolder: string) {
    this.stateFolder = stateFolder;
  }

  textAt(now: Date): string {
    const blocks = this._runs().map((members) => this._blockOf(members, now));
    if (blocks.length === 0) return boardTexts.noRuns;
    return blocks.join("\n\n");
  }

  // A Batch's members' locks make one entry, at its first-listed lock's place.
  private _runs(): MemberList[] {
    const batchRecords = BatchRecords.init(this.stateFolder);
    return RunLock.specsOf(this.stateFolder).reduce<MemberList[]>(
      (runs, spec) => {
        const isListed = runs.some((members) =>
          issueRef.isAmong(spec, members),
        );
        if (!isListed) runs.push(batchRecords.membersOf(spec));
        return runs;
      },
      [],
    );
  }

  // A Batch's block reads its current member's run state and progress log, and every member's run state for its tickets left.
  private _blockOf(members: MemberList, now: Date): string {
    const progresses = members.map((member) => this._progressOf(member));
    const { spec, log, state } = currentMemberOf(progresses);
    const isLive = RunLock.isAnyHeld(this.stateFolder, members);
    const label = runLabelOf(members);
    const ticketsLeft = ticketsLeftOf(progresses);
    return [
      isLive ? label : `${label}: ${boardTexts.gone}`,
      ...(members.length > 1 ? [`  Member: ${issueRef.labelOf(spec)}`] : []),
      ...(ticketsLeft === undefined
        ? []
        : [`  Tickets left: ${ticketsLeft.left} of ${ticketsLeft.total}`]),
      `  Ticket: ${log.ticketText(state, now)}`,
      `  Account: ${log.accountText()}`,
      `  ${log.latestText(now)}`,
    ].join("\n");
  }

  private _progressOf(spec: IssueRef): MemberProgress {
    return {
      spec,
      log: ProgressLog.at(statePaths.progressLogOf(this.stateFolder, spec)),
      state: runStateAt(statePaths.runStateOf(this.stateFolder, spec)),
    };
  }
}

// Summed across a Batch's members; none while any member's run state has no ticket list, so an older runner's state shows no wrong count.
function ticketsLeftOf(members: MemberProgress[]): TicketCount | undefined {
  let left = 0;
  let total = 0;
  for (const { state } of members) {
    const count = state === undefined ? undefined : ticketCountOf(state);
    if (count === undefined) return undefined;
    left += count.left;
    total += count.total;
  }
  return { left, total };
}

// A ticket closed by hand still counts as left, since the board reads no GitHub.
function ticketCountOf({
  tickets,
  ticketLabels,
}: RunState): TicketCount | undefined {
  if (ticketLabels === undefined) return undefined;
  const left = ticketLabels.filter(
    (label) => tickets[label]?.step !== "landed",
  ).length;
  return { left, total: ticketLabels.length };
}

// The member whose ticket or launch line is latest, or the first while none has one; a Batch is never empty.
function currentMemberOf(members: MemberProgress[]): MemberProgress {
  return members.reduce((current, member) =>
    member.log.ticketTime > current.log.ticketTime ? member : current,
  );
}

function runLabelOf([lead, ...rest]: MemberList): string {
  if (rest.length === 0) return issueRef.labelOf(lead);
  const numbers = rest.map(({ number }) => `#${number}`);
  return `Batch ${[issueRef.labelOf(lead), ...numbers].join(", ")}`;
}
