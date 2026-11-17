import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { CloseOutChecker } from "./CloseOutBrief/CloseOutChecker.ts";
import {
  closeOutLabels,
  closeOutWords,
} from "./CloseOutBrief/closeOutWords.ts";
import {
  CloseOutWriter,
  type ParentLink,
  type ReadParent,
} from "./CloseOutBrief/CloseOutWriter.ts";
import { messageOf } from "./failureText.ts";
import { assertAllowedRepo, type IssueSource } from "./IssueReader.ts";
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
const { noBriefOf, nothingWritten } = closeOutWords;

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
// It prints only Trusted text; CloseOutBrief/ holds the checker, the writer and their shared words.
// The parent check is wrap-up's, in WrapUp/IssueCloser.ts. The script is scripts/runner/issueCloseParent.ts.
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
      chain: await this._chainFrom(ref, parent.isOpen),
    };
  }

  // An open issue in the chain is taken as closed, so its parent's check reads as it will once it is; a closed one is counted already.
  private async _chainFrom(
    child: IssueRef,
    isChildOpen: boolean,
  ): Promise<ParentLink[]> {
    const { github } = this.config;
    const closing = isChildOpen ? 1 : 0;
    const check = parentCheckOf(await github.parentOf(child), closing);
    const link = { child, check };
    if (check.kind !== "ready-to-close") return [link];
    const { isOpen } = await github.readableIssueOf(check.parent);
    return [link, ...(await this._chainFrom(check.parent, isOpen))];
  }

  private async _linesOf(
    read: ReadParent,
    commentFile: string | undefined,
  ): Promise<string[]> {
    const writer = new CloseOutWriter({ ...this.config, read });
    if (read.parent.labels.includes(closeOutLabels.map)) {
      return withNothingWritten([writer.mapRefusalOf()], commentFile);
    }
    const checker = new CloseOutChecker(read);
    const { refusals, editGate } = checker;
    if (refusals.undecided !== undefined || refusals.openSubIssues.length > 0) {
      return withNothingWritten(writer.refusalOf(refusals), commentFile);
    }
    if (commentFile === undefined) return writer.briefOf(editGate);
    const refusal = checker.closeRefusal;
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
      return [writer.closedWithoutCheckOf(commentFile, messageOf(error))];
    }
  }
}

function withNothingWritten(
  lines: string[],
  commentFile: string | undefined,
): string[] {
  if (commentFile === undefined) return lines;
  return [...lines, "", `With --comment-file, ${nothingWritten}.`];
}
