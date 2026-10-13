// The wrap-up script: lands one ticket from its facts file with no agent. It builds and checks the merge commits in the
// ticket's issue workspace, fast-forwards each primary checkout's master under its landing lock, then pushes, deletes the
// branches, removes the workspace, closes the issue and checks its parent. Steps are recorded in a progress file, so a
// rerun skips what already landed; a failure throws a WrapUpFailure naming its kind.
// The outcome row's format is outcomeLog.ts and its transcript facts are transcriptFacts.ts; the lock is LandingLock.ts;
// workspaces are IssueWorkspaces.ts.

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { messageOf, outputTailOf } from "./failureText.ts";
import { git, lines } from "./git.ts";
import {
  fileStemOf,
  issueLabelOf,
  type IssueRef,
  IssueWorkspaces,
  type IssueWorkspacesConfig,
  type Workspace,
} from "./IssueWorkspaces.ts";
import { LandingLock } from "./LandingLock.ts";
import {
  outcomeCommitMessage,
  type OutcomeFacts,
  outcomeFileOf,
  outcomePathOf,
} from "./outcomeLog.ts";
import { sleep } from "./sleep.ts";
import {
  handoffSessionIdOf,
  type LimitReadings,
  limitUsedOf,
  type TicketSessions,
  transcriptFactsOf,
} from "./transcriptFacts.ts";
import { WrapUpFailure } from "./WrapUpFailure.ts";

const execFileAsync = promisify(execFile);

const mapLabel = "wayfinder:map";

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
  // In landing order: a repo lands before any repo that depends on it. Empty for a ticket that needed only GitHub writes.
  branches: LandingBranch[];
  closingComment: string;
  boxesUndone?: UndoneBox[];
  githubWrites?: GitHubWrite[];
  // What the runner recorded; facts computed from them win over passed ones.
  sessions?: TicketSessions;
  limitReadings?: LimitReadings;
}

export interface ParentIssue {
  issue: IssueRef;
  labels: string[];
  // Undefined when GitHub's response carried no readable sub-issue summary.
  subIssues: { total: number; completed: number } | undefined;
}

export interface WrapUpGitHub {
  closeIssue(issue: IssueRef, comment: string): Promise<void>;
  parentOf(issue: IssueRef): Promise<ParentIssue | undefined>;
  commentsOf(issue: IssueRef): Promise<string[]>;
}

export type ParentCheck =
  | { kind: "none" }
  | { kind: "map"; parent: IssueRef }
  | { kind: "open-sub-issues"; parent: IssueRef }
  | { kind: "ready-to-close"; parent: IssueRef };

export type WrapUpStep =
  | "clean-check"
  | "files-changed"
  | "merges"
  | "checks"
  | "log-row"
  | "fast-forward"
  | "push"
  | "delete-branches"
  | "remove-workspace"
  | "close"
  | "parent-check";

export interface WrapUpKnobs {
  networkTries: number;
  // The wait after the first failed try, doubled after each later one.
  backoffMs: number;
  lockPollMs: number;
}

export const defaultWrapUpKnobs: WrapUpKnobs = {
  networkTries: 3,
  backoffMs: 2000,
  lockPollMs: 5000,
};

export interface WrapUpConfig {
  workspaces: IssueWorkspacesConfig;
  github: WrapUpGitHub;
  githubOwner: string;
  // Each a command and its args, run from the issue workspace's root after the merges.
  checks: [string, ...string[]][];
  // Relative to the root repo.
  outcomeFolder: string;
  // Holds each ticket's facts and progress files; gitignored.
  stateFolder: string;
  knobs?: Partial<WrapUpKnobs>;
  sleep?(ms: number): Promise<void>;
  log?(line: string): void;
}

export interface WrapUpResult {
  completed: WrapUpStep[];
  filesChanged: number;
  branchDeleteFailures: string[];
  parent: ParentCheck;
}

interface BuiltRepo {
  // The primary's master the build started from, and the commit master fast-forwards to.
  base: string;
  head: string;
}

interface Progress {
  completed: WrapUpStep[];
  filesChanged?: number;
  // Repo name to its build, in landing order with the root repo last.
  built?: Record<string, BuiltRepo>;
  branchDeleteFailures?: string[];
  parent?: ParentCheck;
}

interface Ticket {
  issue: IssueRef;
  facts: WrapUpFacts;
  progress: Progress;
}

const buildSteps: WrapUpStep[] = ["merges", "checks", "log-row"];

export class WrapUp {
  private readonly config: WrapUpConfig;
  private readonly knobs: WrapUpKnobs;

  constructor(config: WrapUpConfig) {
    this.config = config;
    this.knobs = { ...defaultWrapUpKnobs, ...config.knobs };
  }

  static init(config: WrapUpConfig): WrapUp {
    return new WrapUp(config);
  }

  get workspaces(): IssueWorkspaces {
    return IssueWorkspaces.init(this.config.workspaces);
  }

  async run(issue: IssueRef): Promise<WrapUpResult> {
    const ticket: Ticket = {
      issue,
      facts: this._readFacts(issue),
      progress: this._readProgress(issue),
    };
    if (!isDone(ticket, "fast-forward")) await this._land(ticket);
    await this._step(ticket, "push", () => this._push(ticket));
    await this._step(ticket, "delete-branches", () =>
      this._deleteBranches(ticket),
    );
    if ((ticket.progress.branchDeleteFailures ?? []).length === 0) {
      await this._step(ticket, "remove-workspace", () =>
        this._removeWorkspace(issue),
      );
    }
    await this._step(ticket, "close", () => this._close(ticket));
    await this._step(ticket, "parent-check", () => this._checkParent(ticket));
    const {
      completed,
      filesChanged = 0,
      branchDeleteFailures = [],
      parent,
    } = ticket.progress;
    return {
      completed,
      filesChanged,
      branchDeleteFailures,
      parent: parent ?? { kind: "none" },
    };
  }

  private _readFacts(issue: IssueRef): WrapUpFacts {
    const path = this._factsPathOf(issue);
    if (!existsSync(path)) throw new Error(`No facts file at ${path}`);
    const facts = JSON.parse(readFileSync(path, "utf8")) as WrapUpFacts;
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
    facts.branches.forEach(({ repo }) => this._clonePathOf(repo));
    return facts;
  }

  private _factsPathOf(issue: IssueRef): string {
    return join(this.config.stateFolder, `${fileStemOf(issue)}.facts.json`);
  }

  private _readProgress(issue: IssueRef): Progress {
    const path = this._progressPathOf(issue);
    if (!existsSync(path)) return { completed: [] };
    return JSON.parse(readFileSync(path, "utf8")) as Progress;
  }

  private _progressPathOf(issue: IssueRef): string {
    return join(this.config.stateFolder, `${fileStemOf(issue)}.progress.json`);
  }

  // Nothing reaches a primary checkout before the fast-forward, so an unlanded rerun starts over from the branches.
  private async _land(ticket: Ticket): Promise<void> {
    const workspace = await this._workspaceOf(ticket.issue);
    await this._restore(ticket, workspace);
    ticket.progress = { completed: [] };
    await this._step(ticket, "clean-check", () =>
      this._cleanCheck(ticket, workspace),
    );
    await this._step(ticket, "files-changed", async () => {
      ticket.progress.filesChanged = await this._filesChanged(ticket);
    });
    for (;;) {
      await this._build(ticket, workspace);
      if (await this._fastForward(ticket)) return;
      this._log("A master moved while the merges were checked; rebuilding.");
      await this._restore(ticket, workspace);
      ticket.progress.completed = ticket.progress.completed.filter(
        (step) => !buildSteps.includes(step),
      );
    }
  }

  private async _workspaceOf(issue: IssueRef): Promise<Workspace> {
    const workspace = await this.workspaces.find(issue);
    if (!workspace) {
      throw new Error(`No issue workspace for ${issueLabelOf(issue)}`);
    }
    return workspace;
  }

  // Puts each listed repo back on its branch and the root off an unlanded log-row commit, undoing any earlier build.
  private async _restore(ticket: Ticket, workspace: Workspace): Promise<void> {
    for (const { repo, branch } of ticket.facts.branches) {
      const worktree = this._worktreeOf(workspace, repo);
      if (await isMerging(worktree)) await git(worktree, "merge", "--abort");
      if ((await currentBranchOf(worktree)) !== branch) {
        await git(worktree, "switch", branch);
      }
    }
    const rootHead = ticket.progress.built?.[this._rootRepo]?.head;
    const rootWorktree = this._worktreeOf(workspace, this._rootRepo);
    if (
      !isListed(ticket, this._rootRepo) &&
      (await currentBranchOf(rootWorktree)) === "" &&
      (await revOf(rootWorktree, "HEAD")) === rootHead
    ) {
      await git(rootWorktree, "switch", "--detach", "master");
    }
    delete ticket.progress.built;
  }

  private async _cleanCheck(
    ticket: Ticket,
    workspace: Workspace,
  ): Promise<void> {
    for (const repo of this._landedRepos(ticket)) {
      await this._assertOnMaster(repo);
    }
    for (const repo of this._committedRepos(ticket)) {
      if (await isDirty(this._worktreeOf(workspace, repo))) {
        throw new WrapUpFailure(
          "dirty-tree",
          `${repo} in ${workspace.path} has uncommitted changes`,
        );
      }
    }
  }

  private async _assertOnMaster(repo: string): Promise<void> {
    const checkedOut = await currentBranchOf(this._primaryOf(repo));
    if (checkedOut === "master") return;
    throw new WrapUpFailure(
      "foreign-branch",
      `${repo}'s primary checkout is on ${checkedOut || "a detached HEAD"}, not master`,
    );
  }

  private async _filesChanged(ticket: Ticket): Promise<number> {
    let count = 0;
    for (const { repo, branch } of ticket.facts.branches) {
      const files = await git(
        this._primaryOf(repo),
        "diff",
        "--name-only",
        `master...${branch}`,
      );
      count += lines(files).length;
    }
    return count;
  }

  private async _build(ticket: Ticket, workspace: Workspace): Promise<void> {
    if (hasBranches(ticket)) {
      await this._step(ticket, "merges", () => this._merge(ticket, workspace));
      await this._step(ticket, "checks", async () => {
        try {
          await this._runChecks(workspace.path);
        } catch (error) {
          await this._restore(ticket, workspace);
          throw error;
        }
      });
    } else {
      // With nothing merged, the row is committed on master rather than on the issue branch's older base.
      const rootWorktree = this._worktreeOf(workspace, this._rootRepo);
      await git(rootWorktree, "switch", "--detach", "master");
    }
    await this._step(ticket, "log-row", () =>
      this._commitLogRow(ticket, workspace),
    );
  }

  private async _merge(ticket: Ticket, workspace: Workspace): Promise<void> {
    try {
      await this.workspaces.resume(workspace);
    } catch (error) {
      throw new WrapUpFailure("dirty-tree", messageOf(error));
    }
    const built: Record<string, BuiltRepo> = {};
    for (const { repo, branch } of ticket.facts.branches) {
      const worktree = this._worktreeOf(workspace, repo);
      const base = await revOf(worktree, "master");
      await git(worktree, "switch", "--detach", "master");
      if (!(await isAncestor(worktree, branch, "master"))) {
        await this._mergeBranch(ticket, workspace, { repo, branch });
      }
      built[repo] = { base, head: await revOf(worktree, "HEAD") };
      ticket.progress.built = built;
    }
  }

  private async _mergeBranch(
    ticket: Ticket,
    workspace: Workspace,
    { repo, branch }: LandingBranch,
  ): Promise<void> {
    const worktree = this._worktreeOf(workspace, repo);
    const message = `Merge ${branch} into master (#${ticket.issue.number})`;
    try {
      await git(worktree, "merge", "--no-ff", "-m", message, branch);
    } catch (error) {
      if (await isMerging(worktree)) await git(worktree, "merge", "--abort");
      await this._restore(ticket, workspace);
      throw new WrapUpFailure(
        "conflict",
        `Merging ${branch} into ${repo}'s master conflicts; the merge was aborted: ${messageOf(error)}`,
      );
    }
  }

  private async _runChecks(workspaceRoot: string): Promise<void> {
    for (const [command, ...args] of this.config.checks) {
      try {
        await execFileAsync(command, args, {
          cwd: workspaceRoot,
          maxBuffer: 64 * 1024 * 1024,
        });
      } catch (error) {
        throw new WrapUpFailure(
          "red-checks",
          `${[command, ...args].join(" ")} failed after the merges:\n${outputTailOf(error)}`,
        );
      }
    }
  }

  private async _commitLogRow(
    ticket: Ticket,
    workspace: Workspace,
  ): Promise<void> {
    const worktree = this._worktreeOf(workspace, this._rootRepo);
    const built = ticket.progress.built ?? {};
    const base =
      built[this._rootRepo]?.base ?? (await revOf(worktree, "master"));
    const row = {
      issue: ticket.issue,
      spec: await this._specOf(ticket.issue),
      githubOwner: this.config.githubOwner,
      filesChanged: ticket.progress.filesChanged ?? 0,
      facts: await this._outcomeFactsOf(ticket),
    };
    const path = outcomePathOf(this.config.outcomeFolder, row);
    mkdirSync(dirname(join(worktree, path)), { recursive: true });
    writeFileSync(join(worktree, path), outcomeFileOf(row));
    await git(worktree, "add", path);
    // A rerun after a partial fast-forward finds the row already on master.
    if ((await git(worktree, "status", "--porcelain", path)) !== "") {
      await git(worktree, "commit", "-m", outcomeCommitMessage(row));
    }
    built[this._rootRepo] = { base, head: await revOf(worktree, "HEAD") };
    ticket.progress.built = built;
  }

  private async _outcomeFactsOf(ticket: Ticket): Promise<OutcomeFacts> {
    const { sessions, limitReadings } = ticket.facts;
    let transcriptFacts: OutcomeFacts = {};
    if (sessions !== undefined) {
      transcriptFacts = transcriptFactsOf(
        sessions,
        await this._handoffSessionIdsOf(ticket.issue),
      );
    }
    return {
      ...ticket.facts,
      ...definedFactsOf({
        ...transcriptFacts,
        limitUsed: limitUsedOf(limitReadings),
      }),
    };
  }

  private async _handoffSessionIdsOf(issue: IssueRef): Promise<string[]> {
    const comments = await this._withRetries(
      `Reading ${issueLabelOf(issue)}'s comments`,
      () => this.config.github.commentsOf(issue),
    );
    return comments.flatMap((comment) => {
      const sessionId = handoffSessionIdOf(comment);
      return sessionId === undefined ? [] : [sessionId];
    });
  }

  private async _specOf(issue: IssueRef): Promise<IssueRef> {
    return (await this._parentOf(issue))?.issue ?? issue;
  }

  // Locks are taken root first, the same order for every lander, so two landings never deadlock; the push runs under the locks too.
  private async _fastForward(ticket: Ticket): Promise<boolean> {
    const built = ticket.progress.built ?? {};
    const repos = this._rootFirst(Object.keys(built));
    const locks: LandingLock[] = [];
    try {
      for (const repo of repos) {
        locks.push(
          await LandingLock.acquire(await gitDirOf(this._primaryOf(repo)), {
            pollMs: this.knobs.lockPollMs,
            sleep: this._sleep,
          }),
        );
      }
      for (const repo of repos) {
        await this._assertOnMaster(repo);
        const master = await revOf(this._primaryOf(repo), "master");
        const { base, head } = built[repo] as BuiltRepo;
        if (master !== base && master !== head) return false;
      }
      for (const repo of repos) {
        await this._fastForwardRepo(repo, built[repo] as BuiltRepo);
      }
      await this._markDone(ticket, "fast-forward");
      await this._step(ticket, "push", () => this._push(ticket));
      return true;
    } finally {
      locks.forEach((lock) => lock.release());
    }
  }

  private async _fastForwardRepo(
    repo: string,
    { head }: BuiltRepo,
  ): Promise<void> {
    const primary = this._primaryOf(repo);
    if ((await revOf(primary, "master")) === head) return;
    try {
      await git(primary, "merge", "--ff-only", head);
    } catch (error) {
      throw new WrapUpFailure(
        "dirty-tree",
        `Fast-forwarding ${repo}'s primary checkout failed, likely over its uncommitted changes: ${messageOf(error)}`,
      );
    }
  }

  private async _push(ticket: Ticket): Promise<void> {
    for (const repo of Object.keys(ticket.progress.built ?? {})) {
      await this._withRetries(`Pushing ${repo}'s master`, () =>
        git(this._primaryOf(repo), "push", "origin", "master"),
      );
    }
  }

  private async _deleteBranches(ticket: Ticket): Promise<void> {
    const failures: string[] = [];
    let branches = ticket.facts.branches;
    if (!hasBranches(ticket)) {
      branches = await this._issueBranchesOf(ticket.issue);
    }
    for (const { repo, branch } of branches) {
      try {
        await this._deleteBranch(repo, branch);
      } catch (error) {
        const failure = `${repo} ${branch}: ${messageOf(error)}`;
        this._log(`Branch delete failed, continuing: ${failure}`);
        failures.push(failure);
      }
    }
    ticket.progress.branchDeleteFailures = failures;
  }

  // A ticket with no code lands no branch, but its workspace still made one; the workspace no longer sits on it.
  private async _issueBranchesOf(issue: IssueRef): Promise<LandingBranch[]> {
    const branches: LandingBranch[] = [];
    for (const repo of Object.keys(this.config.workspaces.clonePaths)) {
      const refs = await git(
        this._primaryOf(repo),
        "for-each-ref",
        "--format=%(refname:short)",
        `refs/heads/issue-${issue.number}-*`,
      );
      lines(refs).forEach((branch) => branches.push({ repo, branch }));
    }
    return branches;
  }

  private async _deleteBranch(repo: string, branch: string): Promise<void> {
    const primary = this._primaryOf(repo);
    const remote = await this._withRetries(`Reading ${repo}'s remote`, () =>
      git(primary, "ls-remote", "--heads", "origin", branch),
    );
    if (remote !== "") {
      await this._withRetries(`Deleting ${branch} on ${repo}'s remote`, () =>
        git(primary, "push", "origin", "--delete", branch),
      );
    }
    if (await hasRef(primary, `refs/heads/${branch}`)) {
      await git(primary, "branch", "-d", branch);
    }
  }

  private async _removeWorkspace(issue: IssueRef): Promise<void> {
    const workspace = await this.workspaces.find(issue);
    if (workspace) await this.workspaces.remove(workspace);
  }

  private async _close(ticket: Ticket): Promise<void> {
    const { issue, facts } = ticket;
    await this._withRetries(`Closing #${issue.number}`, () =>
      this.config.github.closeIssue(issue, closingCommentOf(facts)),
    );
  }

  private async _checkParent(ticket: Ticket): Promise<void> {
    const { issue } = ticket;
    ticket.progress.parent = parentCheckOf(await this._parentOf(issue));
  }

  private async _parentOf(issue: IssueRef): Promise<ParentIssue | undefined> {
    return this._withRetries(`Reading ${issueLabelOf(issue)}'s parent`, () =>
      this.config.github.parentOf(issue),
    );
  }

  private async _step(
    ticket: Ticket,
    step: WrapUpStep,
    action: () => Promise<void>,
  ): Promise<void> {
    if (isDone(ticket, step)) {
      this._log(`Skipping ${step}: done on an earlier run.`);
      return;
    }
    await action();
    await this._markDone(ticket, step);
  }

  private async _markDone(ticket: Ticket, step: WrapUpStep): Promise<void> {
    ticket.progress.completed.push(step);
    mkdirSync(this.config.stateFolder, { recursive: true });
    writeFileSync(
      this._progressPathOf(ticket.issue),
      `${JSON.stringify(ticket.progress, undefined, 2)}\n`,
    );
    this._log(`Done: ${step}.`);
  }

  private async _withRetries<RV>(
    label: string,
    action: () => Promise<RV>,
  ): Promise<RV> {
    const tries = this.knobs.networkTries;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await action();
      } catch (error) {
        if (attempt >= tries) {
          throw new WrapUpFailure(
            "network",
            `${label} failed after ${tries} tries: ${messageOf(error)}`,
          );
        }
        await this._sleep(this.knobs.backoffMs * 2 ** (attempt - 1));
      }
    }
  }

  private get _sleep(): (ms: number) => Promise<void> {
    return this.config.sleep ?? sleep;
  }

  private _log(line: string): void {
    this.config.log?.(line);
  }

  // The listed repos in landing order, then the root repo, which takes the log row.
  private _landedRepos(ticket: Ticket): string[] {
    return [
      ...new Set([
        ...ticket.facts.branches.map(({ repo }) => repo),
        this._rootRepo,
      ]),
    ];
  }

  // The repos whose worktrees must be clean: the listed ones, or the root that takes the row when none is listed.
  private _committedRepos(ticket: Ticket): string[] {
    if (!hasBranches(ticket)) return [this._rootRepo];
    return ticket.facts.branches.map(({ repo }) => repo);
  }

  private _rootFirst(repos: string[]): string[] {
    return [...repos].sort(
      (a, b) => this._clonePathOf(a).length - this._clonePathOf(b).length,
    );
  }

  private get _rootRepo(): string {
    const entry = Object.entries(this.config.workspaces.clonePaths).find(
      ([, clonePath]) => clonePath === ".",
    );
    if (!entry) {
      throw new Error("The workspace config's clone paths name no root repo");
    }
    return entry[0];
  }

  private _primaryOf(repo: string): string {
    return join(this.config.workspaces.primaryRoot, this._clonePathOf(repo));
  }

  private _worktreeOf(workspace: Workspace, repo: string): string {
    return join(workspace.path, this._clonePathOf(repo));
  }

  private _clonePathOf(repo: string): string {
    const clonePath = this.config.workspaces.clonePaths[repo];
    if (clonePath === undefined) {
      throw new Error(`${repo} is not in the workspace config's clone paths`);
    }
    return clonePath;
  }
}

function isDone(ticket: Ticket, step: WrapUpStep): boolean {
  return ticket.progress.completed.includes(step);
}

function hasBranches(ticket: Ticket): boolean {
  return ticket.facts.branches.length > 0;
}

function closingCommentOf({
  closingComment,
  boxesUndone = [],
  githubWrites = [],
}: WrapUpFacts): string {
  const parts = [closingComment];
  if (githubWrites.length > 0) {
    parts.push("", "GitHub writes:", ...githubWrites.map(gitHubWriteLineOf));
  }
  if (boxesUndone.length > 0) {
    const undone = boxesUndone.map(({ box, reason }) => `- ${box}: ${reason}`);
    parts.push("", "Left undone:", ...undone);
  }
  return parts.join("\n");
}

function gitHubWriteLineOf({
  issue,
  action,
  url,
  summary,
}: GitHubWrite): string {
  const preposition = action === "comment" ? "on" : "of";
  return `- ${action} ${preposition} ${issue}: ${summary} ${url}`;
}

function isListed(ticket: Ticket, repo: string): boolean {
  return ticket.facts.branches.some((branch) => branch.repo === repo);
}

function parentCheckOf(parent: ParentIssue | undefined): ParentCheck {
  if (parent === undefined) return { kind: "none" };
  if (parent.labels.includes(mapLabel)) {
    return { kind: "map", parent: parent.issue };
  }
  if (parent.subIssues === undefined) {
    throw new WrapUpFailure(
      "parent-check",
      `${issueLabelOf(parent.issue)}'s sub-issue summary could not be read`,
    );
  }
  if (parent.subIssues.completed < parent.subIssues.total) {
    return { kind: "open-sub-issues", parent: parent.issue };
  }
  return { kind: "ready-to-close", parent: parent.issue };
}

function definedFactsOf(facts: OutcomeFacts): OutcomeFacts {
  return Object.fromEntries(
    Object.entries(facts).filter(([, value]) => value !== undefined),
  ) as OutcomeFacts;
}

async function currentBranchOf(worktree: string): Promise<string> {
  return git(worktree, "branch", "--show-current");
}

async function revOf(worktree: string, ref: string): Promise<string> {
  return git(worktree, "rev-parse", ref);
}

async function gitDirOf(clone: string): Promise<string> {
  return git(clone, "rev-parse", "--absolute-git-dir");
}

async function isDirty(worktree: string): Promise<boolean> {
  return (await git(worktree, "status", "--porcelain")) !== "";
}

async function isMerging(worktree: string): Promise<boolean> {
  try {
    await git(worktree, "rev-parse", "-q", "--verify", "MERGE_HEAD");
    return true;
  } catch {
    return false;
  }
}

async function isAncestor(
  worktree: string,
  ancestor: string,
  descendant: string,
): Promise<boolean> {
  try {
    await git(worktree, "merge-base", "--is-ancestor", ancestor, descendant);
    return true;
  } catch {
    return false;
  }
}

async function hasRef(clone: string, ref: string): Promise<boolean> {
  return (await git(clone, "for-each-ref", "--format=%(refname)", ref)) !== "";
}
