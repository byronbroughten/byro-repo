// The issue reader behind `npm run issue:read`: prints an issue with each part labelled Trusted text or Untrusted text.
// The rule: a body is Trusted when the owner wrote it and every edit was the owner's; a comment, by its author alone.
// The real source is GhCli.ts over GraphQL, since `gh issue view --json` shows no editors; tests use FakeIssueSource.ts.
// The script is scripts/runner/issueRead.ts; the terms are in runner/GLOSSARY.md.

import type { IssueRef } from "./IssueWorkspaces.ts";

const usage =
  "Usage: npm run issue:read -- <repo> <n> [--body] [--comments] [--hide-others]";
const knownFlags = ["--body", "--comments", "--hide-others"];

export interface IssueComment {
  author: string;
  body: string;
}

export interface ReadableIssue {
  issue: IssueRef;
  title: string;
  isOpen: boolean;
  labels: string[];
  parent: IssueRef | undefined;
  subIssues: IssueRef[];
  body: string;
  author: string;
  bodyEditors: string[];
  comments: IssueComment[];
}

export interface IssueSource {
  readableIssueOf(issue: IssueRef): Promise<ReadableIssue>;
}

export interface IssueReaderConfig {
  source: IssueSource;
  owner: string;
  allowedRepos: string[];
}

export class IssueReader {
  private readonly config: IssueReaderConfig;

  constructor(config: IssueReaderConfig) {
    this.config = config;
  }

  static init(config: IssueReaderConfig): IssueReader {
    return new IssueReader(config);
  }

  async read(args: string[]): Promise<string> {
    const [repo, number, ...flags] = args;
    if (repo === undefined || !/^\d+$/.test(number ?? "")) {
      throw new Error(usage);
    }
    const { allowedRepos } = this.config;
    if (!allowedRepos.includes(repo)) {
      throw new Error(
        `Repo "${repo}" is not one of ${allowedRepos.join(", ")}`,
      );
    }
    const unknown = flags.find((flag) => !knownFlags.includes(flag));
    if (unknown !== undefined) {
      throw new Error(`Unknown flag "${unknown}"; ${usage}`);
    }
    const issue = await this.config.source.readableIssueOf({
      repo,
      number: Number(number),
    });
    const printsBody = flags.includes("--body");
    const printsComments = flags.includes("--comments");
    const printed = shortPartsOf(issue);
    if (printsBody || !printsComments) {
      printed.push("", ...this._bodyOf(issue));
    }
    if (printsComments || !printsBody) {
      const hidesOthers = flags.includes("--hide-others");
      printed.push("", ...this._commentsOf(issue, hidesOthers));
    }
    return printed.join("\n");
  }

  private _bodyOf({ body, author, bodyEditors }: ReadableIssue): string[] {
    const { owner } = this.config;
    const others: string[] = [];
    if (author !== owner) others.push(`written by ${author}`);
    const editors = [...new Set(bodyEditors)].filter(
      (editor) => editor !== owner && editor !== author,
    );
    if (editors.length > 0) others.push(`edited by ${editors.join(", ")}`);
    if (others.length === 0) return trustedPart("## Body", body);
    return untrustedPart("## Body", others.join("; "), body);
  }

  // Numbered in thread order, so splitting the thread by author keeps where each comment sat.
  private _commentsOf(
    { comments }: ReadableIssue,
    hidesOthers: boolean,
  ): string[] {
    const { owner } = this.config;
    const numbered = comments.map((comment, index) => ({
      ...comment,
      heading: `### Comment ${index + 1}`,
    }));
    const owners = numbered.filter(({ author }) => author === owner);
    const others = numbered.filter(({ author }) => author !== owner);
    const printed = [`## Comments by ${owner} (Trusted text)`];
    if (owners.length === 0) printed.push("", "None.");
    owners.forEach(({ heading, body }) => printed.push("", heading, "", body));
    if (hidesOthers) {
      printed.push(
        "",
        `Comments by others: ${others.length} hidden (Untrusted text)`,
      );
      return printed;
    }
    printed.push("", "## Comments by others");
    if (others.length === 0) printed.push("", "None.");
    others.forEach(({ heading, author, body }) =>
      printed.push("", ...untrustedPart(heading, `written by ${author}`, body)),
    );
    return printed;
  }
}

function trustedPart(heading: string, text: string): string[] {
  return [`${heading} (Trusted text)`, "", text];
}

// Quoting every line keeps Untrusted text from printing a heading that passes for one of ours.
function untrustedPart(heading: string, whose: string, text: string): string[] {
  const quoted = text.split("\n").map((line) => `> ${line}`);
  return [`${heading} (Untrusted text: ${whose})`, "", ...quoted];
}

function shortPartsOf(issue: ReadableIssue): string[] {
  const { repo } = issue.issue;
  const subIssues = issue.subIssues.map((sub) => refOf(sub, repo));
  return [
    `#${issue.issue.number} ${issue.title}`,
    `State: ${issue.isOpen ? "open" : "closed"}`,
    `Labels: ${listOf(issue.labels)}`,
    `Parent: ${issue.parent ? refOf(issue.parent, repo) : "none"}`,
    `Sub-issues: ${listOf(subIssues)}`,
  ];
}

// A ref in the issue's own repo prints bare, as GitHub writes it.
function refOf(ref: IssueRef, repo: string): string {
  return ref.repo === repo ? `#${ref.number}` : `${ref.repo}#${ref.number}`;
}

function listOf(items: string[]): string {
  return items.length === 0 ? "none" : items.join(", ");
}
