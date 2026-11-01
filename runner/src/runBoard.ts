// The Run board: one block per run lock in the state folder, or per Batch for its members' locks, read from that spec's run state and progress log.
// It writes nothing, so it's safe beside any run; a lock whose pid is dead is marked rather than skipped.
// byro-repo's `npm run runner -- status` prints it once and `-- watch` redraws it, both with no spec.
// RunLock.ts lists the lock files, BatchRecords.ts finds a member's Batch and SpecRun/runState/statePaths.ts names the run state and progress log paths.
// SpecRun/SpecRunBase.ts writes both; ProgressLog.ts reads the progress lines, worded where the run writes them.

import { BatchRecords, isMemberOf } from "./BatchRecords.ts";
import { issueLabelOf, type IssueRef } from "./IssueWorkspaces.ts";
import { ProgressLog } from "./ProgressLog.ts";
import { RunLock } from "./RunLock.ts";
import { type MemberList } from "./SpecRun/runState.ts";
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

interface MemberProgress {
  spec: IssueRef;
  log: ProgressLog;
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
        const isListed = runs.some((members) => isMemberOf(members, spec));
        if (!isListed) runs.push(batchRecords.membersOf(spec));
        return runs;
      },
      [],
    );
  }

  // A Batch's block reads its current member's run state and progress log.
  private _blockOf(members: MemberList, now: Date): string {
    const { spec, log } = currentMemberOf(
      members.map((member) => this._progressOf(member)),
    );
    const isLive = RunLock.isAnyHeld(this.stateFolder, members);
    const label = runLabelOf(members);
    const statePath = statePaths.runStatePathOf(this.stateFolder, spec);
    return [
      isLive ? label : `${label}: ${boardTexts.gone}`,
      ...(members.length > 1 ? [`  Member: ${issueLabelOf(spec)}`] : []),
      `  Ticket: ${log.ticketText(statePath, now)}`,
      `  Account: ${log.accountText()}`,
      `  ${log.latestText(now)}`,
    ].join("\n");
  }

  private _progressOf(spec: IssueRef): MemberProgress {
    return {
      spec,
      log: ProgressLog.at(statePaths.progressLogPathOf(this.stateFolder, spec)),
    };
  }
}

// The member whose ticket or launch line is latest, or the first while none has one; a Batch is never empty.
function currentMemberOf(members: MemberProgress[]): MemberProgress {
  return members.reduce((current, member) =>
    member.log.ticketTime > current.log.ticketTime ? member : current,
  );
}

function runLabelOf([lead, ...rest]: MemberList): string {
  if (rest.length === 0) return issueLabelOf(lead);
  const numbers = rest.map(({ number }) => `#${number}`);
  return `Batch ${[issueLabelOf(lead), ...numbers].join(", ")}`;
}
