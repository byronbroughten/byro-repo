import type { IssueSource, ReadableIssue } from "./IssueReader.ts";
import type { IssueRef } from "./IssueWorkspaces.ts";

// The issue source reader tests script; issues are keyed by number, so one fake serves one repo.
export class FakeIssueSource implements IssueSource {
  readonly issues = new Map<number, ReadableIssue>();

  static init(): FakeIssueSource {
    return new FakeIssueSource();
  }

  async readableIssueOf({ number }: IssueRef): Promise<ReadableIssue> {
    const issue = this.issues.get(number);
    if (!issue) throw new Error(`No issue #${number}`);
    return issue;
  }
}
