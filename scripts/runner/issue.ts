// Starts, lists, promotes and removes workspaces, each keyed by an issue or, for a session workspace, by a slug.
// The runner creates its own issue workspaces; `start` is the interactive session's way into one.
// Usage: npm run issue:start -- (<repo> <n> | --session <slug>) [--claude], npm run issue:list,
// npm run issue:promote -- <repo> <n> <repo-to-promote>,
// or npm run issue:remove -- (<repo> <n> | --session <slug>) [--force].
import { spawnSync } from "node:child_process";

import {
  type IssueRef,
  IssueWorkspaces,
  type Workspace,
  type WorkspaceKey,
  workspaceLabelOf,
  type WorkspaceStatus,
} from "@byronbroughten/spec-runner/IssueWorkspaces";

import { issueWorkspacesConfig } from "./runnerConfig.ts";

const workspaces = IssueWorkspaces.init(issueWorkspacesConfig);
const keyUsage = "(<repo> <n> | --session <slug>)";

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === "start") {
    await start(args);
  } else if (command === "list") {
    await list();
  } else if (command === "promote") {
    await promote(args);
  } else if (command === "remove") {
    await remove(args);
  } else {
    throw new Error(
      `Unknown command "${command}"; use start, list, promote or remove`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

async function start(args: string[]): Promise<void> {
  const key = keyOf(
    args.filter((arg) => arg !== "--claude"),
    `Usage: npm run issue:start -- ${keyUsage} [--claude]`,
  );
  const { path } = await workspaces.start(key);
  console.log(path);
  if (args.includes("--claude")) openClaude(path);
}

// Runs in the foreground so the session takes over the terminal, and passes its exit status on.
function openClaude(path: string): void {
  const { status, error } = spawnSync("claude", {
    cwd: path,
    stdio: "inherit",
  });
  if (error) throw error;
  process.exitCode = status ?? 1;
}

async function list(): Promise<void> {
  const listed = await workspaces.list();
  if (listed.length === 0) console.log("No workspaces.");
  listed.forEach((workspace) => console.log(lineOf(workspace)));
}

function lineOf(workspace: WorkspaceStatus): string {
  const { key, branch, branchedRepos, dirtyRepos, createdAt, path } = workspace;
  const dirty =
    dirtyRepos.length === 0 ? "clean" : `dirty: ${dirtyRepos.join(", ")}`;
  return [
    workspaceLabelOf(key),
    branch,
    `on branch: ${branchedRepos.join(", ")}`,
    dirty,
    `age ${ageOf(createdAt)}`,
    path,
  ].join("  ");
}

function ageOf(createdAt: Date): string {
  const hours = Math.floor((Date.now() - createdAt.getTime()) / 3_600_000);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

async function promote(args: string[]): Promise<void> {
  const usage = "Usage: npm run issue:promote -- <repo> <n> <repo-to-promote>";
  const [repo, number, promoted] = args;
  if (promoted === undefined) throw new Error(usage);
  const workspace = await workspaceOf(issueOf(repo, number, usage));
  const { branch } = await workspaces.promote(workspace, promoted);
  console.log(`${promoted} is on ${branch} in ${workspace.path}`);
}

async function remove(args: string[]): Promise<void> {
  const workspace = await workspaceOf(
    keyOf(
      args.filter((arg) => arg !== "--force"),
      `Usage: npm run issue:remove -- ${keyUsage} [--force]`,
    ),
  );
  await workspaces.remove(workspace, { force: args.includes("--force") });
  console.log(`Removed ${workspace.path}`);
}

function keyOf(args: string[], usage: string): WorkspaceKey {
  const [first, second] = args;
  if (first !== "--session") return issueOf(first, second, usage);
  if (second === undefined) throw new Error(usage);
  return { session: second };
}

function issueOf(
  repo: string | undefined,
  number: string | undefined,
  usage: string,
): IssueRef {
  if (repo === undefined || !Number.isInteger(Number(number))) {
    throw new Error(usage);
  }
  return { repo, number: Number(number) };
}

async function workspaceOf(key: WorkspaceKey): Promise<Workspace> {
  const workspace = await workspaces.find(key);
  if (!workspace) throw new Error(`No workspace for ${workspaceLabelOf(key)}`);
  return workspace;
}
