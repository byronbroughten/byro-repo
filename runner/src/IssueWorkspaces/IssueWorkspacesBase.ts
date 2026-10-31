// The Base IssueWorkspaces and its collaborators share, importing no collaborator so `extends IssueWorkspacesBase` loads first.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { LeaseHeld } from "../LeaseHeld.ts";
import {
  holderLabelOf,
  isSameKey,
  type IssueWorkspacesConfig,
  type KeyedFolder,
  type Lease,
  type LeaseHolder,
  otherLiveHolderOf,
  sessionBranchPrefix,
  type WorkspaceKey,
} from "./workspaceTypes.ts";

export class IssueWorkspacesBase {
  protected readonly config: IssueWorkspacesConfig;

  constructor(config: IssueWorkspacesConfig) {
    this.config = config;
  }

  // The folder alone, with no git process, for a caller that needs only its path or lease.
  folderOf(key: WorkspaceKey): KeyedFolder | undefined {
    return this._keyedFolders().find((keyed) => isSameKey(keyed.key, key));
  }

  protected _keyedFolders(): KeyedFolder[] {
    if (!existsSync(this.config.workspaceFolder)) return [];
    return readdirSync(this.config.workspaceFolder)
      .sort()
      .flatMap((name) => {
        const key = this._keyOfFolder(name);
        if (!key) return [];
        return [{ path: join(this.config.workspaceFolder, name), key }];
      });
  }

  private _keyOfFolder(name: string): WorkspaceKey | undefined {
    if (name.startsWith(sessionBranchPrefix)) {
      return { session: name.slice(sessionBranchPrefix.length) };
    }
    for (const repo of Object.keys(this.config.clonePaths)) {
      const match = new RegExp(`^${escapeRegExp(repo)}-issue-(\\d+)-`).exec(
        name,
      );
      if (match?.[1] !== undefined) {
        return { repo, number: Number(match[1]) };
      }
    }
    return undefined;
  }
}

interface LeaseCheck {
  path: string;
  lease: Lease | undefined;
  holder?: LeaseHolder;
}

export function assertLeaseFree({ path, lease, holder }: LeaseCheck): void {
  const other = otherLiveHolderOf(lease, holder);
  if (!other) return;
  throw new LeaseHeld(
    `${path} is leased by ${holderLabelOf(other)}, which is still running`,
  );
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
