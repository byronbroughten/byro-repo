// The wrap-up script: lands one ticket's issue branches, found by what is ahead of master, with its facts file and no
// agent. It builds and checks the merge commits in the ticket's issue workspace, fast-forwards each primary checkout's
// master under its landing lock, then pushes, deletes the branches, removes the workspace, closes the issue and checks
// its parent. Steps are recorded in a progress file, so a rerun skips what already landed; a failure throws a
// WrapUpFailure naming its kind.
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

import {
  type ClosingFacts,
  FactsFile,
  type GitHubWrite,
  type WrapUpFacts,
} from "./FactsFile.ts";
import { commandLabelOf, messageOf, outputTailOf } from "./failureText.ts";
import {
  currentBranchOf,
  git,
  hasRef,
  isDirty,
  lines,
  worktreeStateOf,
} from "./git.ts";
import {
  fileStemOf,
  holderLabelOf,
  isSessionKey,
  issueLabelOf,
  type IssueRef,
  IssueWorkspaces,
  type IssueWorkspacesConfig,
  type LeaseHolder,
  otherLiveHolderOf,
  sessionBranchOf,
  type SessionKey,
  type Workspace,
  type WorkspaceKey,
  workspaceLabelOf,
} from "./IssueWorkspaces.ts";
import { LandingLock } from "./LandingLock.ts";
import { LeaseHeld } from "./LeaseHeld.ts";
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
  limitUsedOf,
  transcriptFactsOf,
} from "./transcriptFacts.ts";
import { WrapUpFailure } from "./WrapUpFailure.ts";

const execFileAsync = promisify(execFile);

const mapLabel = "wayfinder:map";

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

export interface LandingBranch {
  repo: string;
  branch: string;
}

export interface IssueOptions {
  // Passed by an interactive session; a run's facts file already holds them.
  closing?: ClosingFacts;
  // Lands a ticket with no branch ahead of master and no GitHub writes, such as one that only edited a Doc.
  hasNoCode?: boolean;
}

export interface SessionOptions {
  // The session landing it; another live holder of the workspace's lease refuses the landing.
  holder?: LeaseHolder;
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
  // A ticket's derived branches, kept so a rerun past the fast-forward, when none is ahead any more, deletes them.
  branches?: LandingBranch[];
  branchDeleteFailures?: string[];
  parent?: ParentCheck;
}

interface LogRowTarget {
  issue: IssueRef;
  facts: WrapUpFacts;
  landing: Landing;
  workspace: Workspace;
}

interface IssueLandingTarget {
  branches: LandingBranch[];
  facts: WrapUpFacts;
}

interface LandabilityTarget extends IssueLandingTarget {
  hasNoCode: boolean;
}

interface AddedLine {
  file: string;
  line: number;
  text: string;
}

interface Landing {
  key: WorkspaceKey;
  // In landing order: the repos whose branch was ahead of master.
  branches: LandingBranch[];
  progress: Progress;
  kind: LandingKind;
}

// What differs between a ticket that lands branches, one with no code and a session, chosen once up front.
// Read before any switch and only for repos left unswitched, so a switch never leaves a stale answer.
type UnswitchedDirtiness = Record<string, boolean>;

interface CleanCheckTarget {
  workspace: Workspace;
  unswitchedDirtiness: UnswitchedDirtiness;
}

interface LandingKind {
  // Leaves each landed repo's worktree on the commit its master fast-forwards to.
  build(landing: Landing, workspace: Workspace): Promise<void>;
  cleanRepos(landing: Landing): string[];
  branchesToDelete(landing: Landing): Promise<LandingBranch[]>;
  mergeArgs(branch: string): string[];
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

  get factsFile(): FactsFile {
    return FactsFile.init(this.config.stateFolder);
  }

  async run(
    issue: IssueRef,
    { closing, hasNoCode = false }: IssueOptions = {},
  ): Promise<WrapUpResult> {
    if (closing) this.factsFile.setClosingFacts(issue, closing);
    const facts = this.factsFile.read(issue);
    const progress = this._readProgress(issue);
    let branches = progress.branches ?? [];
    if (!isDone({ progress }, "fast-forward")) {
      branches = await this._issueBranchesOf(issue, progress);
      assertLandable(issue, { branches, facts, hasNoCode });
    }
    const landing: Landing = {
      key: issue,
      branches,
      progress,
      kind: this._issueLandingOf(issue, { branches, facts }),
    };
    if (!isDone(landing, "fast-forward")) await this._land(landing);
    await this._landAndRemove(landing);
    await this._step(landing, "close", () => this._close(issue, facts));
    await this._step(landing, "parent-check", () =>
      this._checkParent(landing, issue),
    );
    return {
      ...landingResultOf(landing),
      parent: landing.progress.parent ?? { kind: "none" },
    };
  }

  async runSession(
    session: string,
    { holder }: SessionOptions = {},
  ): Promise<LandingResult> {
    const landing = await this._landSession({ session }, holder);
    retryBranchDeletes(landing);
    await this._landAndRemove(landing);
    return this._endSession(landing, "remove-workspace");
  }

  // Lets a session publish its work and carry on, so a long session's edits don't wait for its end.
  async keepSession(
    session: string,
    { holder }: SessionOptions = {},
  ): Promise<LandingResult> {
    const key: SessionKey = { session };
    const landing = await this._landSession(key, holder);
    await this._scanAndPush(landing);
    await this._step(landing, "level-workspace", () =>
      this._levelWorkspace(key),
    );
    return this._endSession(landing, "level-workspace");
  }

  private async _landSession(
    key: SessionKey,
    holder: LeaseHolder | undefined,
  ): Promise<Landing> {
    await this._assertLeaseFree(key, holder);
    const landing: Landing = {
      key,
      branches: [],
      progress: this._readProgress(key),
      kind: this._sessionLanding,
    };
    if (!isDone(landing, "fast-forward")) {
      landing.branches = await this._sessionBranchesOf(
        await this._workspaceOf(key),
      );
      await this._land(landing);
    }
    return landing;
  }

  // A session lands again under the same slug, so its next landing starts from no progress.
  private _endSession(landing: Landing, lastStep: WrapUpStep): LandingResult {
    if (isDone(landing, lastStep)) {
      rmSync(this._progressPathOf(landing.key), { force: true });
    }
    return landingResultOf(landing);
  }

  private async _assertLeaseFree(
    key: SessionKey,
    holder: LeaseHolder | undefined,
  ): Promise<void> {
    const workspace = await this.workspaces.find(key);
    if (!workspace) return;
    const other = otherLiveHolderOf(
      await this.workspaces.leaseOf(workspace),
      holder,
    );
    if (!other) return;
    throw new LeaseHeld(
      `${workspaceLabelOf(key)} is leased by ${holderLabelOf(other)}, which is still running`,
    );
  }

  // A landed repo sits detached on master, so its branch moves there, keeping any commit or edit made since.
  private async _levelWorkspace(key: SessionKey): Promise<void> {
    const workspace = await this._workspaceOf(key);
    for (const repo of Object.keys(this.config.workspaces.clonePaths)) {
      const worktree = this._worktreeOf(workspace, repo);
      try {
        await levelRepo(worktree, workspace.branch);
      } catch (error) {
        throw new WrapUpFailure(
          "dirty-tree",
          `Leveling ${repo} in ${workspace.path} with master failed, likely over changes made since the landing: ${messageOf(error)}`,
        );
      }
    }
  }

  private async _landAndRemove(landing: Landing): Promise<void> {
    await this._scanAndPush(landing);
    await this._step(landing, "delete-branches", () =>
      this._deleteBranches(landing),
    );
    if ((landing.progress.branchDeleteFailures ?? []).length === 0) {
      await this._step(landing, "remove-workspace", () =>
        this._removeWorkspace(landing.key),
      );
    }
  }

  // Adds back any branch an earlier, unfinished landing found, which a partial fast-forward may have left level with master.
  private async _issueBranchesOf(
    issue: IssueRef,
    progress: Progress,
  ): Promise<LandingBranch[]> {
    const workspace = await this._workspaceOf(issue);
    const ahead = await this._branchesAheadOf(workspace);
    const repos = new Set(
      [...ahead, ...(progress.branches ?? [])].map(({ repo }) => repo),
    );
    return this._landingOrderOf([...repos]).map((repo) => ({
      repo,
      branch: workspace.branch,
    }));
  }

  private _issueLandingOf(
    issue: IssueRef,
    { branches, facts }: IssueLandingTarget,
  ): LandingKind {
    if (branches.length === 0) {
      return {
        build: async (landing, workspace) => {
          await this._switchToMaster(workspace);
          await this._logRow({ issue, facts, landing, workspace });
        },
        cleanRepos: () => [this._rootRepo],
        branchesToDelete: this._workspaceBranchesOf.bind(this),
        mergeArgs: (branch) => issueMergeArgsOf(issue, branch),
      };
    }
    return {
      build: async (landing, workspace) => {
        await this._mergeAndCheck(landing, workspace);
        await this._logRow({ issue, facts, landing, workspace });
      },
      cleanRepos: listedReposOf,
      branchesToDelete: async ({ branches }) => branches,
      mergeArgs: (branch) => issueMergeArgsOf(issue, branch),
    };
  }

  // A session runs its checks before landing, as every edit does, so its build is the merges alone.
  private get _sessionLanding(): LandingKind {
    return {
      build: async (landing, workspace) =>
        this._step(landing, "merges", () => this._merge(landing, workspace)),
      cleanRepos: () => Object.keys(this.config.workspaces.clonePaths),
      branchesToDelete: async (landing) => {
        await this._switchToMaster(await this._workspaceOf(landing.key));
        return this._workspaceBranchesOf(landing);
      },
      mergeArgs: sessionMergeArgsOf,
    };
  }

  private _readProgress(key: WorkspaceKey): Progress {
    const path = this._progressPathOf(key);
    if (!existsSync(path)) return { completed: [] };
    return JSON.parse(readFileSync(path, "utf8")) as Progress;
  }

  private _progressPathOf(key: WorkspaceKey): string {
    return join(this.config.stateFolder, `${stateStemOf(key)}.progress.json`);
  }

  private async _sessionBranchesOf(
    workspace: Workspace,
  ): Promise<LandingBranch[]> {
    const branches = await this._branchesAheadOf(workspace);
    if (branches.length === 0) {
      throw new Error(
        `${workspaceLabelOf(workspace.key)} has no commits ahead of master to land`,
      );
    }
    return branches;
  }

  private async _branchesAheadOf(
    workspace: Workspace,
  ): Promise<LandingBranch[]> {
    const repos = this._landingOrderOf(
      Object.keys(this.config.workspaces.clonePaths),
    );
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
    return branches;
  }

  // Landing order: the clones in the config's order, which puts a repo before any repo that depends on it, then the root.
  private _landingOrderOf(repos: string[]): string[] {
    const clones = Object.keys(this.config.workspaces.clonePaths).filter(
      (repo) => repo !== this._rootRepo,
    );
    return [...clones, this._rootRepo].filter((repo) => repos.includes(repo));
  }

  // Nothing reaches a primary checkout before the fast-forward, so an unlanded rerun starts over from the branches.
  private async _land(landing: Landing): Promise<void> {
    const workspace = await this._workspaceOf(landing.key);
    const unswitchedDirtiness = await this._restore(landing, workspace);
    landing.progress = { completed: [], branches: landing.branches };
    await this._step(landing, "clean-check", () =>
      this._cleanCheck(landing, { workspace, unswitchedDirtiness }),
    );
    await this._step(landing, "files-changed", async () => {
      landing.progress.filesChanged = await this._filesChanged(landing);
    });
    for (;;) {
      await landing.kind.build(landing, workspace);
      if (await this._fastForward(landing)) return;
      this._log("A master moved while the merges were checked; rebuilding.");
      await this._restore(landing, workspace);
      landing.progress.completed = landing.progress.completed.filter(
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
  private async _restore(
    landing: Landing,
    workspace: Workspace,
  ): Promise<UnswitchedDirtiness> {
    const unswitchedDirtiness: UnswitchedDirtiness = {};
    for (const { repo, branch } of landing.branches) {
      const worktree = this._worktreeOf(workspace, repo);
      if (await isMerging(worktree)) await git(worktree, "merge", "--abort");
      const state = await worktreeStateOf(worktree);
      if (state.branch !== branch) {
        await git(worktree, "switch", branch);
      } else {
        unswitchedDirtiness[repo] = state.isDirty;
      }
    }
    const rootHead = landing.progress.built?.[this._rootRepo]?.head;
    const rootWorktree = this._worktreeOf(workspace, this._rootRepo);
    const { branch, head, isDirty } = await worktreeStateOf(rootWorktree);
    if (
      !isListed(landing, this._rootRepo) &&
      branch === "" &&
      head === rootHead
    ) {
      await git(rootWorktree, "switch", "--detach", "master");
    } else {
      unswitchedDirtiness[this._rootRepo] = isDirty;
    }
    delete landing.progress.built;
    return unswitchedDirtiness;
  }

  private async _cleanCheck(
    landing: Landing,
    { workspace, unswitchedDirtiness }: CleanCheckTarget,
  ): Promise<void> {
    for (const repo of this._landedRepos(landing)) {
      await this._assertOnMaster(repo);
    }
    for (const repo of landing.kind.cleanRepos(landing)) {
      const isRepoDirty =
        unswitchedDirtiness[repo] ??
        (await isDirty(this._worktreeOf(workspace, repo)));
      if (isRepoDirty) {
        throw new WrapUpFailure(
          "dirty-tree",
          `${repo} in ${workspace.path} has uncommitted changes`,
        );
      }
    }
  }

  private async _assertOnMaster(repo: string): Promise<void> {
    const checkedOut = currentBranchOf(this._primaryOf(repo));
    if (checkedOut === "master") return;
    throw new WrapUpFailure(
      "foreign-branch",
      `${repo}'s primary checkout is on ${checkedOut || "a detached HEAD"}, not master`,
    );
  }

  private async _filesChanged(landing: Landing): Promise<number> {
    let count = 0;
    for (const { repo, branch } of landing.branches) {
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
    landing: Landing,
    workspace: Workspace,
  ): Promise<void> {
    await this._step(landing, "merges", () => this._merge(landing, workspace));
    await this._step(landing, "checks", async () => {
      try {
        await this._runChecks(workspace.path);
      } catch (error) {
        await this._restore(landing, workspace);
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

  private async _merge(landing: Landing, workspace: Workspace): Promise<void> {
    try {
      await this.workspaces.resume(workspace);
    } catch (error) {
      throw new WrapUpFailure("dirty-tree", messageOf(error));
    }
    const built: Record<string, BuiltRepo> = {};
    for (const { repo, branch } of landing.branches) {
      const worktree = this._worktreeOf(workspace, repo);
      const base = await revOf(worktree, "master");
      await git(worktree, "switch", "--detach", "master");
      if (!(await isAncestor(worktree, branch, "master"))) {
        await this._mergeBranch(landing, workspace, { repo, branch });
      }
      built[repo] = { base, head: await revOf(worktree, "HEAD") };
      landing.progress.built = built;
    }
  }

  private async _mergeBranch(
    landing: Landing,
    workspace: Workspace,
    { repo, branch }: LandingBranch,
  ): Promise<void> {
    const worktree = this._worktreeOf(workspace, repo);
    try {
      await git(worktree, "merge", ...landing.kind.mergeArgs(branch));
    } catch (error) {
      if (await isMerging(worktree)) await git(worktree, "merge", "--abort");
      await this._restore(landing, workspace);
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
          `${commandLabelOf([command, ...args])} failed after the merges:\n${outputTailOf(error)}`,
        );
      }
    }
  }

  private async _logRow(target: LogRowTarget): Promise<void> {
    await this._step(target.landing, "log-row", () =>
      this._commitLogRow(target),
    );
  }

  private async _commitLogRow({
    issue,
    facts,
    landing,
    workspace,
  }: LogRowTarget): Promise<void> {
    const worktree = this._worktreeOf(workspace, this._rootRepo);
    const built = landing.progress.built ?? {};
    const base =
      built[this._rootRepo]?.base ?? (await revOf(worktree, "master"));
    const row = {
      issue,
      spec: await this._specOf(issue),
      githubOwner: this.config.githubOwner,
      filesChanged: landing.progress.filesChanged ?? 0,
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
    landing.progress.built = built;
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
  private async _fastForward(landing: Landing): Promise<boolean> {
    const built = landing.progress.built ?? {};
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
      await this._markDone(landing, "fast-forward");
      await this._scanAndPush(landing);
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
  private async _scanAndPush(landing: Landing): Promise<void> {
    await this._step(landing, "secret-scan", () =>
      this._scanForSecrets(landing),
    );
    await this._step(landing, "push", () => this._push(landing));
  }

  private async _scanForSecrets(landing: Landing): Promise<void> {
    const hits: string[] = [];
    for (const repo of Object.keys(landing.progress.built ?? {})) {
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

  private async _push(landing: Landing): Promise<void> {
    for (const repo of Object.keys(landing.progress.built ?? {})) {
      await this._withRetries(`Pushing ${repo}'s master`, () =>
        git(this._primaryOf(repo), "push", "origin", "master"),
      );
    }
  }

  private async _deleteBranches(landing: Landing): Promise<void> {
    const failures: string[] = [];
    for (const { repo, branch } of await landing.kind.branchesToDelete(
      landing,
    )) {
      try {
        await this._deleteBranch(repo, branch);
      } catch (error) {
        const failure = `${repo} ${branch}: ${messageOf(error)}`;
        this._log(`Branch delete failed, continuing: ${failure}`);
        failures.push(failure);
      }
    }
    landing.progress.branchDeleteFailures = failures;
  }

  // A ticket with no code or a session lists no branch to delete, but its workspace made one in each repo it branched.
  private async _workspaceBranchesOf({
    key,
  }: Landing): Promise<LandingBranch[]> {
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
    const lease = await this.workspaces.leaseOf(workspace);
    await this.workspaces.releaseLease(workspace);
    try {
      await this.workspaces.remove(workspace);
    } catch (error) {
      // A half torn-down workspace may have nowhere left to hold a lease.
      if (lease?.isLive) {
        await this.workspaces.takeLease(workspace, lease).catch(() => {});
      }
      throw error;
    }
  }

  private async _close(issue: IssueRef, facts: WrapUpFacts): Promise<void> {
    await this._withRetries(`Closing #${issue.number}`, () =>
      this.config.github.closeIssue(issue, closingCommentOf(facts)),
    );
  }

  private async _checkParent(landing: Landing, issue: IssueRef): Promise<void> {
    landing.progress.parent = parentCheckOf(await this._parentOf(issue));
  }

  private async _parentOf(issue: IssueRef): Promise<ParentIssue | undefined> {
    return this._withRetries(`Reading ${issueLabelOf(issue)}'s parent`, () =>
      this.config.github.parentOf(issue),
    );
  }

  private async _step(
    landing: Landing,
    step: WrapUpStep,
    action: () => Promise<void>,
  ): Promise<void> {
    if (isDone(landing, step)) {
      this._log(`Skipping ${step}: done on an earlier run.`);
      return;
    }
    await action();
    await this._markDone(landing, step);
  }

  private async _markDone(landing: Landing, step: WrapUpStep): Promise<void> {
    landing.progress.completed.push(step);
    mkdirSync(this.config.stateFolder, { recursive: true });
    writeFileSync(
      this._progressPathOf(landing.key),
      `${JSON.stringify(landing.progress, undefined, 2)}\n`,
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
  private _landedRepos(landing: Landing): string[] {
    return [
      ...new Set([...landing.branches.map(({ repo }) => repo), this._rootRepo]),
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

function isDone(landing: Pick<Landing, "progress">, step: WrapUpStep): boolean {
  return landing.progress.completed.includes(step);
}

function landingResultOf({ progress }: Landing): LandingResult {
  const { completed, filesChanged = 0, branchDeleteFailures = [] } = progress;
  return { completed, filesChanged, branchDeleteFailures };
}

// Unlike a ticket, whose issue closes regardless, a session's workspace removal waits on every branch being deleted.
function retryBranchDeletes(landing: Landing): void {
  if ((landing.progress.branchDeleteFailures ?? []).length === 0) return;
  landing.progress.completed = landing.progress.completed.filter(
    (step) => step !== "delete-branches",
  );
}

function assertLandable(
  issue: IssueRef,
  { branches, facts, hasNoCode }: LandabilityTarget,
): void {
  const hasCode = branches.length > 0;
  if (hasNoCode && hasCode) {
    throw new Error(
      `${issueLabelOf(issue)} has commits ahead of master in ${listedReposOf({ branches }).join(", ")}; drop --no-code to land them`,
    );
  }
  if (hasNoCode || hasCode || (facts.githubWrites ?? []).length > 0) return;
  throw new Error(
    `${issueLabelOf(issue)} has no issue branch ahead of master and no GitHub writes; pass --no-code to land it without code`,
  );
}

function stateStemOf(key: WorkspaceKey): string {
  if (isSessionKey(key)) return sessionBranchOf(key);
  return fileStemOf(key);
}

function listedReposOf({ branches }: Pick<Landing, "branches">): string[] {
  return branches.map(({ repo }) => repo);
}

function issueMergeArgsOf({ number }: IssueRef, branch: string): string[] {
  return ["--no-ff", "-m", `Merge ${branch} into master (#${number})`, branch];
}

// A session's branch fast-forwards master when it can, so a mid-session landing adds no merge commit.
function sessionMergeArgsOf(branch: string): string[] {
  return ["-m", `Merge ${branch} into master`, branch];
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

function isListed(landing: Landing, repo: string): boolean {
  return landing.branches.some((branch) => branch.repo === repo);
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

async function levelRepo(worktree: string, branch: string): Promise<void> {
  if (currentBranchOf(worktree) !== branch) {
    if (await isAncestor(worktree, branch, "HEAD")) {
      await git(worktree, "switch", "-C", branch);
    } else {
      await git(worktree, "switch", branch);
    }
  }
  if (await isAncestor(worktree, branch, "master")) {
    await git(worktree, "merge", "--ff-only", "master");
  }
}

async function revOf(worktree: string, ref: string): Promise<string> {
  return git(worktree, "rev-parse", ref);
}

async function gitDirOf(clone: string): Promise<string> {
  return git(clone, "rev-parse", "--absolute-git-dir");
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
