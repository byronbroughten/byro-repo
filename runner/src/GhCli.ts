// The run loop's and wrap-up's GitHub port over the `gh` CLI. WrapUp.ts retries each call; this only maps gh's output.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { lines } from "./git.ts";
import type {
  BodyAuthorship,
  IssueSource,
  ReadableIssue,
} from "./IssueReader.ts";
import { issueLabelOf, type IssueRef } from "./IssueWorkspaces.ts";
import type { IssueComment, RunGitHub, TrackedIssue } from "./SpecRun.ts";
import type { ParentIssue } from "./WrapUp.ts";

const execFileAsync = promisify(execFile);

// GraphQL, because `gh issue view --json` exposes no body editors.
const trackedIssueFields = `number title state body url
      author { login }
      labels(first: 100) { nodes { name } }
      userContentEdits(first: 100) { pageInfo { hasNextPage } nodes { editor { login } } }`;
const readableIssueFields = `${trackedIssueFields}
      parent { number repository { name } }
      subIssues(first: 100) { nodes { number repository { name } } }
      comments(first: 100) { pageInfo { hasNextPage } nodes { author { login } body } }`;

interface RawLogin {
  login?: unknown;
}

interface RawRef {
  number?: unknown;
  repository?: { name?: unknown };
}

interface RawPage {
  pageInfo?: { hasNextPage?: unknown };
}

interface RawIssueResponse {
  data?: { repository?: { issue?: RawIssue | null } };
}

interface RawIssue {
  number?: unknown;
  title?: unknown;
  state?: unknown;
  body?: unknown;
  url?: unknown;
  author?: RawLogin | null;
  labels?: { nodes?: { name?: unknown }[] };
  parent?: RawRef | null;
  subIssues?: { nodes?: RawRef[] };
  userContentEdits?: RawPage & { nodes?: { editor?: RawLogin | null }[] };
  comments?: RawPage & {
    nodes?: { author?: RawLogin | null; body?: unknown }[];
  };
}

interface RawParent {
  number?: unknown;
  repository_url?: unknown;
  labels?: { name?: unknown }[];
}

interface RawComments {
  comments?: { id?: unknown; author?: RawLogin | null; body?: unknown }[];
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
    const raw = await this._rawIssueOf(issue, trackedIssueFields);
    return {
      issue,
      title: String(raw.title),
      body: String(raw.body),
      isOpen: raw.state === "OPEN",
      labels: labelsOfRaw(raw),
      url: String(raw.url),
      ...authorshipOfRaw(issue, raw),
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

  async commentsOf(issue: IssueRef): Promise<string[]> {
    return (await this.authoredCommentsOf(issue)).map(({ body }) => body);
  }

  async authoredCommentsOf({
    repo,
    number,
  }: IssueRef): Promise<IssueComment[]> {
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
    return (comments ?? []).flatMap(({ id, author, body }) => {
      if (typeof body !== "string") return [];
      return [{ id: String(id), author: String(author?.login ?? ""), body }];
    });
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
    const raw = JSON.parse(output) as RawParent;
    const issue = {
      repo: repoOfUrl(raw.repository_url),
      number: Number(raw.number),
    };
    // Counted from each sub-issue's state: the stored sub_issues_summary lags a close made just before.
    const subIssues = await listedIssuesOf(
      `repos/${this.owner}/${issue.repo}/issues/${issue.number}/sub_issues`,
    );
    return {
      issue,
      labels: (raw.labels ?? []).map((label) => String(label.name)),
      subIssues: {
        total: subIssues.length,
        completed: subIssues.filter(({ isOpen }) => !isOpen).length,
      },
    };
  }

  async readableIssueOf(issue: IssueRef): Promise<ReadableIssue> {
    const raw = await this._rawIssueOf(issue, readableIssueFields);
    return readableOfRaw(issue, raw);
  }

  private async _rawIssueOf(
    issue: IssueRef,
    fields: string,
  ): Promise<RawIssue> {
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
      `query=${issueQueryOf(fields)}`,
    );
    const { data } = JSON.parse(output) as RawIssueResponse;
    const raw = data?.repository?.issue;
    if (!raw) throw new Error(`No issue ${issueLabelOf(issue)}`);
    return raw;
  }
}

function issueQueryOf(fields: string): string {
  return `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      ${fields}
    }
  }
}`;
}

function labelsOfRaw(raw: RawIssue): string[] {
  return (raw.labels?.nodes ?? []).map((label) => String(label.name));
}

// An unseen editor could be anyone, so a page left unread refuses rather than passes.
function authorshipOfRaw(
  issue: IssueRef,
  { author, userContentEdits }: RawIssue,
): BodyAuthorship {
  if (userContentEdits?.pageInfo?.hasNextPage) {
    throw new Error(overflowMessageOf(issue, "body edits"));
  }
  return {
    author: loginOf(author),
    bodyEditors: (userContentEdits?.nodes ?? []).map(({ editor }) =>
      loginOf(editor),
    ),
  };
}

function overflowMessageOf(issue: IssueRef, part: string): string {
  return `${issueLabelOf(issue)} has over 100 ${part}, more than the reader reads`;
}

function readableOfRaw(issue: IssueRef, raw: RawIssue): ReadableIssue {
  const { comments } = raw;
  if (comments?.pageInfo?.hasNextPage) {
    throw new Error(overflowMessageOf(issue, "comments"));
  }
  return {
    issue,
    title: String(raw.title),
    isOpen: raw.state === "OPEN",
    labels: labelsOfRaw(raw),
    parent: raw.parent ? refOfRaw(raw.parent) : undefined,
    subIssues: (raw.subIssues?.nodes ?? []).map(refOfRaw),
    body: String(raw.body),
    ...authorshipOfRaw(issue, raw),
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
