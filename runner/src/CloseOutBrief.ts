import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import {
  closeOutLabels,
  CloseOutWriter,
  type ParentLink,
  type ReadParent,
  type Refusals,
} from "./CloseOutBrief/CloseOutWriter.ts";
import { messageOf } from "./failureText.ts";
import {
  assertAllowedRepo,
  type IssueSource,
  type ReadableIssue,
} from "./IssueReader.ts";
import { type IssueRef, issueRef } from "./IssueWorkspaces.ts";
import {
  developersReviewListsOf,
  gapCheckSubject,
  reviewListMarkOf,
  undecidedCountOf,
} from "./reviewList.ts";
import { parentCheckOf } from "./WrapUp/IssueCloser.ts";
import type { WrapUpGitHub } from "./WrapUp/wrapUpTypes.ts";

const usage =
  "usage: npm run issue:close-parent -- <repo> <p> [--comment-file <path>]";

export type CloseOutGitHub = IssueSource &
  Pick<WrapUpGitHub, "closeIssue" | "parentOf" | "authoredCommentsOf">;

export interface CloseOutBriefConfig {
  github: CloseOutGitHub;
  developer: string;
  // Prefixes a ref in another repo.
  githubOwner: string;
  // The repo map's names, which a bare repo name must be one of, as `issue:start` takes it.
  allowedRepos: string[];
}

interface CloseOutRequest {
  parent: IssueRef;
  // Undefined for the brief alone.
  commentFile: string | undefined;
}

// `npm run issue:close-parent`'s core: a Close-out's brief of a parent, every fact it needs so the gap check is the
// one judgement left, and with `--comment-file`, the close itself, posting the file as the closing comment.
// It returns its words on every outcome, a refusal or a failed read included, so its script exits 0 and a skill can inject it.
// It prints only Trusted text; CloseOutBrief/ holds the writer. The parent check is wrap-up's, in WrapUp/IssueCloser.ts.
// The script is scripts/runner/issueCloseParent.ts.
export class CloseOutBrief {
  private readonly config: CloseOutBriefConfig;

  constructor(config: CloseOutBriefConfig) {
    this.config = config;
  }

  static init(config: CloseOutBriefConfig): CloseOutBrief {
    return new CloseOutBrief(config);
  }

  async brief(args: string[]): Promise<string> {
    let request: CloseOutRequest;
    try {
      request = this._requestOf(args);
    } catch (error) {
      return noBriefOf(messageOf(error));
    }
    let read: ReadParent;
    try {
      read = await this._readOf(request.parent);
    } catch (error) {
      return noBriefOf(
        `reading ${issueRef.labelOf(request.parent)} from GitHub failed: ${messageOf(error)}`,
      );
    }
    return (await this._linesOf(read, request.commentFile)).join("\n");
  }

  private _requestOf(args: string[]): CloseOutRequest {
    const { positionals, values } = parseArgs({
      args,
      allowPositionals: true,
      options: { "comment-file": { type: "string" } },
    });
    const [repo, number, ...rest] = positionals;
    if (repo === undefined || !/^\d+$/.test(number ?? "") || rest.length > 0) {
      throw new Error(usage);
    }
    assertAllowedRepo(repo, this.config.allowedRepos);
    return {
      parent: { repo, number: Number(number) },
      commentFile: values["comment-file"],
    };
  }

  private async _readOf(ref: IssueRef): Promise<ReadParent> {
    const { github, developer, allowedRepos } = this.config;
    const parent = await github.readableIssueOf(ref);
    const children = await Promise.all(
      parent.subIssues
        .filter(({ repo }) => allowedRepos.includes(repo))
        .map((child) => github.readableIssueOf(child)),
    );
    const lists = developersReviewListsOf(
      await github.authoredCommentsOf(ref),
      developer,
    );
    const gapCheckMark = reviewListMarkOf(gapCheckSubject);
    return {
      parent,
      children,
      undecided: undecidedCountOf(lists),
      hasGapCheck: lists.some((body) => body.includes(gapCheckMark)),
      chain: await this._chainFrom(ref),
    };
  }

  // Each issue in the chain is taken as closed, so its parent's check reads as it will once it is.
  private async _chainFrom(child: IssueRef): Promise<ParentLink[]> {
    const check = parentCheckOf(await this.config.github.parentOf(child), 1);
    const link = { child, check };
    if (check.kind !== "ready-to-close") return [link];
    return [link, ...(await this._chainFrom(check.parent))];
  }

  private async _linesOf(
    read: ReadParent,
    commentFile: string | undefined,
  ): Promise<string[]> {
    const writer = new CloseOutWriter({ ...this.config, read });
    if (read.parent.labels.includes(closeOutLabels.map)) {
      return withNothingWritten([writer.mapRefusalOf()], commentFile);
    }
    const editGate = editGateOf(read);
    const refusals = refusalsOf(read, editGate);
    if (refusals.undecided !== undefined || refusals.openSubIssues.length > 0) {
      return withNothingWritten(writer.refusalOf(refusals), commentFile);
    }
    if (commentFile === undefined) return writer.briefOf(editGate);
    const refusal = closeRefusalOf(read, editGate);
    if (refusal !== undefined) return [noBriefOf(refusal)];
    return this._close(read.parent.issue, commentFile, writer);
  }

  private async _close(
    parent: IssueRef,
    commentFile: string,
    writer: CloseOutWriter,
  ): Promise<string[]> {
    let comment: string;
    try {
      comment = readFileSync(commentFile, "utf8").trim();
    } catch (error) {
      return [
        noBriefOf(
          `reading ${commentFile} failed: ${messageOf(error)}; ${nothingWritten}`,
        ),
      ];
    }
    if (comment === "") {
      return [noBriefOf(`${commentFile} is empty; ${nothingWritten}`)];
    }
    const { github } = this.config;
    try {
      await github.closeIssue(parent, comment);
    } catch (error) {
      return [
        noBriefOf(
          `closing ${issueRef.labelOf(parent)} failed: ${messageOf(error)}`,
        ),
      ];
    }
    try {
      return writer.closedOf(
        commentFile,
        parentCheckOf(await github.parentOf(parent), 0),
      );
    } catch (error) {
      return [
        `${commandName} closed ${issueRef.labelOf(parent)} with the comment in ${commentFile}, but reading its parent check failed: ${messageOf(error)}`,
      ];
    }
  }
}

const commandName = "issue:close-parent";
const nothingWritten = "nothing was posted or closed";

// A brief's one line when it has nothing to brief, the script's own failure included.
export function noBriefOf(reason: string): string {
  return `${commandName} brief: none, ${reason}`;
}

function withNothingWritten(
  lines: string[],
  commentFile: string | undefined,
): string[] {
  if (commentFile === undefined) return lines;
  return [...lines, "", `With --comment-file, ${nothingWritten}.`];
}

// Open while every other sub-issue is closed, on a spec with a piece ticket, since `/close-project` runs its steps first.
function editGateOf({
  children,
  parent,
}: ReadParent): ReadableIssue | undefined {
  const hasPieceTicket = children.some(({ labels }) =>
    labels.includes(closeOutLabels.piece),
  );
  const open = children.filter(({ isOpen }) => isOpen);
  const [only] = open;
  if (!hasPieceTicket || open.length !== 1 || only === undefined) {
    return undefined;
  }
  if (children.length < parent.subIssues.length) return undefined;
  return only.labels.includes(closeOutLabels.human) ? only : undefined;
}

// A sub-issue outside the repo map counts as open, since its state is unread.
function refusalsOf(
  { parent, children, undecided }: ReadParent,
  editGate: ReadableIssue | undefined,
): Refusals {
  const openSubIssues = parent.subIssues.filter((ref) => {
    if (editGate !== undefined && issueRef.isSame(ref, editGate.issue)) {
      return false;
    }
    const child = children.find(({ issue }) => issueRef.isSame(issue, ref));
    return child === undefined || child.isOpen;
  });
  return {
    openSubIssues,
    undecided: undecided.items > 0 ? undecided : undefined,
  };
}

function closeRefusalOf(
  { parent }: ReadParent,
  editGate: ReadableIssue | undefined,
): string | undefined {
  const label = issueRef.labelOf(parent.issue);
  if (!parent.isOpen) return `${label} is already closed; ${nothingWritten}`;
  if (editGate === undefined) return undefined;
  const { repo, number } = editGate.issue;
  return `the Edit gate ${issueRef.labelOf(editGate.issue)} is still open: close it out first with \`/close-piece ${repo} ${number}\`; ${nothingWritten}`;
}
