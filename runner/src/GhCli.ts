// The run loop's and wrap-up's GitHub port over the `gh` CLI. WrapUp.ts retries each call; this only maps gh's output.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { lines } from "./git.ts";
import type { IssueSource, ReadableIssue } from "./IssueReader.ts";
import type { IssueRef } from "./IssueWorkspaces.ts";
import type { RunGitHub, TrackedIssue } from "./SpecRun.ts";
import type { ParentIssue } from "./WrapUp.ts";

const execFileAsync = promisify(execFile);

// GraphQL, because `gh issue view --json` exposes no body editors.
const readableIssueQuery = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      number title state body
      author { login }
      labels(first: 100) { nodes { name } }
      parent { number repository { name } }
      subIssues(first: 100) { nodes { number repository { name } } }
      userContentEdits(first: 100) { pageInfo { hasNextPage } nodes { editor { login } } }
      comments(first: 100) { pageInfo { hasNextPage } nodes { author { login } body } }
    }
  }
}`;

interface RawLogin {
  login?: unknown;
}

interface RawRef {
  number?: unknown;
  repository?: { name?: unknown };
}

interface RawReadableIssue {
  number?: unknown;
  title?: unknown;
  state?: unknown;
  body?: unknown;
  author?: RawLogin | null;
  labels?: { nodes?: { name?: unknown }[] };
  parent?: RawRef | null;
  subIssues?: { nodes?: RawRef[] };
  userContentEdits?: {
    pageInfo?: { hasNextPage?: unknown };
    nodes?: { editor?: RawLogin | null }[];
  };
  comments?: {
    pageInfo?: { hasNextPage?: unknown };
    nodes?: { author?: RawLogin | null; body?: unknown }[];
  };
}

interface RawParent {
  number?: unknown;
  repository_url?: unknown;
  labels?: { name?: unknown }[];
  sub_issues_summary?: { total?: unknown; completed?: unknown };
}

interface RawComments {
  comments?: { body?: unknown }[];
}

interface RawIssue {
  number?: unknown;
  title?: unknown;
  body?: unknown;
  state?: unknown;
  labels?: { name?: unknown }[];
  url?: unknown;
}

interface RawListedIssue {
  number?: unknown;
  repository_url?: unknown;
  state?: unknown;
}

export class GhCli implements RunGitHub, IssueSource {
  private readonly owner: string;

  constructor(owner: string) {
    this.owner = owner;
  }

  async issueOf(issue: IssueRef): Promise<TrackedIssue> {
    const output = await gh(
      "issue",
      "view",
      String(issue.number),
      "-R",
      `${this.owner}/${issue.repo}`,
      "--json",
      "title,body,state,labels,url",
    );
    const raw = JSON.parse(output) as RawIssue;
    return {
      issue,
      title: String(raw.title),
      body: String(raw.body),
      isOpen: raw.state === "OPEN",
      labels: (raw.labels ?? []).map((label) => String(label.name)),
      url: String(raw.url),
    };
  }

  async subIssuesOf({ repo, number }: IssueRef): Promise<IssueRef[]> {
    const listed = await listedIssuesOf(
      `repos/${this.owner}/${repo}/issues/${number}/sub_issues`,
    );
    return listed.map(({ issue }) => issue);
  }

  async openBlockersOf({ repo, number }: IssueRef): Promise<IssueRef[]> {
    const listed = await listedIssuesOf(
      `repos/${this.owner}/${repo}/issues/${number}/dependencies/blocked_by`,
    );
    return listed.flatMap(({ issue, isOpen }) => (isOpen ? [issue] : []));
  }

  async comment({ repo, number }: IssueRef, body: string): Promise<void> {
    await gh(
      "issue",
      "comment",
      String(number),
      "-R",
      `${this.owner}/${repo}`,
      "--body",
      body,
    );
  }

  async closeIssue({ repo, number }: IssueRef, comment: string): Promise<void> {
    await gh(
      "issue",
      "close",
      String(number),
      "-R",
      `${this.owner}/${repo}`,
      "--comment",
      comment,
    );
  }

  async commentsOf({ repo, number }: IssueRef): Promise<string[]> {
    const output = await gh(
      "issue",
      "view",
      String(number),
      "-R",
      `${this.owner}/${repo}`,
      "--json",
      "comments",
    );
    const { comments } = JSON.parse(output) as RawComments;
    return (comments ?? []).flatMap(({ body }) =>
      typeof body === "string" ? [body] : [],
    );
  }

  // GitHub answers 404 for an issue with no parent.
  async parentOf({ repo, number }: IssueRef): Promise<ParentIssue | undefined> {
    let output: string;
    try {
      output = await gh(
        "api",
        `repos/${this.owner}/${repo}/issues/${number}/parent`,
      );
    } catch (error) {
      if (String((error as { stderr?: unknown }).stderr).includes("HTTP 404")) {
        return undefined;
      }
      throw error;
    }
    return parentIssueOf(JSON.parse(output) as RawParent);
  }

  async readableIssueOf(issue: IssueRef): Promise<ReadableIssue> {
    const output = await gh(
      "api",
      "graphql",
      "-F",
      `owner=${this.owner}`,
      "-F",
      `repo=${issue.repo}`,
      "-F",
      `number=${issue.number}`,
      "-f",
      `query=${readableIssueQuery}`,
    );
    const raw = (
      JSON.parse(output) as {
        data?: { repository?: { issue?: RawReadableIssue | null } };
      }
    ).data?.repository?.issue;
    if (!raw) throw new Error(`No issue ${issue.repo}#${issue.number}`);
    return readableIssueOf(issue, raw);
  }
}

// An unseen editor could be anyone, so a page left unread refuses rather than passes.
function readableIssueOf(
  issue: IssueRef,
  raw: RawReadableIssue,
): ReadableIssue {
  const { userContentEdits, comments } = raw;
  if (
    userContentEdits?.pageInfo?.hasNextPage ||
    comments?.pageInfo?.hasNextPage
  ) {
    throw new Error(
      `${issue.repo}#${issue.number} has over 100 body edits or comments, more than the reader reads`,
    );
  }
  return {
    issue,
    title: String(raw.title),
    isOpen: raw.state === "OPEN",
    labels: (raw.labels?.nodes ?? []).map((label) => String(label.name)),
    parent: raw.parent ? refOfRaw(raw.parent) : undefined,
    subIssues: (raw.subIssues?.nodes ?? []).map(refOfRaw),
    body: String(raw.body),
    author: loginOf(raw.author),
    bodyEditors: (userContentEdits?.nodes ?? []).map(({ editor }) =>
      loginOf(editor),
    ),
    comments: (comments?.nodes ?? []).map((comment) => ({
      author: loginOf(comment.author),
      body: String(comment.body),
    })),
  };
}

function refOfRaw(raw: RawRef): IssueRef {
  return { repo: String(raw.repository?.name), number: Number(raw.number) };
}

// GitHub gives a deleted account no login; "ghost" is the name it shows for one.
function loginOf(raw: RawLogin | null | undefined): string {
  return typeof raw?.login === "string" ? raw.login : "ghost";
}

// One JSON object per line, so every page of a paginated list parses.
async function listedIssuesOf(
  path: string,
): Promise<{ issue: IssueRef; isOpen: boolean }[]> {
  const output = await gh(
    "api",
    "--paginate",
    path,
    "--jq",
    ".[] | {number, repository_url, state}",
  );
  return lines(output.trim()).map((line) => {
    const raw = JSON.parse(line) as RawListedIssue;
    return {
      issue: {
        repo: repoOfUrl(raw.repository_url),
        number: Number(raw.number),
      },
      isOpen: raw.state === "open",
    };
  });
}

async function gh(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("gh", args);
  return stdout;
}

function repoOfUrl(repositoryUrl: unknown): string {
  return String(repositoryUrl).split("/").at(-1) ?? "";
}

function parentIssueOf(raw: RawParent): ParentIssue {
  const repo = repoOfUrl(raw.repository_url);
  const { total, completed } = raw.sub_issues_summary ?? {};
  return {
    issue: { repo, number: Number(raw.number) },
    labels: (raw.labels ?? []).map((label) => String(label.name)),
    subIssues:
      typeof total === "number" && typeof completed === "number"
        ? { total, completed }
        : undefined,
  };
}
