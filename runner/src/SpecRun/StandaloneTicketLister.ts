// `runner standalone`: lists a repo's open ready-for-agent Standalone tickets a `/runner <repo> standalone` Batch would
// launch, oldest issue number first, read once. Each ticket the Batch preflight would refuse is left out with the refusal
// PreflightChecker.ts gives a Batch member, its blockers included, so the printed list launches as printed.
// Leaving one out can leave out a ticket it blocks, so the check repeats until the list stops changing. SpecRun.ts delegates here.

import { issueLabelOf } from "../IssueWorkspaces.ts";
import { PreflightChecker } from "./PreflightChecker.ts";
import { interactiveLabel, readyLabel, type Run } from "./runState.ts";
import { SpecRunBase } from "./SpecRunBase.ts";

interface LeftOutTicket {
  run: Run;
  reason: string;
}

interface TicketList {
  listed: Run[];
  leftOut: LeftOutTicket[];
}

export class StandaloneTicketLister extends SpecRunBase {
  // Resolves to the lines the command prints.
  async standalone(repo: string): Promise<string> {
    const { listed, leftOut } = await this._ticketListOf(
      await this._standaloneTicketsOf(repo),
    );
    const oldestLeftOut = [...leftOut].sort(
      (a, b) => a.run.spec.issue.number - b.run.spec.issue.number,
    );
    const sections = [
      ...sectionOf(
        "Launchable:",
        listed.map(
          ({ spec }) => `${issueLabelOf(spec.issue)} · "${spec.title}"`,
        ),
      ),
      ...sectionOf(
        "Left out:",
        oldestLeftOut.map(
          ({ run, reason }) => `${issueLabelOf(run.spec.issue)} · ${reason}`,
        ),
      ),
      this._launchLineOf(repo, listed),
    ];
    return sections.join("\n\n");
  }

  // Oldest first; a spec, a spec's ticket and an Interactive ticket are other lists'.
  private async _standaloneTicketsOf(repo: string): Promise<Run[]> {
    const { github } = this.config;
    const labelled = await github.openIssuesLabelled(repo, readyLabel);
    const oldestFirst = [...labelled].sort((a, b) => a.number - b.number);
    const runs = await Promise.all(
      oldestFirst.map(async (issue) => {
        const run = await this._startRun(issue);
        const isStandalone =
          run.isStandalone &&
          !run.spec.labels.includes(interactiveLabel) &&
          (await github.parentOf(issue)) === undefined;
        return isStandalone ? [run] : [];
      }),
    );
    return runs.flat();
  }

  private async _ticketListOf(runs: Run[]): Promise<TicketList> {
    let listed = runs;
    const leftOut: LeftOutTicket[] = [];
    for (;;) {
      const refused = await this._leftOutOf(listed);
      if (refused.length === 0) return { listed, leftOut };
      leftOut.push(...refused);
      listed = listed.filter(
        (run) => !refused.some((ticket) => ticket.run === run),
      );
    }
  }

  // Checked against the list as it stands, so a blocker left out earlier now counts as outside it.
  private async _leftOutOf(listed: Run[]): Promise<LeftOutTicket[]> {
    const [first, ...rest] = listed.map(({ spec }) => spec.issue);
    if (first === undefined) return [];
    const checker = new PreflightChecker(this.config, [first, ...rest]);
    const reasons = await Promise.all(
      listed.map((run) => checker._batchMemberRefusalOf(run)),
    );
    return listed.flatMap((run, index) => {
      const reason = reasons[index];
      return reason === undefined ? [] : [{ run, reason }];
    });
  }

  private _launchLineOf(repo: string, listed: Run[]): string {
    const ownerRepo = `${this.config.githubOwner}/${repo}`;
    if (listed.length === 0) return `Nothing in ${ownerRepo} is launchable.`;
    const numbers = listed.map(({ spec }) => spec.issue.number);
    return `/runner ${ownerRepo} ${numbers.join(" ")}`;
  }
}

// None for an empty list, so its heading isn't printed.
function sectionOf(heading: string, lines: string[]): string[] {
  if (lines.length === 0) return [];
  return [[heading, ...lines].join("\n")];
}
