import { describe, expect, it } from "vitest";

import { GhCli } from "./GhCli.ts";

const issue = { repo: "sheets-framework", number: 165 };
const blockers = `{"number":7,"repository_url":"https://api.github.com/repos/o/sheets-framework","state":"open"}\n`;

function ghError(stderr: string): Error {
  return Object.assign(new Error("Command failed: gh"), { stderr });
}

function scriptedGh(answers: (string | Error)[]) {
  const calls: string[][] = [];
  const run = async (...args: string[]): Promise<string> => {
    calls.push(args);
    const answer = answers.shift();
    if (answer === undefined) throw new Error("No scripted answer");
    if (answer instanceof Error) throw answer;
    return answer;
  };
  const waits: number[] = [];
  const wait = async (ms: number): Promise<void> => {
    waits.push(ms);
  };
  return { calls, waits, cli: new GhCli("o", run, wait) };
}

describe("GhCli reads", () => {
  it("retries a 5xx and returns the data", async () => {
    const { cli, waits } = scriptedGh([
      ghError("gh: HTTP 504: Gateway Timeout"),
      blockers,
    ]);
    expect(await cli.openBlockersOf(issue)).toEqual([
      { repo: "sheets-framework", number: 7 },
    ]);
    expect(waits).toEqual([2000]);
  });

  it("retries a network error and returns the data", async () => {
    const { cli } = scriptedGh([
      ghError(
        "error connecting to api.github.com\ncheck your internet connection",
      ),
      blockers,
    ]);
    expect(await cli.subIssuesOf(issue)).toHaveLength(1);
  });

  it("reads a repo's visibility from its private flag", async () => {
    const { cli, calls } = scriptedGh(["true\n", "false\n"]);
    expect(await cli.visibilityOf("personal")).toBe("private");
    expect(await cli.visibilityOf("sheets-framework")).toBe("public");
    expect(calls[0]).toEqual(["api", "repos/o/personal", "--jq", ".private"]);
  });

  it("searches open issues' comments for the quoted phrase", async () => {
    const { cli, calls } = scriptedGh([
      ghError("HTTP 502"),
      '[{"number":12},{"number":4}]',
    ]);
    expect(
      await cli.openIssuesCommentedWith("sheets-framework", "Review list"),
    ).toEqual([
      { repo: "sheets-framework", number: 12 },
      { repo: "sheets-framework", number: 4 },
    ]);
    expect(calls[1]).toEqual([
      "search",
      "issues",
      '"Review list"',
      "--repo",
      "o/sheets-framework",
      "--state",
      "open",
      "--match",
      "comments",
      "--limit",
      "1000",
      "--json",
      "number",
    ]);
  });

  it("lists a repo's open issues by label", async () => {
    const { cli, calls } = scriptedGh([
      ghError("HTTP 502"),
      '[{"number":12},{"number":4}]',
    ]);
    expect(
      await cli.openIssuesLabelled("sheets-framework", "ready-for-agent"),
    ).toEqual([
      { repo: "sheets-framework", number: 12 },
      { repo: "sheets-framework", number: 4 },
    ]);
    expect(calls[1]).toEqual([
      "issue",
      "list",
      "-R",
      "o/sheets-framework",
      "--label",
      "ready-for-agent",
      "--state",
      "open",
      "--limit",
      "1000",
      "--json",
      "number",
    ]);
  });

  it("throws the last error after four tries", async () => {
    const { cli, calls, waits } = scriptedGh([
      ghError("HTTP 502"),
      ghError("HTTP 503"),
      ghError("HTTP 504"),
      ghError("HTTP 500"),
    ]);
    await expect(cli.openBlockersOf(issue)).rejects.toMatchObject({
      stderr: "HTTP 500",
    });
    expect(calls).toHaveLength(4);
    expect(waits).toEqual([2000, 8000, 30000]);
  });

  it("throws a non-transient error without retrying", async () => {
    const { cli, calls } = scriptedGh([ghError("HTTP 401: Bad credentials")]);
    await expect(cli.openBlockersOf(issue)).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it("carries each comment's URL on a readable issue", async () => {
    const commentUrl =
      "https://github.com/o/sheets-framework/issues/165#issuecomment-1";
    const response = {
      data: {
        repository: {
          issue: {
            title: "Read issues",
            body: "Build the reader.",
            state: "OPEN",
            author: { login: "developer" },
            comments: {
              nodes: [
                {
                  author: { login: "developer" },
                  body: "Done.",
                  url: commentUrl,
                },
              ],
            },
          },
        },
      },
    };
    const { cli } = scriptedGh([JSON.stringify(response)]);

    const { comments } = await cli.readableIssueOf(issue);

    expect(comments).toEqual([
      { author: "developer", body: "Done.", url: commentUrl },
    ]);
  });

  it("reads a readable issue's assignees and blocked-by edges with each blocker's state", async () => {
    const response = {
      data: {
        repository: {
          issue: {
            title: "Read issues",
            body: "Build the reader.",
            state: "OPEN",
            author: { login: "developer" },
            assignees: { nodes: [{ login: "developer" }] },
            blockedBy: {
              nodes: [
                { number: 3, state: "OPEN", repository: { name: "byro-repo" } },
                {
                  number: 4,
                  state: "CLOSED",
                  repository: { name: "sheets-framework" },
                },
              ],
            },
          },
        },
      },
    };
    const { cli } = scriptedGh([JSON.stringify(response)]);

    const { assignees, blockedBy } = await cli.readableIssueOf(issue);

    expect(assignees).toEqual(["developer"]);
    expect(blockedBy).toEqual([
      { issue: { repo: "byro-repo", number: 3 }, isOpen: true },
      { issue: { repo: "sheets-framework", number: 4 }, isOpen: false },
    ]);
  });
});

describe("GhCli writes", () => {
  it("calls a write that gets a 504 once and throws", async () => {
    const { cli, calls } = scriptedGh([ghError("HTTP 504"), "url"]);
    await expect(cli.comment(issue, "hi")).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it("creates an issue with each label and reads its number off the printed URL", async () => {
    const { cli, calls } = scriptedGh([
      "https://github.com/o/sheets-framework/issues/812\n",
    ]);
    expect(
      await cli.createIssue("sheets-framework", {
        title: "File tickets",
        body: "Body",
        labels: ["ready-for-agent", "runner"],
      }),
    ).toEqual({ repo: "sheets-framework", number: 812 });
    expect(calls[0]).toEqual([
      "issue",
      "create",
      "-R",
      "o/sheets-framework",
      "--title",
      "File tickets",
      "--body",
      "Body",
      "--label",
      "ready-for-agent",
      "--label",
      "runner",
    ]);
  });

  it("links a sub-issue and a blocker by the database id it reads first", async () => {
    const { cli, calls } = scriptedGh(["9001\n", "{}", "9002\n", "{}"]);
    await cli.addSubIssue(issue, { repo: "sheets-framework", number: 166 });
    await cli.addBlocker(issue, { repo: "sheets-framework", number: 167 });
    expect(calls).toEqual([
      ["api", "repos/o/sheets-framework/issues/166", "--jq", ".id"],
      [
        "api",
        "--method",
        "POST",
        "repos/o/sheets-framework/issues/165/sub_issues",
        "-F",
        "sub_issue_id=9001",
      ],
      ["api", "repos/o/sheets-framework/issues/167", "--jq", ".id"],
      [
        "api",
        "--method",
        "POST",
        "repos/o/sheets-framework/issues/165/dependencies/blocked_by",
        "-F",
        "issue_id=9002",
      ],
    ]);
  });

  it("edits a comment by the node id its comments read gives, once", async () => {
    const { cli, calls } = scriptedGh([ghError("HTTP 504")]);
    await expect(cli.editComment("IC_kw1", "- [x] done")).rejects.toThrow();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(
      expect.arrayContaining(["id=IC_kw1", "body=- [x] done"]),
    );
  });
});
