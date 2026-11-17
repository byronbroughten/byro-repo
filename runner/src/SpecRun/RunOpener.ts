// `runner open`: launches the named numbers when no run is live, or rejoins a live run or a live Batch holding one of them,
// then catches the Supervisor up as `supervise` does: the supervision record, a waiting handoff read once, and the unexplained event lines.
// The launch goes through the RunLauncher port its caller passes, tmux.sh's in scripts/runner/run.ts; the records are ../SupervisionRecords.ts.
// ../SpecRun.ts delegates open and catchUp to it.

import {
  type IssueRef,
  issueRef,
  type LeaseHolder,
} from "../IssueWorkspaces.ts";
import { RunLock } from "../RunLock.ts";
import { SupervisionRecords } from "../SupervisionRecords.ts";
import type { MemberList } from "./runState.ts";
import { SpecRunBase } from "./SpecRunBase.ts";

// What a launch printed and whether it saw the run's run-started line.
export interface LaunchReport {
  text: string;
  isStarted: boolean;
}

export interface RunLauncher {
  launch(members: MemberList): Promise<LaunchReport>;
}

export interface OpenOptions {
  holder: LeaseHolder;
  launcher: RunLauncher;
}

// Neither a rejoin nor a launch whose wait saw run-started leaves the run not live.
export interface OpenResult {
  text: string;
  isLive: boolean;
}

export interface CatchUp {
  handoff: string | undefined;
  lines: string[];
}

export const handoffHeading = "## Handoff from the last Supervisor";

export class RunOpener extends SpecRunBase {
  private get supervisionRecords(): SupervisionRecords {
    return SupervisionRecords.init(this.config.stateFolder);
  }

  async open(
    named: MemberList,
    { holder, launcher }: OpenOptions,
  ): Promise<OpenResult> {
    const live = this._liveMembersOf(named);
    const blocks: string[] = [];
    let isLive = true;
    if (live === undefined) {
      const report = await launcher.launch(named);
      isLive = report.isStarted;
      blocks.push(
        `No run is live for ${membersLabelOf(named)}; launched it.\n\n${report.text}`,
      );
    } else {
      blocks.push(
        `The ${subjectOf(live)} of ${membersLabelOf(live)} is live; rejoined it as it is and launched nothing.`,
      );
    }
    const [lead] = live ?? named;
    const { handoff, lines } = await this.catchUp(holder, lead);
    if (handoff !== undefined) blocks.push(handoffBlockOf(handoff));
    blocks.push(
      `## Unexplained event lines\n\n${lines.length === 0 ? "None." : lines.join("\n")}`,
    );
    return { text: blocks.join("\n\n"), isLive };
  }

  // `supervise`'s own: records the holder as the spec's or Batch's Supervisor, taking the last one's handoff on a rejoin.
  async catchUp(holder: LeaseHolder, member: IssueRef): Promise<CatchUp> {
    const records = this.supervisionRecords;
    const handoff = await records.supervise(
      holder,
      this.config.githubOwner,
      member,
    );
    return { handoff, lines: await records.unexplainedLinesOf(holder) };
  }

  // The first live run among the named numbers, a Batch's whole list when one holds it; undefined when none is live.
  private _liveMembersOf(named: MemberList): MemberList | undefined {
    const { stateFolder } = this.config;
    return named
      .map((member) => this.batchRecords.membersOf(member))
      .find((members) => RunLock.isAnyHeld(stateFolder, members));
  }
}

export function handoffBlockOf(handoff: string): string {
  return `${handoffHeading}\n\n${handoff}`;
}

function membersLabelOf([lead, ...rest]: MemberList): string {
  const numbers = rest.map((member) => issueRef.numberLabelOf(member));
  return [issueRef.labelOf(lead), ...numbers].join(", ");
}

function subjectOf(members: MemberList): string {
  if (members.length > 1) return "Batch";
  return "run";
}
