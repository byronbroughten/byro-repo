// The workspace and lease types and the key helpers IssueWorkspaces' callers and collaborators share; IssueWorkspaces.ts re-exports them.

export interface IssueRef {
  repo: string;
  number: number;
}

export function isSameIssue(a: IssueRef, b: IssueRef): boolean {
  return a.repo === b.repo && a.number === b.number;
}

export interface SessionKey {
  session: string;
}

export type WorkspaceKey = IssueRef | SessionKey;

export function isSessionKey(key: WorkspaceKey): key is SessionKey {
  return "session" in key;
}

export function workspaceLabelOf(key: WorkspaceKey): string {
  if (isSessionKey(key)) return `session ${key.session}`;
  return issueLabelOf(key);
}

export function issueLabelOf({ repo, number }: IssueRef): string {
  return `${repo} #${number}`;
}

export function sessionBranchOf({ session }: SessionKey): string {
  return `${sessionBranchPrefix}${session}`;
}

// The issue as a file name's stem, for the state files kept per issue.
export function fileStemOf({ repo, number }: IssueRef): string {
  return `${repo}-${number}`;
}

// The repo may hold dashes, so only the last one splits off the number.
export function issueOfFileStem(stem: string): IssueRef {
  const dash = stem.lastIndexOf("-");
  return { repo: stem.slice(0, dash), number: Number(stem.slice(dash + 1)) };
}

export interface CreateOptions {
  slug?: string;
  // Repos besides the issue's own to start on the issue branch.
  extraRepos?: string[];
}

export interface IssueWorkspacesConfig {
  primaryRoot: string;
  // Repo name to its clone's path relative to the primary root; the root repo's is ".". Wrap-up lands clones in this order.
  clonePaths: Record<string, string>;
  workspaceFolder: string;
  // Gitignored files symlinked from each primary clone that has them.
  symlinkedFiles: string[];
  installDependencies(workspaceRoot: string): Promise<void>;
  issueTitle(issue: IssueRef): Promise<string>;
}

export interface Workspace {
  path: string;
  key: WorkspaceKey;
  branch: string;
  branchedRepos: string[];
}

export interface LeaseHolder {
  kind: "run" | "session";
  pid: number;
}

export interface Lease extends LeaseHolder {
  isLive: boolean;
}

export function isSameHolder(a: LeaseHolder, b: LeaseHolder): boolean {
  return a.kind === b.kind && a.pid === b.pid;
}

// The lease when someone other than the holder holds it live, undefined when the holder may take it.
export function otherLiveHolderOf(
  lease: Lease | undefined,
  holder?: LeaseHolder,
): Lease | undefined {
  if (!lease?.isLive || (holder && isSameHolder(holder, lease))) {
    return undefined;
  }
  return lease;
}

export function holderLabelOf({ kind, pid }: LeaseHolder): string {
  return `a ${kind} (pid ${pid})`;
}

export interface KeyedFolder {
  path: string;
  key: WorkspaceKey;
}

export interface MaybeLeasedFolder extends KeyedFolder {
  lease?: Lease;
}

export interface LeasedWorkspace extends KeyedFolder {
  lease: Lease;
}

export interface WorkspaceStatus extends Workspace {
  dirtyRepos: string[];
  createdAt: Date;
  lease?: Lease;
}

export interface RemoveOptions {
  force?: boolean;
  // The caller, whose own live lease doesn't block the removal.
  holder?: LeaseHolder;
}

export const sessionBranchPrefix = "session-";

// A session folder is named for its branch alone; an issue folder leads with its repo, since issue numbers repeat across repos.
export function folderPrefixOf(key: WorkspaceKey): string {
  if (isSessionKey(key)) return "";
  return `${key.repo}-`;
}

export function isSameKey(a: WorkspaceKey, b: WorkspaceKey): boolean {
  if (isSessionKey(a) || isSessionKey(b)) {
    return isSessionKey(a) && isSessionKey(b) && a.session === b.session;
  }
  return isSameIssue(a, b);
}
