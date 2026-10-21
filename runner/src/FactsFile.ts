// The one reader and writer of a ticket's facts file, .runner/<repo>-<n>.facts.json in the state folder.
// The runner writes it during a run (SpecRun.ts), and an interactive session's tooling during that session;
// an agent never does. WrapUp.ts reads it to land the ticket.
// Each setter replaces its own group of facts and leaves the others as they are; a missing file starts empty,
// so a session can be added before any other fact exists. The sessions' shape is transcriptFacts.ts.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { fileStemOf, type IssueRef } from "./IssueWorkspaces.ts";
import type { OutcomeFacts } from "./outcomeLog.ts";
import type {
  LimitReadings,
  StepSession,
  TicketSessions,
} from "./transcriptFacts.ts";

export interface LandingBranch {
  repo: string;
  branch: string;
}

export interface UndoneBox {
  box: string;
  reason: string;
}

export const gitHubWriteActions = ["edit", "comment"] as const;

export interface GitHubWrite {
  // As owner/repo#n.
  issue: string;
  action: (typeof gitHubWriteActions)[number];
  url: string;
  summary: string;
}

export interface WrapUpFacts extends OutcomeFacts {
  // In landing order: a repo lands before any repo that depends on it; empty for a ticket with no code.
  branches: LandingBranch[];
  closingComment: string;
  boxesUndone?: UndoneBox[];
  githubWrites?: GitHubWrite[];
  // What the runner recorded; facts computed from them win over passed ones.
  sessions?: TicketSessions;
  limitReadings?: LimitReadings;
}

export interface AddedSession extends Omit<TicketSessions, "steps"> {
  step: StepSession;
}

export type ReviewFacts = Pick<
  WrapUpFacts,
  "reviewFixes" | "whatReviewCaught" | "proposals"
>;

export type ClosingFacts = Pick<WrapUpFacts, "closingComment" | "boxesUndone">;

export class FactsFile {
  readonly stateFolder: string;

  constructor(stateFolder: string) {
    this.stateFolder = stateFolder;
  }

  static init(stateFolder: string): FactsFile {
    return new FactsFile(stateFolder);
  }

  read(issue: IssueRef): WrapUpFacts {
    const path = this._pathOf(issue);
    if (!existsSync(path)) throw new Error(`No facts file at ${path}`);
    const facts = parsedFactsOf(path);
    if (!Array.isArray(facts.branches)) {
      throw new Error(`${path} has no branch list`);
    }
    if (
      facts.branches.length === 0 &&
      (facts.githubWrites ?? []).length === 0
    ) {
      throw new Error(`${path} names no branches to land and no GitHub writes`);
    }
    if (typeof facts.closingComment !== "string") {
      throw new Error(`${path} has no closing comment`);
    }
    return facts as WrapUpFacts;
  }

  write(issue: IssueRef, facts: WrapUpFacts): FactsFile {
    return this._store(issue, facts);
  }

  addSession(
    issue: IssueRef,
    { account, configFolder, step }: AddedSession,
  ): FactsFile {
    const facts = this._storedOf(issue);
    const steps = facts.sessions?.steps ?? [];
    return this._store(issue, {
      ...facts,
      sessions: { account, configFolder, steps: [...steps, step] },
    });
  }

  setReviewFacts(
    issue: IssueRef,
    { reviewFixes, whatReviewCaught, proposals }: ReviewFacts,
  ): FactsFile {
    return this._store(issue, {
      ...this._storedOf(issue),
      reviewFixes,
      whatReviewCaught,
      proposals,
    });
  }

  setClosingFacts(
    issue: IssueRef,
    { closingComment, boxesUndone }: ClosingFacts,
  ): FactsFile {
    return this._store(issue, {
      ...this._storedOf(issue),
      closingComment,
      boxesUndone,
    });
  }

  private _storedOf(issue: IssueRef): Partial<WrapUpFacts> {
    const path = this._pathOf(issue);
    if (!existsSync(path)) return {};
    return parsedFactsOf(path);
  }

  private _store(issue: IssueRef, facts: Partial<WrapUpFacts>): FactsFile {
    mkdirSync(this.stateFolder, { recursive: true });
    writeFileSync(
      this._pathOf(issue),
      `${JSON.stringify(facts, undefined, 2)}\n`,
    );
    return this;
  }

  private _pathOf(issue: IssueRef): string {
    return join(this.stateFolder, `${fileStemOf(issue)}.facts.json`);
  }
}

function parsedFactsOf(path: string): Partial<WrapUpFacts> {
  // A facts file written before #297 counts Proposals under their old name.
  const { defers, ...facts } = JSON.parse(
    readFileSync(path, "utf8"),
  ) as Partial<WrapUpFacts> & { defers?: number };
  if (defers !== undefined) facts.proposals ??= defers;
  return facts;
}
