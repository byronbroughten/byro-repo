// The Base WrapUp and its collaborators share: the config, knobs, network retries, log, a landing's step progress,
// where its repos and workspace are, and the secret scan and push LandingPusher.ts and ResearchPusher.ts both run. It
// imports no collaborator, so `extends WrapUpBase` loads first.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { messageOf } from "../failureText.ts";
import { currentBranchOf, git, lines } from "../git.ts";
import {
  fileStemOf,
  isSessionKey,
  IssueWorkspaces,
  sessionBranchOf,
  type Workspace,
  type WorkspaceKey,
  workspaceLabelOf,
} from "../IssueWorkspaces.ts";
import { secretShapeOf } from "../secretShapes.ts";
import { sleep } from "../sleep.ts";
import { WrapUpFailure } from "../WrapUpFailure.ts";
import {
  defaultWrapUpKnobs,
  type Landing,
  type WrapUpConfig,
  type WrapUpKnobs,
  type WrapUpStep,
} from "./wrapUpTypes.ts";

export class WrapUpBase {
  protected readonly config: WrapUpConfig;
  protected readonly knobs: WrapUpKnobs;

  constructor(config: WrapUpConfig) {
    this.config = config;
    this.knobs = { ...defaultWrapUpKnobs, ...config.knobs };
  }

  get workspaces(): IssueWorkspaces {
    return IssueWorkspaces.init(this.config.workspaces);
  }

  protected get _rootRepo(): string {
    const entry = Object.entries(this.config.workspaces.clonePaths).find(
      ([, clonePath]) => clonePath === ".",
    );
    if (!entry) {
      throw new Error("The workspace config's clone paths name no root repo");
    }
    return entry[0];
  }

  protected async _step(
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

  protected async _markDone(landing: Landing, step: WrapUpStep): Promise<void> {
    landing.progress.completed.push(step);
    mkdirSync(this.config.stateFolder, { recursive: true });
    writeFileSync(
      this._progressPathOf(landing.key),
      `${JSON.stringify(landing.progress, undefined, 2)}\n`,
    );
    this._log(`Done: ${step}.`);
  }

  protected _progressPathOf(key: WorkspaceKey): string {
    return join(this.config.stateFolder, `${stateStemOf(key)}.progress.json`);
  }

  protected async _workspaceOf(key: WorkspaceKey): Promise<Workspace> {
    const workspace = await this.workspaces.find(key);
    if (!workspace) {
      throw new Error(`No workspace for ${workspaceLabelOf(key)}`);
    }
    return workspace;
  }

  protected async _assertOnMaster(repo: string): Promise<void> {
    const checkedOut = currentBranchOf(this._primaryOf(repo));
    if (checkedOut === "master") return;
    throw new WrapUpFailure(
      "foreign-branch",
      `${repo}'s primary checkout is on ${checkedOut || "a detached HEAD"}, not master`,
    );
  }

  protected _primaryOf(repo: string): string {
    return join(this.config.workspaces.primaryRoot, this._clonePathOf(repo));
  }

  protected _worktreeOf(workspace: Workspace, repo: string): string {
    return join(workspace.path, this._clonePathOf(repo));
  }

  protected _clonePathOf(repo: string): string {
    const clonePath = this.config.workspaces.clonePaths[repo];
    if (clonePath === undefined) {
      throw new Error(`${repo} is not in the workspace config's clone paths`);
    }
    return clonePath;
  }

  protected async _withRetries<RV>(
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

  // `subject` opens the failure, as in "The landed master".
  protected async _scanForSecrets(
    subject: string,
    scans: SecretScan[],
  ): Promise<void> {
    const hits: string[] = [];
    for (const scan of scans) {
      hits.push(...(await secretHitsOf(scan)));
    }
    if (hits.length === 0) return;
    throw new WrapUpFailure(
      "secret-scan",
      `${subject} adds token-shaped lines, so nothing was pushed:\n${hits.join("\n")}`,
    );
  }

  // Never with force: a rejected push fails after its retries rather than overwriting the remote.
  protected async _pushToOrigin({
    label,
    clone,
    branch,
    flags,
  }: OriginPush): Promise<void> {
    await this._withRetries(label, () =>
      git(clone, "push", ...flags, "origin", branch),
    );
  }

  protected get _sleep(): (ms: number) => Promise<void> {
    return this.config.sleep ?? sleep;
  }

  protected _log(line: string): void {
    this.config.log?.(line);
  }
}

interface AddedLine {
  file: string;
  line: number;
  text: string;
}

// The lines `range`'s diff adds in `clone`; a hit names `repo`.
interface SecretScan {
  repo: string;
  clone: string;
  range: string;
}

// What a push sends and how it's named in a failure.
interface OriginPush {
  label: string;
  clone: string;
  branch: string;
  flags: string[];
}

export function isDone(
  landing: Pick<Landing, "progress">,
  step: WrapUpStep,
): boolean {
  return landing.progress.completed.includes(step);
}

export function listedReposOf({
  branches,
}: Pick<Landing, "branches">): string[] {
  return branches.map(({ repo }) => repo);
}

function stateStemOf(key: WorkspaceKey): string {
  if (isSessionKey(key)) return sessionBranchOf(key);
  return fileStemOf(key);
}

async function secretHitsOf({
  repo,
  clone,
  range,
}: SecretScan): Promise<string[]> {
  const diff = await git(
    clone,
    "-c",
    "core.quotePath=false",
    "diff",
    "-U0",
    "--no-color",
    "--no-ext-diff",
    range,
  );
  return addedLinesOf(diff).flatMap(({ file, line, text }) => {
    const shape = secretShapeOf(text);
    return shape === undefined ? [] : [`${repo} ${file}:${line} (${shape})`];
  });
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
