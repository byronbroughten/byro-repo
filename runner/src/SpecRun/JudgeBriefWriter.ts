// `runner judge-brief`: prints, for each spec named or every one `runner judgeable` lists, all /judge-findings' step 1
// reads, so the skill gets it by injection in one call. The items and counts are reviewList.ts's judgingOrderOf; the
// spec list for `all` is JudgeableIssueLister.ts's. It prints only Trusted text, never a Halt's or the spec's body, and
// words every failure itself, so a brief never throws. SpecRun.ts delegates here.

import {
  closeOutLabels,
  pieceTicketTextOf,
} from "../CloseOutBrief/CloseOutWriter.ts";
import { messageOf } from "../failureText.ts";
import {
  briefHeadlineOf,
  listOf,
  othersCommentsLineOf,
  readCommandOf,
  refLabelOf,
  stateWordOf,
} from "../IssueReader.ts";
import { type IssueRef, issueRef } from "../IssueWorkspaces.ts";
import { type JudgingItem, judgingOrderOf } from "../reviewList.ts";
import { JudgeableIssueLister } from "./JudgeableIssueLister.ts";
import type { TrackedIssue } from "./runState.ts";
import { SpecRunBase } from "./SpecRunBase.ts";

// A spec named by its number, or every spec `runner judgeable` lists.
export type JudgedSpecs = (number | "all")[];

export class JudgeBriefWriter extends SpecRunBase {
  private get judgeableIssueLister(): JudgeableIssueLister {
    return new JudgeableIssueLister(this.config);
  }

  // Resolves to the lines the command prints.
  async judgeBrief(repo: string, named: JudgedSpecs): Promise<string> {
    let specs: IssueRef[];
    try {
      specs = await this._specsOf(repo, named);
    } catch (error) {
      return `No judge brief: listing ${repo}'s judgeable specs failed: ${messageOf(error)}`;
    }
    if (specs.length === 0) {
      return this.judgeableIssueLister.nothingLineOf(repo);
    }
    const briefs = await Promise.all(specs.map((spec) => this._briefOf(spec)));
    return briefs.join("\n\n");
  }

  // `all` expands in place, so the order given holds.
  private async _specsOf(
    repo: string,
    named: JudgedSpecs,
  ): Promise<IssueRef[]> {
    const groups = await Promise.all(
      named.map(async (spec) => {
        if (spec !== "all") return [{ repo, number: spec }];
        return this.judgeableIssueLister.judgeableIssuesOf(repo);
      }),
    );
    return groups.flat();
  }

  private async _briefOf(spec: IssueRef): Promise<string> {
    try {
      return (await this._linesOf(spec)).join("\n");
    } catch (error) {
      return `# ${issueRef.labelOf(spec)}: no brief, its read failed: ${messageOf(error)}`;
    }
  }

  private async _linesOf(spec: IssueRef): Promise<string[]> {
    const { github, developer } = this.config;
    const [tracked, subRefs, parent, comments] = await Promise.all([
      github.issueOf(spec),
      github.subIssuesOf(spec),
      github.parentOf(spec),
      github.authoredCommentsOf(spec),
    ]);
    const subIssues = await Promise.all(
      subRefs.map((sub) => github.issueOf(sub)),
    );
    const order = judgingOrderOf(comments, developer);
    const pieces = subIssues.filter(({ labels }) =>
      labels.includes(closeOutLabels.piece),
    );
    const readComments = readCommandOf(spec, "--comments");
    const parentText =
      parent === undefined ? "none" : this._refOf(spec, parent.issue);
    const pieceRefs = pieces.map(({ issue }) => this._refOf(spec, issue));
    return [
      `# ${spec.repo} ${this._headlineOf(tracked)}`,
      `State: ${stateWordOf(tracked.isOpen)}`,
      `Labels: ${listOf(tracked.labels)}`,
      `Parent: ${parentText}`,
      `Piece ticket: ${pieceTicketTextOf(pieceRefs)}`,
      "",
      "## Sub-issues",
      "",
      ...(subIssues.length === 0
        ? ["None."]
        : subIssues.map(
            (sub) => `- ${this._headlineOf(sub)}: ${stateWordOf(sub.isOpen)}`,
          )),
      "",
      "## Items to judge, in judging order",
      "",
      ...(order.items.length === 0
        ? ["None."]
        : order.items.flatMap((item, index) => [
            ...(index === 0 ? [] : [""]),
            ...itemLinesOf(item),
          ])),
      "",
      "## Left out",
      "",
      `Decided items: ${order.decidedCount}, not printed; ${readComments} reads them`,
      othersCommentsLineOf(spec, order.othersCommentCount),
      "",
      `It holds everything /judge-findings' step 1 needs for ${issueRef.labelOf(spec)}; don't read the spec, its sub-issues or its comments again.`,
    ];
  }

  private _refOf(spec: IssueRef, ref: IssueRef): string {
    const { githubOwner } = this.config;
    return refLabelOf({ ref, seenFrom: spec, githubOwner });
  }

  // TrackedIssue carries no title rename, so a title reads as its issue's author's.
  private _headlineOf(issue: TrackedIssue): string {
    return briefHeadlineOf(this.config.developer, {
      ...issue,
      titleRenamer: undefined,
    });
  }
}

function itemLinesOf({
  id,
  state,
  halts,
  comment,
  lines,
}: JudgingItem): string[] {
  const adjacency =
    halts.length === 0 ? [] : [`Halt-adjacent: ${halts.join(", ")}`];
  return [
    `### ${[id, state, ...adjacency].join(" · ")}`,
    `Comment: ${comment.id} ${comment.url}`,
    "",
    ...lines,
  ];
}
