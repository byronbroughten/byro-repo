// The one reader and writer of a ticket's facts file, .runner/<repo>-<n>.facts.json in the state folder.
// The runner writes it during a run (SpecRun.ts), and an interactive session's tooling and wrap-up's closing
// arguments during that session; an agent never does. WrapUp.ts reads it to land the ticket and derives the branches itself.
// Each setter replaces its own group of facts and leaves the others as they are; a missing file starts empty,
// so a session can be added before any other fact exists. The sessions' shape is transcriptFacts.ts.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { fileStemOf, issueLabelOf, type IssueRef } from "./IssueWorkspaces.ts";
import type { OutcomeFacts } from "./outcomeLog.ts";
import type { Finding } from "./reviewStep.ts";
import { factsOf } from "./savedFormats.ts";
import type { RecordedSession, TicketSessions } from "./transcriptFacts.ts";

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
  closingComment: string;
  boxesUndone?: UndoneBox[];
  githubWrites?: GitHubWrite[];
  // What the runner recorded; facts computed from them win over passed ones.
  sessions?: TicketSessions;
  // A session's review whose findings the session is resolving itself.
  pendingResolve?: PendingResolve;
}

export interface PendingResolve {
  findings: Finding[];
  // Each branched clone's head when the review ended, which the session's Fix commits are checked against.
  base: Record<string, string>;
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

  // Wrap-up's CLI is this check's only caller, so the failure names its flag for the agent to add.
  read(issue: IssueRef): WrapUpFacts {
    const facts = this._storedOf(issue);
    if (typeof facts.closingComment !== "string") {
      throw new Error(
        `${issueLabelOf(issue)} has no closing comment in ${this._pathOf(issue)}: pass it to wrap-up with --closing "…"`,
      );
    }
    return facts as WrapUpFacts;
  }

  sessionsOf(issue: IssueRef): TicketSessions | undefined {
    return this._storedOf(issue).sessions;
  }

  write(issue: IssueRef, facts: WrapUpFacts): FactsFile {
    return this._store(issue, facts);
  }

  addSession(issue: IssueRef, session: RecordedSession): FactsFile {
    const facts = this._storedOf(issue);
    const steps = facts.sessions?.steps ?? [];
    const isRecorded = steps.some(
      ({ agent, sessionId }) =>
        agent === session.agent && sessionId === session.sessionId,
    );
    return this._store(issue, {
      ...facts,
      sessions: { steps: isRecorded ? steps : [...steps, session] },
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

  pendingResolveOf(issue: IssueRef): PendingResolve | undefined {
    return this._storedOf(issue).pendingResolve;
  }

  // Undefined clears it, once the session's records pass.
  setPendingResolve(
    issue: IssueRef,
    pendingResolve: PendingResolve | undefined,
  ): FactsFile {
    return this._store(issue, { ...this._storedOf(issue), pendingResolve });
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
    return factsOf(JSON.parse(readFileSync(path, "utf8")));
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
