// `runner judge-brief`: prints, for each spec named or every one `runner judgeable` lists, all /judge-findings' step 1
// reads, so the skill gets it by injection in one call.
// The items and counts are reviewList.ts's judgingOrderOf; the spec list for `all` is JudgeableIssueLister.ts's.
// Titles come through the readable issue, so a title someone else wrote or renamed is named, never printed.
// It prints only Trusted text, never a Halt's or the spec's body, and words every failure itself, so a brief never
// throws. SpecRun.ts delegates here.

import {
  closeOutLabels,
  closeOutWords,
} from "../CloseOutBrief/closeOutWords.ts";
import { messageOf } from "../failureText.ts";
import {
  briefHeadlineOf,
  listOf,
  othersCommentsLineOf,
  type ReadableIssue,
  readCommandOf,
  refLabelOf,
  stateWordOf,
} from "../IssueReader.ts";
import { type IssueRef, issueRef } from "../IssueWorkspaces.ts";
import {
  type JudgingItem,
  type JudgingOrder,
  judgingOrderOf,
} from "../reviewList.ts";
import { JudgeableIssueLister } from "./JudgeableIssueLister.ts";
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
    const [read, comments] = await Promise.all([
      github.readableIssueOf(spec),
      github.authoredCommentsOf(spec),
    ]);
    const subIssues = await Promise.all(
      read.subIssues.map((sub) => github.readableIssueOf(sub)),
    );
    const order = judgingOrderOf(comments, developer);
    return [
      ...this._headerOf(read, subIssues),
      "",
      ...sectionOf(
        "## Sub-issues",
        subIssues.map((sub) => this._subIssueLineOf(sub)),
      ),
      "",
      ...sectionOf("## Items to judge, in judging order", itemsOf(order)),
      "",
      ...leftOutOf(spec, order),
      "",
      `It holds everything /judge-findings' step 1 needs for ${issueRef.labelOf(spec)}; don't read the spec, its sub-issues or its comments again.`,
    ];
  }

  private _headerOf(read: ReadableIssue, subIssues: ReadableIssue[]): string[] {
    const spec = read.issue;
    let parent = "none";
    if (read.parent !== undefined) parent = this._refOf(spec, read.parent);
    const pieceRefs = subIssues
      .filter(({ labels }) => labels.includes(closeOutLabels.piece))
      .map(({ issue }) => this._refOf(spec, issue));
    return [
      `# ${spec.repo} ${briefHeadlineOf(this.config.developer, read)}`,
      `State: ${stateWordOf(read.isOpen)}`,
      `Labels: ${listOf(read.labels)}`,
      `Parent: ${parent}`,
      `Piece ticket: ${closeOutWords.pieceTicketOf(pieceRefs)}`,
    ];
  }

  private _subIssueLineOf(sub: ReadableIssue): string {
    const headline = briefHeadlineOf(this.config.developer, sub);
    return `- ${headline}: ${stateWordOf(sub.isOpen)}`;
  }

  private _refOf(spec: IssueRef, ref: IssueRef): string {
    const { githubOwner } = this.config;
    return refLabelOf({ ref, seenFrom: spec, githubOwner });
  }
}

// An empty section says "None." under its heading.
function sectionOf(heading: string, lines: string[]): string[] {
  if (lines.length === 0) return [heading, "", "None."];
  return [heading, "", ...lines];
}

function itemsOf({ items }: JudgingOrder): string[] {
  return items.flatMap((item, index) => [
    ...(index === 0 ? [] : [""]),
    ...itemLinesOf(item),
  ]);
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

function leftOutOf(spec: IssueRef, order: JudgingOrder): string[] {
  const readComments = readCommandOf(spec, "--comments");
  return [
    "## Left out",
    "",
    `Decided items: ${order.decidedCount}, not printed; ${readComments} reads them`,
    othersCommentsLineOf(spec, order.othersCommentCount),
  ];
}
