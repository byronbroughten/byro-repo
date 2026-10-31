import type { IssueRef } from "./IssueWorkspaces.ts";
import type { IssueComment, RunGitHub, TrackedIssue } from "./SpecRun.ts";
import type { ParentIssue } from "./WrapUp.ts";

// The runner posts as the developer's login, as GhCli does.
const developer = "byronbroughten";

// The GitHub port run-loop and wrap-up tests script and read back; issues are keyed by number, so one fake serves one repo.
export class FakeGitHub implements RunGitHub {
  readonly issues = new Map<number, TrackedIssue>();
  readonly subIssues = new Map<number, number[]>();
  readonly blockers = new Map<number, number[]>();
  // Set to override the parent the sub-issue map gives.
  readonly parents = new Map<number, ParentIssue>();
  readonly comments: { issue: IssueRef; body: string; author: string }[] = [];
  readonly closed: { issue: IssueRef; comment: string }[] = [];
  readonly commentEdits: { id: string; body: string }[] = [];
  // Each runs before one comment read, in order, as a hand edit made meanwhile.
  readonly beforeCommentReads: (() => void)[] = [];
  // How many calls throw a network error before one succeeds.
  failuresLeft = 0;

  static init(): FakeGitHub {
    return new FakeGitHub();
  }

  async issueOf({ number }: IssueRef): Promise<TrackedIssue> {
    this._failIfScripted();
    const issue = this.issues.get(number);
    if (!issue) throw new Error(`No issue #${number}`);
    return { ...issue, labels: [...issue.labels] };
  }

  async subIssuesOf({ repo, number }: IssueRef): Promise<IssueRef[]> {
    this._failIfScripted();
    return (this.subIssues.get(number) ?? []).map((sub) => ({
      repo,
      number: sub,
    }));
  }

  async openBlockersOf({ repo, number }: IssueRef): Promise<IssueRef[]> {
    this._failIfScripted();
    return (this.blockers.get(number) ?? [])
      .filter((blocker) => this.issues.get(blocker)?.isOpen)
      .map((blocker) => ({ repo, number: blocker }));
  }

  async comment(issue: IssueRef, body: string): Promise<string> {
    this._failIfScripted();
    this.comments.push({ issue, body, author: developer });
    return commentUrlOf(issue, this.comments.length);
  }

  // A comment someone other than the runner posts, such as the developer's answer to a Halt.
  reply(number: number, body: string, author = developer): void {
    this.comments.push({ issue: { repo: "byro-repo", number }, body, author });
  }

  async closeIssue(issue: IssueRef, comment: string): Promise<void> {
    this._failIfScripted();
    this.closed.push({ issue, comment });
    if (this.issues.has(issue.number)) {
      this.edit(issue.number, { isOpen: false });
    }
  }

  async parentOf({ repo, number }: IssueRef): Promise<ParentIssue | undefined> {
    this._failIfScripted();
    const scripted = this.parents.get(number);
    if (scripted) return scripted;
    for (const [parent, tickets] of this.subIssues) {
      if (!tickets.includes(number)) continue;
      const completed = tickets.filter(
        (ticket) => !this.issues.get(ticket)?.isOpen,
      ).length;
      return {
        issue: { repo, number: parent },
        labels: [],
        subIssues: { total: tickets.length, completed },
      };
    }
    return undefined;
  }

  async commentsOf({ number }: IssueRef): Promise<string[]> {
    this._failIfScripted();
    return this.comments
      .filter(({ issue }) => issue.number === number)
      .map(({ body }) => body);
  }

  async authoredCommentsOf({ number }: IssueRef): Promise<IssueComment[]> {
    this._failIfScripted();
    this.beforeCommentReads.shift()?.();
    return this.comments.flatMap(({ issue, body, author }, index) => {
      if (issue.number !== number) return [];
      return [{ id: commentIdOf(index), author, body }];
    });
  }

  async editComment(id: string, body: string): Promise<void> {
    this._failIfScripted();
    const comment = this.comments.find((_, index) => commentIdOf(index) === id);
    if (!comment) throw new Error(`No comment ${id}`);
    comment.body = body;
    this.commentEdits.push({ id, body });
  }

  edit(number: number, change: Partial<TrackedIssue>): void {
    const issue = this.issues.get(number);
    if (!issue) throw new Error(`No issue #${number}`);
    this.issues.set(number, { ...issue, ...change });
  }

  private _failIfScripted(): void {
    if (this.failuresLeft === 0) return;
    this.failuresLeft -= 1;
    throw new Error("gh: connection reset");
  }
}

function commentIdOf(index: number): string {
  return `comment-${index + 1}`;
}

export function commentUrlOf(
  { repo, number }: IssueRef,
  index: number,
): string {
  return `https://github.com/o/${repo}/issues/${number}#issuecomment-${index}`;
}
