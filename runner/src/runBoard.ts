// The Run board: a Runs section with one block per run lock in the state folder, or per Batch for its members' locks, read from that spec's run state and progress log,
// its tickets left from each member's run state; then AccountsSection.ts's Accounts section, handed each live run's step stream reading.
// It writes nothing, so it's safe beside any run; a lock whose pid is dead is marked rather than skipped.
// byro-repo's `npm run runner -- status` prints it once and `-- watch` redraws it, both with no spec.
// RunLock.ts lists the lock files, BatchRecords.ts finds a member's Batch and SpecRun/runState/statePaths.ts names the run state and progress log paths.
// SpecRun/SpecRunBase.ts writes both; savedFormats.ts reads the run state and ProgressLog.ts the progress lines, worded where the run writes them.

import type { AccountsSection } from "./AccountsSection.ts";
import type { UsageReading } from "./AgentStep.ts";
import { BatchRecords, runLabelOf } from "./BatchRecords.ts";
import { type IssueRef, issueRef } from "./IssueWorkspaces.ts";
import type { StreamUsage } from "./limitGuard.ts";
import { ProgressLog } from "./ProgressLog.ts";
import { RunLock } from "./RunLock.ts";
import { runStateAt } from "./savedFormats.ts";
import { type MemberList, type RunState } from "./SpecRun/runState.ts";
import { statePaths } from "./SpecRun/runState/statePaths.ts";

interface BoardWatch {
  render: () => Promise<string>;
  draw: (board: string) => void;
  pollMs: number;
  sleep: (ms: number) => Promise<void>;
}

export interface BoardRequest {
  stateFolder: string;
  accounts: AccountsSection;
  now: Date;
}

const boardTexts = {
  noRuns: "No runs are running.",
  gone: "process gone; Vanished unless its event file ends in a run-ended line",
} as const;

// The redraw counts the Accounts section's age up between its cswap reads.
export const boardTimings = {
  redrawMs: 5_000,
  accountsRefreshMs: 60_000,
} as const;

export async function runBoardOf({
  stateFolder,
  accounts,
  now,
}: BoardRequest): Promise<string> {
  const board = RunBoard.init(stateFolder);
  const accountsText = await accounts.textAt(now, board.streamUsage());
  return [board.textAt(now), accountsText].join("\n\n");
}

// Returns only by throwing, which a Ctrl-C does by ending the process instead.
export async function watchBoard({
  render,
  draw,
  pollMs,
  sleep,
}: BoardWatch): Promise<never> {
  for (;;) {
    draw(await render());
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

interface BoardRun {
  members: MemberList;
  progresses: MemberProgress[];
  current: MemberProgress;
  isLive: boolean;
}

// The board over one state folder, its runs read once.
class RunBoard {
  private readonly runs: BoardRun[];

  constructor(runs: BoardRun[]) {
    this.runs = runs;
  }

  static init(stateFolder: string): RunBoard {
    return new RunBoard(
      runMembersOf(stateFolder).map((members) =>
        boardRunOf(stateFolder, members),
      ),
    );
  }

  textAt(now: Date): string {
    const blocks = this.runs.map((run) => blockOf(run, now));
    if (blocks.length === 0) return boardTexts.noRuns;
    return blocks.join("\n\n");
  }

  // Each live run's current member's latest step stream reading, by its account; a gone run's step no longer reads its account.
  streamUsage(): StreamUsage {
    const usage = new Map<number, UsageReading>();
    for (const { current, isLive } of this.runs) {
      if (!isLive) continue;
      const reading = current.log.streamReading();
      if (reading !== undefined) usage.set(reading.account, reading.usage);
    }
    return usage;
  }
}

// A Batch's members' locks make one entry, at its first-listed lock's place.
function runMembersOf(stateFolder: string): MemberList[] {
  const batchRecords = BatchRecords.init(stateFolder);
  return RunLock.specsOf(stateFolder).reduce<MemberList[]>((runs, spec) => {
    const isListed = runs.some((members) => issueRef.isAmong(spec, members));
    if (!isListed) runs.push(batchRecords.membersOf(spec));
    return runs;
  }, []);
}

function boardRunOf(stateFolder: string, members: MemberList): BoardRun {
  const progresses = members.map((spec) => ({
    spec,
    log: ProgressLog.at(statePaths.progressLogOf(stateFolder, spec)),
    state: runStateAt(statePaths.runStateOf(stateFolder, spec)),
  }));
  return {
    members,
    progresses,
    current: currentMemberOf(progresses),
    isLive: RunLock.isAnyHeld(stateFolder, members),
  };
}

// A Batch's block reads its current member's run state and progress log, and every member's run state for its tickets left.
function blockOf(
  { members, progresses, current, isLive }: BoardRun,
  now: Date,
): string {
  const { spec, log, state } = current;
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
