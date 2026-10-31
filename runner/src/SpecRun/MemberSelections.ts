// One pick's selections across a run's members, each with the member it came from.
// RunLoop.ts builds one per pick from TicketSelector._select and reads which members stop, wait, or launch next.

import { type IssueRef } from "../IssueWorkspaces.ts";
import { oldestAnsweredOf, type Run, type RunResult } from "./runState.ts";
import { type Selection } from "./TicketSelector.ts";

// One member's Run in a list, ended once it is done for this run.
export interface Member {
  run: Run;
  end?: MemberEnd;
}

export interface MemberEnd {
  result: RunResult;
  // Finished with nothing left waiting.
  isLanded: boolean;
}

// The issue a member was typed as: its spec, or its Standalone ticket.
export function memberIssueOf({ run }: Member): IssueRef {
  return run.spec.issue;
}

export type MemberSelection<KN extends Selection["kind"] = Selection["kind"]> =
  { member: Member } & Extract<Selection, { kind: KN }>;

export class MemberSelections {
  private readonly selections: MemberSelection[];

  constructor(selections: MemberSelection[]) {
    this.selections = selections;
  }

  get stopSpecs(): MemberSelection<"stop-spec">[] {
    return this._ofKind("stop-spec");
  }

  get waiting(): MemberSelection<"none">[] {
    return this._ofKind("none");
  }

  get stoppedAgain(): MemberSelection<"stopped-again"> | undefined {
    return this._ofKind("stopped-again")[0];
  }

  // Answered Halts first, oldest answer first, across members; then the first launch in typed member order.
  get nextLaunch(): MemberSelection<"launch"> | undefined {
    const launches = this._ofKind("launch");
    const answered = launches.flatMap((launch) =>
      launch.answeredAt === undefined
        ? []
        : [{ launch, at: launch.answeredAt }],
    );
    return oldestAnsweredOf(answered)?.launch ?? launches[0];
  }

  private _ofKind<KN extends Selection["kind"]>(
    kind: KN,
  ): MemberSelection<KN>[] {
    return this.selections.filter(
      (selection): selection is MemberSelection<KN> => selection.kind === kind,
    );
  }
}
