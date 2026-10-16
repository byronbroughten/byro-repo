// The wrap-up script: lands one ticket from its facts file with no agent. It builds and checks the merge commits in the
// ticket's issue workspace, fast-forwards each primary checkout's master under its landing lock, then pushes, deletes the
// branches, removes the workspace, closes the issue and checks its parent. Steps are recorded in a progress file, so a
// rerun skips what already landed; a failure throws a WrapUpFailure naming its kind.
// A session workspace lands the same way from its session branches, with no facts file, checks or issue steps.
// The outcome row's format is outcomeLog.ts and its transcript facts are transcriptFacts.ts; the lock is LandingLock.ts;
// workspaces are IssueWorkspaces.ts.

import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { messageOf, outputTailOf } from "./failureText.ts";
import { git, lines } from "./git.ts";
import {
  fileStemOf,
  isSessionKey,
  issueLabelOf,
  type IssueRef,
  IssueWorkspaces,
  type IssueWorkspacesConfig,
  type SessionKey,
  type Workspace,
  type WorkspaceKey,
  workspaceLabelOf,
} from "./IssueWorkspaces.ts";
import { LandingLock } from "./LandingLock.ts";
import {
  outcomeCommitMessage,
  type OutcomeFacts,
  outcomeFileOf,
  outcomePathOf,
} from "./outcomeLog.ts";
import { secretShapeOf } from "./secretShapes.ts";
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
  // In landing order: a repo lands before any repo that depends on it; empty for a ticket with no code.
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
  | "secret-scan"
  | "push"
  | "delete-branches"
  | "remove-workspace"
  | "level-workspace"
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

export interface LandingResult {
  completed: WrapUpStep[];
  filesChanged: number;
  branchDeleteFailures: string[];
}

export interface WrapUpResult extends LandingResult {
  parent: ParentCheck;
}

export interface SessionOptions {
  // Lands mid-session: the workspace stays, leased, with every repo's session branch moved onto the new master.
  keep?: boolean;
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

interface LogRowTarget {
  issue: IssueRef;
  facts: WrapUpFacts;
  ticket: Ticket;
  workspace: Workspace;
}

interface AddedLine {
  file: string;
  line: number;
  text: string;
}

interface Ticket {
  key: WorkspaceKey;
  // In landing order: from the facts file, or for a session the repos whose branch was ahead of master.
  branches: LandingBranch[];
  progress: Progress;
  landing: Landing;
}

// What differs between a ticket that lands branches, one with no code and a session, chosen once up front.
interface Landing {
  // Leaves each landed repo's worktree on the commit its master fast-forwards to.
  build(ticket: Ticket, workspace: Workspace): Promise<void>;
  cleanRepos(ticket: Ticket): string[];
  branchesToDelete(ticket: Ticket): Promise<LandingBranch[]>;
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
    const facts = this._readFacts(issue);
    const ticket: Ticket = {
      key: issue,
      branches: facts.branches,
      progress: this._readProgress(issue),
      landing: this._issueLandingOf(issue, facts),
    };
    if (!isDone(ticket, "fast-forward")) await this._land(ticket);
    await this._landAndRemove(ticket);
    await this._step(ticket, "close", () => this._close(issue, facts));
    await this._step(ticket, "parent-check", () =>
      this._checkParent(ticket, issue),
    );
    return {
      ...landingResultOf(ticket),
      parent: ticket.progress.parent ?? { kind: "none" },
    };
  }

  async runSession(
    session: string,
    { keep = false }: SessionOptions = {},
  ): Promise<LandingResult> {
    const key: SessionKey = { session };
    const ticket: Ticket = {
      key,
      branches: [],
      progress: this._readProgress(key),
      landing: this._sessionLanding,
    };
    if (!isDone(ticket, "fast-forward")) {
      ticket.branches = await this._sessionBranchesOf(
        await this._workspaceOf(key),
      );
      await this._land(ticket);
    }
    if (keep) {
      await this._scanAndPush(ticket);
      await this._step(ticket, "level-workspace", () =>
        this._levelWorkspace(key),
      );
    } else {
      retryBranchDeletes(ticket);
      await this._landAndRemove(ticket);
    }
    // A session lands again under the same slug, so its next landing starts from no progress.
    if (isDone(ticket, keep ? "level-workspace" : "remove-workspace")) {
      rmSync(this._progressPathOf(key), { force: true });
    }
    return landingResultOf(ticket);
  }

  // A repo whose branch didn't land is behind master, so every branch fast-forwards; a landed one leaves its detached build.
  private async _levelWorkspace(key: SessionKey): Promise<void> {
    const workspace = await this._workspaceOf(key);
    for (const repo of Object.keys(this.config.workspaces.clonePaths)) {
      const worktree = this._worktreeOf(workspace, repo);
      if ((await currentBranchOf(worktree)) !== workspace.branch) {
        await git(worktree, "switch", workspace.branch);
      }
      await git(worktree, "merge", "--ff-only", "master");
    }
  }

  private async _landAndRemove(ticket: Ticket): Promise<void> {
    await this._scanAndPush(ticket);
    await this._step(ticket, "delete-branches", () =>
      this._deleteBranches(ticket),
    );
    if ((ticket.progress.branchDeleteFailures ?? []).length === 0) {
      await this._step(ticket, "remove-workspace", () =>
        this._removeWorkspace(ticket.key),
      );
    }
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

  private _issueLandingOf(issue: IssueRef, facts: WrapUpFacts): Landing {
    if (facts.branches.length === 0) {
      return {
        build: async (ticket, workspace) => {
          await this._switchToMaster(workspace);
          await this._logRow({ issue, facts, ticket, workspace });
        },
        cleanRepos: () => [this._rootRepo],
        branchesToDelete: this._workspaceBranchesOf.bind(this),
      };
    }
    return {
      build: async (ticket, workspace) => {
        await this._mergeAndCheck(ticket, workspace);
        await this._logRow({ issue, facts, ticket, workspace });
      },
      cleanRepos: listedReposOf,
      branchesToDelete: async ({ branches }) => branches,
    };
  }

  // A session runs its checks before landing, as every edit does, so its build is the merges alone.
  private get _sessionLanding(): Landing {
    return {
      build: async (ticket, workspace) =>
        this._step(ticket, "merges", () => this._merge(ticket, workspace)),
      cleanRepos: () => Object.keys(this.config.workspaces.clonePaths),
      branchesToDelete: async (ticket) => {
        await this._switchToMaster(await this._workspaceOf(ticket.key));
        return this._workspaceBranchesOf(ticket);
      },
    };
  }

  private _factsPathOf(issue: IssueRef): string {
    return join(this.config.stateFolder, `${fileStemOf(issue)}.facts.json`);
  }

  private _readProgress(key: WorkspaceKey): Progress {
    const path = this._progressPathOf(key);
    if (!existsSync(path)) return { completed: [] };
    return JSON.parse(readFileSync(path, "utf8")) as Progress;
  }

  private _progressPathOf(key: WorkspaceKey): string {
    return join(this.config.stateFolder, `${stateStemOf(key)}.progress.json`);
  }

  // Landing order: each clone before the root repo, which may depend on it.
  private async _sessionBranchesOf(
    workspace: Workspace,
  ): Promise<LandingBranch[]> {
    const repos = this._rootFirst(
      Object.keys(this.config.workspaces.clonePaths),
    ).reverse();
    const branches: LandingBranch[] = [];
    for (const repo of repos) {
      const primary = this._primaryOf(repo);
      if (!(await hasRef(primary, `refs/heads/${workspace.branch}`))) continue;
      const ahead = await git(
        primary,
        "rev-list",
        "--count",
        `master..${workspace.branch}`,
      );
      if (Number(ahead) > 0) branches.push({ repo, branch: workspace.branch });
    }
    if (branches.length === 0) {
      throw new Error(
        `${workspaceLabelOf(workspace.key)} has no commits ahead of master to land`,
      );
    }
    return branches;
  }

  // Nothing reaches a primary checkout before the fast-forward, so an unlanded rerun starts over from the branches.
  private async _land(ticket: Ticket): Promise<void> {
    const workspace = await this._workspaceOf(ticket.key);
    await this._restore(ticket, workspace);
    ticket.progress = { completed: [] };
    await this._step(ticket, "clean-check", () =>
      this._cleanCheck(ticket, workspace),
    );
    await this._step(ticket, "files-changed", async () => {
      ticket.progress.filesChanged = await this._filesChanged(ticket);
    });
    for (;;) {
      await ticket.landing.build(ticket, workspace);
      if (await this._fastForward(ticket)) return;
      this._log("A master moved while the merges were checked; rebuilding.");
      await this._restore(ticket, workspace);
      ticket.progress.completed = ticket.progress.completed.filter(
        (step) => !buildSteps.includes(step),
      );
    }
  }

  private async _workspaceOf(key: WorkspaceKey): Promise<Workspace> {
    const workspace = await this.workspaces.find(key);
    if (!workspace) {
      throw new Error(`No workspace for ${workspaceLabelOf(key)}`);
    }
    return workspace;
  }

  // Puts each listed repo back on its branch and the root off an unlanded log-row commit, undoing any earlier build.
  private async _restore(ticket: Ticket, workspace: Workspace): Promise<void> {
    for (const { repo, branch } of ticket.branches) {
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
    for (const repo of ticket.landing.cleanRepos(ticket)) {
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
    for (const { repo, branch } of ticket.branches) {
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

  private async _mergeAndCheck(
    ticket: Ticket,
    workspace: Workspace,
  ): Promise<void> {
    await this._step(ticket, "merges", () => this._merge(ticket, workspace));
    await this._step(ticket, "checks", async () => {
      try {
        await this._runChecks(workspace.path);
      } catch (error) {
        await this._restore(ticket, workspace);
        throw error;
      }
    });
  }

  // With nothing to merge, the row goes on master, and a repo off the issue branch lets the wrap-up delete it.
  private async _switchToMaster(workspace: Workspace): Promise<void> {
    for (const repo of new Set([this._rootRepo, ...workspace.branchedRepos])) {
      await git(
        this._worktreeOf(workspace, repo),
        "switch",
        "--detach",
        "master",
      );
    }
  }

  private async _merge(ticket: Ticket, workspace: Workspace): Promise<void> {
    try {
      await this.workspaces.resume(workspace);
    } catch (error) {
      throw new WrapUpFailure("dirty-tree", messageOf(error));
    }
    const built: Record<string, BuiltRepo> = {};
    for (const { repo, branch } of ticket.branches) {
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
    try {
      await git(worktree, "merge", ...mergeArgsOf(ticket.key, branch));
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

  private async _logRow(target: LogRowTarget): Promise<void> {
    await this._step(target.ticket, "log-row", () =>
      this._commitLogRow(target),
    );
  }

  private async _commitLogRow({
    issue,
    facts,
    ticket,
    workspace,
  }: LogRowTarget): Promise<void> {
    const worktree = this._worktreeOf(workspace, this._rootRepo);
    const built = ticket.progress.built ?? {};
    const base =
      built[this._rootRepo]?.base ?? (await revOf(worktree, "master"));
    const row = {
      issue,
      spec: await this._specOf(issue),
      githubOwner: this.config.githubOwner,
      filesChanged: ticket.progress.filesChanged ?? 0,
      facts: await this._outcomeFactsOf(issue, facts),
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

  private async _outcomeFactsOf(
    issue: IssueRef,
    facts: WrapUpFacts,
  ): Promise<OutcomeFacts> {
    const { sessions, limitReadings } = facts;
    let transcriptFacts: OutcomeFacts = {};
    if (sessions !== undefined) {
      transcriptFacts = transcriptFactsOf(
        sessions,
        await this._handoffSessionIdsOf(issue),
      );
    }
    return {
      ...facts,
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
      await this._scanAndPush(ticket);
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

  // A refusal leaves secret-scan undone, so a rerun rescans.
  private async _scanAndPush(ticket: Ticket): Promise<void> {
    await this._step(ticket, "secret-scan", () => this._scanForSecrets(ticket));
    await this._step(ticket, "push", () => this._push(ticket));
  }

  private async _scanForSecrets(ticket: Ticket): Promise<void> {
    const hits: string[] = [];
    for (const repo of Object.keys(ticket.progress.built ?? {})) {
      const diff = await git(
        this._primaryOf(repo),
        "-c",
        "core.quotePath=false",
        "diff",
        "-U0",
        "--no-color",
        "--no-ext-diff",
        "origin/master...master",
      );
      addedLinesOf(diff).forEach(({ file, line, text }) => {
        const shape = secretShapeOf(text);
        if (shape !== undefined) {
          hits.push(`${repo} ${file}:${line} (${shape})`);
        }
      });
    }
    if (hits.length === 0) return;
    throw new WrapUpFailure(
      "secret-scan",
      `The landed master adds token-shaped lines, so nothing was pushed:\n${hits.join("\n")}`,
    );
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
    for (const { repo, branch } of await ticket.landing.branchesToDelete(
      ticket,
    )) {
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

  // A ticket with no code or a session lists no branch to delete, but its workspace made one in each repo it branched.
  private async _workspaceBranchesOf({
    key,
  }: Ticket): Promise<LandingBranch[]> {
    const { branch } = await this._workspaceOf(key);
    const branches: LandingBranch[] = [];
    for (const repo of Object.keys(this.config.workspaces.clonePaths)) {
      const ref = await git(
        this._primaryOf(repo),
        "for-each-ref",
        "--format=%(refname:short)",
        `refs/heads/${branch}`,
      );
      if (ref !== "") branches.push({ repo, branch });
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

  private async _removeWorkspace(key: WorkspaceKey): Promise<void> {
    const workspace = await this.workspaces.find(key);
    if (!workspace) return;
    await this.workspaces.releaseLease(workspace);
    await this.workspaces.remove(workspace);
  }

  private async _close(issue: IssueRef, facts: WrapUpFacts): Promise<void> {
    await this._withRetries(`Closing #${issue.number}`, () =>
      this.config.github.closeIssue(issue, closingCommentOf(facts)),
    );
  }

  private async _checkParent(ticket: Ticket, issue: IssueRef): Promise<void> {
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
      this._progressPathOf(ticket.key),
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
      ...new Set([...ticket.branches.map(({ repo }) => repo), this._rootRepo]),
    ];
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

function landingResultOf({ progress }: Ticket): LandingResult {
  const { completed, filesChanged = 0, branchDeleteFailures = [] } = progress;
  return { completed, filesChanged, branchDeleteFailures };
}

// Unlike a ticket, whose issue closes regardless, a session's workspace removal waits on every branch being deleted.
function retryBranchDeletes(ticket: Ticket): void {
  if ((ticket.progress.branchDeleteFailures ?? []).length === 0) return;
  ticket.progress.completed = ticket.progress.completed.filter(
    (step) => step !== "delete-branches",
  );
}

function stateStemOf(key: WorkspaceKey): string {
  if (isSessionKey(key)) return `session-${key.session}`;
  return fileStemOf(key);
}

function listedReposOf({ branches }: Ticket): string[] {
  return branches.map(({ repo }) => repo);
}

// A session's branch fast-forwards master when it can, so a mid-session landing adds no merge commit.
function mergeArgsOf(key: WorkspaceKey, branch: string): string[] {
  if (isSessionKey(key)) {
    return ["-m", `Merge ${branch} into master`, branch];
  }
  return [
    "--no-ff",
    "-m",
    `Merge ${branch} into master (#${key.number})`,
    branch,
  ];
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

// Each line a unified diff adds, with its file and line number in the new version.
function addedLinesOf(diff: string): AddedLine[] {
  const added: AddedLine[] = [];
  let file = "";
  let line = 0;
  let isInHunk = false;
  lines(diff).forEach((diffLine) => {
    if (diffLine.startsWith("diff --git ")) {
      isInHunk = false;
    } else if (!isInHunk && diffLine.startsWith("+++ ")) {
      file = diffLine.slice(4).replace(/^"?b\/(.*?)"?$/, "$1");
    } else if (diffLine.startsWith("@@")) {
      isInHunk = true;
      line = Number(/\+(\d+)/.exec(diffLine)?.[1] ?? 0);
    } else if (isInHunk && diffLine.startsWith("+")) {
      added.push({ file, line, text: diffLine.slice(1) });
      line += 1;
    }
  });
  return added;
}

function isListed(ticket: Ticket, repo: string): boolean {
  return ticket.branches.some((branch) => branch.repo === repo);
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
