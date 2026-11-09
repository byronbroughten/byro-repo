// The wrap-up script: lands one ticket's issue branches, found by what is ahead of master, with its facts file and no
// agent. It builds and checks the merge commits in the ticket's issue workspace, fast-forwards each primary checkout's
// master under its landing lock, then pushes, deletes the branches, removes the workspace, closes the issue and checks
// its parent. Steps are recorded in a progress file, so a rerun skips what already landed; a failure throws a
// WrapUpFailure naming its kind.
// A session workspace lands the same way from its session branches, with no facts file or issue steps.
// The landing's helpers are the WrapUp/ collaborators: BranchLander.ts runs it up to the fast-forward, LandingPusher.ts
// scans and pushes, BranchDeleter.ts deletes the branches, IssueCloser.ts closes the issue and WorkspaceFinisher.ts
// levels or removes the workspace. The outcome row is written by outcomeRowWriter.ts with the merged code; the lock is
// LandingLock.ts; workspaces are IssueWorkspaces.ts.

import { existsSync, readFileSync, rmSync } from "node:fs";

import { type ClosingFacts, FactsFile } from "./FactsFile.ts";
import {
  type IssueRef,
  issueRef,
  type LeaseHolder,
  type SessionKey,
  type WorkspaceKey,
} from "./IssueWorkspaces.ts";
import { BranchDeleter } from "./WrapUp/BranchDeleter.ts";
import { BranchLander } from "./WrapUp/BranchLander.ts";
import { IssueCloser } from "./WrapUp/IssueCloser.ts";
import { LandingBranchFinder } from "./WrapUp/LandingBranchFinder.ts";
import {
  type IssueLandingTarget,
  LandingKindPicker,
} from "./WrapUp/LandingKindPicker.ts";
import { LandingPusher } from "./WrapUp/LandingPusher.ts";
import { ResearchPusher } from "./WrapUp/ResearchPusher.ts";
import { WorkspaceFinisher } from "./WrapUp/WorkspaceFinisher.ts";
import { isDone, listedReposOf, WrapUpBase } from "./WrapUp/WrapUpBase.ts";
import {
  type Landing,
  type ParentCheck,
  type Progress,
  type WrapUpConfig,
  type WrapUpStep,
} from "./WrapUp/wrapUpTypes.ts";

export { leftOpenLineOf } from "./WrapUp/IssueCloser.ts";
export {
  defaultWrapUpKnobs,
  type LandingBranch,
  type ParentCheck,
  type ParentIssue,
  type WrapUpConfig,
  type WrapUpGitHub,
  type WrapUpKnobs,
  type WrapUpStep,
} from "./WrapUp/wrapUpTypes.ts";

export interface LandingResult {
  completed: WrapUpStep[];
  filesChanged: number;
  branchDeleteFailures: string[];
}

export interface WrapUpResult extends LandingResult {
  parent: ParentCheck;
  // A Standalone ticket whose review list has undecided items; /judge-findings closes it once they're decided.
  isLeftOpen?: boolean;
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
  // The packages this landing may add; a ticket names its own in its body.
  newDependencies?: string[];
}

interface LandabilityTarget extends IssueLandingTarget {
  hasNoCode: boolean;
}

export class WrapUp extends WrapUpBase {
  static init(config: WrapUpConfig): WrapUp {
    return new WrapUp(config);
  }

  private get closer(): IssueCloser {
    return new IssueCloser(this.config);
  }

  private get lander(): BranchLander {
    return new BranchLander(this.config);
  }

  private get branchFinder(): LandingBranchFinder {
    return new LandingBranchFinder(this.config);
  }

  private get kindPicker(): LandingKindPicker {
    return new LandingKindPicker(this.config);
  }

  private get pusher(): LandingPusher {
    return new LandingPusher(this.config);
  }

  private get researchPusher(): ResearchPusher {
    return new ResearchPusher(this.config);
  }

  private get branchDeleter(): BranchDeleter {
    return new BranchDeleter(this.config);
  }

  private get workspaceFinisher(): WorkspaceFinisher {
    return new WorkspaceFinisher(this.config);
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
      branches = await this.branchFinder._issueBranchesOf(issue, progress);
      assertLandable(issue, { branches, facts, hasNoCode });
    }
    const landing: Landing = {
      key: issue,
      branches,
      progress,
      kind: this.kindPicker._issueLandingOf(issue, { branches, facts }),
    };
    if (!isDone(landing, "fast-forward")) await this.lander._land(landing);
    await this._landAndRemove(landing);
    await this._step(landing, "close", async () => {
      const isLeftOpen = await this.closer._closeOrLeaveOpen(issue, facts);
      if (isLeftOpen) landing.progress.isLeftOpen = true;
    });
    await this._step(landing, "parent-check", async () => {
      landing.progress.parent = await this.closer._checkParent(issue);
    });
    const result: WrapUpResult = {
      ...landingResultOf(landing),
      parent: landing.progress.parent ?? { kind: "none" },
    };
    if (landing.progress.isLeftOpen) result.isLeftOpen = true;
    return result;
  }

  async runSession(
    session: string,
    options: SessionOptions = {},
  ): Promise<LandingResult> {
    const landing = await this._landSession({ session }, options);
    retryBranchDeletes(landing);
    await this._landAndRemove(landing);
    return this._endSession(landing, "remove-workspace");
  }

  // Lets a session publish its work and carry on, so a long session's edits don't wait for its end.
  async keepSession(
    session: string,
    options: SessionOptions = {},
  ): Promise<LandingResult> {
    const key: SessionKey = { session };
    const landing = await this._landSession(key, options);
    await this.pusher._scanAndPush(landing);
    await this._step(landing, "level-workspace", () =>
      this.workspaceFinisher._levelWorkspace(key),
    );
    return this._endSession(landing, "level-workspace");
  }

  // `npm run research:push`: a `research/*` branch is never merged, so no landing pushes it. Returns the branch pushed.
  async pushResearch(checkout: string): Promise<string> {
    return this.researchPusher.push(checkout);
  }

  private async _landSession(
    key: SessionKey,
    { holder, newDependencies = [] }: SessionOptions,
  ): Promise<Landing> {
    await this.workspaceFinisher._assertLeaseFree(key, holder);
    const landing: Landing = {
      key,
      branches: [],
      progress: this._readProgress(key),
      kind: this.kindPicker._sessionLandingOf(newDependencies),
    };
    if (!isDone(landing, "fast-forward")) {
      landing.branches = await this.branchFinder._sessionBranchesOf(
        await this._workspaceOf(key),
      );
      await this.lander._land(landing);
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

  private async _landAndRemove(landing: Landing): Promise<void> {
    await this.pusher._scanAndPush(landing);
    await this._step(landing, "delete-branches", () =>
      this.branchDeleter._deleteBranches(landing),
    );
    if ((landing.progress.branchDeleteFailures ?? []).length === 0) {
      await this._step(landing, "remove-workspace", () =>
        this.workspaceFinisher._removeWorkspace(landing.key),
      );
    }
  }

  private _readProgress(key: WorkspaceKey): Progress {
    const path = this._progressPathOf(key);
    if (!existsSync(path)) return { completed: [] };
    return JSON.parse(readFileSync(path, "utf8")) as Progress;
  }
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

// Wrap-up's CLI is this module's only caller, so each failure names the flag that resolves it.
function assertLandable(
  issue: IssueRef,
  { branches, facts, hasNoCode }: LandabilityTarget,
): void {
  const hasCode = branches.length > 0;
  if (hasNoCode && hasCode) {
    throw new Error(
      `${issueRef.labelOf(issue)} has commits ahead of master in ${listedReposOf({ branches }).join(", ")}; drop --no-code to land them`,
    );
  }
  if (hasNoCode || hasCode || (facts.githubWrites ?? []).length > 0) return;
  throw new Error(
    `${issueRef.labelOf(issue)} has no issue branch ahead of master and no GitHub writes; pass --no-code to land it without code`,
  );
}
