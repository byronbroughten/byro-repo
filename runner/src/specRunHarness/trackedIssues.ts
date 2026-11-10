// The tracked issues SpecRun tests give a FakeGitHub, and Workflow tests pick from; ../specRunHarness.ts adds them.

import type { TrackedIssue } from "../SpecRun/runState.ts";

export const trackedIssues = {
  issueOf(
    number: number,
    { labels, body }: { labels: string[]; body: string },
  ): TrackedIssue {
    return {
      issue: { repo: "byro-repo", number },
      title: `Ticket ${number}`,
      body,
      isOpen: true,
      labels,
      url: `https://github.com/byronbroughten/byro-repo/issues/${number}`,
      author: "byronbroughten",
      bodyEditors: [],
    };
  },
};
