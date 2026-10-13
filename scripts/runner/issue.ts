// Lists, promotes and removes issue workspaces; the runner is their only creator, so there is no start command.
// Usage: npm run issue:list, npm run issue:promote -- <repo> <n> <repo-to-promote>,
// or npm run issue:remove -- <repo> <n> [--force].
import {
  type IssueRef,
  IssueWorkspaces,
  type Workspace,
  type WorkspaceStatus,
} from "@byronbroughten/spec-runner/IssueWorkspaces";

import { issueWorkspacesConfig } from "./runnerConfig.ts";

const workspaces = IssueWorkspaces.init(issueWorkspacesConfig);

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === "list") {
    await list();
  } else if (command === "promote") {
    await promote(args);
  } else if (command === "remove") {
    await remove(args);
  } else {
    throw new Error(
      `Unknown command "${command}"; use list, promote or remove`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

async function list(): Promise<void> {
  const listed = await workspaces.list();
  if (listed.length === 0) console.log("No issue workspaces.");
  listed.forEach((workspace) => console.log(lineOf(workspace)));
}

function lineOf(workspace: WorkspaceStatus): string {
  const { issue, branch, branchedRepos, dirtyRepos, createdAt, path } =
    workspace;
  const dirty =
    dirtyRepos.length === 0 ? "clean" : `dirty: ${dirtyRepos.join(", ")}`;
  return [
    labelOf(issue),
    branch,
    `on branch: ${branchedRepos.join(", ")}`,
    dirty,
    `age ${ageOf(createdAt)}`,
    path,
  ].join("  ");
}

function labelOf(issue: IssueRef): string {
  return `${issue.repo} #${issue.number}`;
}

function ageOf(createdAt: Date): string {
  const hours = Math.floor((Date.now() - createdAt.getTime()) / 3_600_000);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

async function promote(args: string[]): Promise<void> {
  const [repo, number, promoted] = args;
  if (
    repo === undefined ||
    !Number.isInteger(Number(number)) ||
    promoted === undefined
  ) {
    throw new Error(
      "Usage: npm run issue:promote -- <repo> <n> <repo-to-promote>",
    );
  }
  const workspace = await workspaceOf({ repo, number: Number(number) });
  const { branch } = await workspaces.promote(workspace, promoted);
  console.log(`${promoted} is on ${branch} in ${workspace.path}`);
}

async function remove(args: string[]): Promise<void> {
  const [repo, number] = args.filter((arg) => arg !== "--force");
  if (repo === undefined || !Number.isInteger(Number(number))) {
    throw new Error("Usage: npm run issue:remove -- <repo> <n> [--force]");
  }
  const workspace = await workspaceOf({ repo, number: Number(number) });
  await workspaces.remove(workspace, { force: args.includes("--force") });
  console.log(`Removed ${workspace.path}`);
}

async function workspaceOf(issue: IssueRef): Promise<Workspace> {
  const workspace = await workspaces.find(issue);
  if (!workspace) throw new Error(`No issue workspace for ${labelOf(issue)}`);
  return workspace;
}
