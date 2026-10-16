// Starts, lists, promotes and removes workspaces, each keyed by an issue or, for a session workspace, by a slug.
// The runner creates its own issue workspaces; `start` is the interactive session's way into one, leased to its claude.
// Usage: npm run issue:start -- (<repo> <n> | --session <slug>) [--claude], npm run issue:list,
// npm run issue:promote -- <repo> <n> <repo-to-promote>,
// or npm run issue:remove -- (<repo> <n> | --session <slug>) [--force].
import { execFileSync, spawn } from "node:child_process";
import { basename } from "node:path";

import {
  holderLabelOf,
  type IssueRef,
  IssueWorkspaces,
  type LeaseHolder,
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
  if (args.includes("--claude")) {
    const workspace = await workspaces.start(key);
    console.log(workspace.path);
    await openClaude(workspace);
    return;
  }
  const holder = claudeAncestor();
  const { path } = await workspaces.start(key, holder);
  console.log(path);
  if (!holder) {
    console.log("No claude process ran this, so no lease was taken.");
  }
}

// Runs in the foreground so the session takes over the terminal, holds the lease, and passes its exit status on.
async function openClaude(workspace: Workspace): Promise<void> {
  const claude = spawn("claude", { cwd: workspace.path, stdio: "inherit" });
  const exited = new Promise<number | null>((resolve, reject) => {
    claude.on("error", reject);
    claude.on("exit", resolve);
  });
  if (claude.pid !== undefined) {
    try {
      await workspaces.takeLease(workspace, {
        kind: "session",
        pid: claude.pid,
      });
    } catch (error) {
      claude.kill();
      throw error;
    }
  }
  process.exitCode = (await exited) ?? 1;
}

// The nearest claude above this process, which is the session that ran the command.
function claudeAncestor(): LeaseHolder | undefined {
  let pid = process.ppid;
  while (pid > 1) {
    const [parent, ...command] = execFileSync(
      "ps",
      ["-o", "ppid=,comm=", "-p", String(pid)],
      { encoding: "utf8" },
    )
      .trim()
      .split(/\s+/);
    if (basename(command.join(" ")) === "claude") {
      return { kind: "session", pid };
    }
    pid = Number(parent);
  }
  return undefined;
}

async function list(): Promise<void> {
  const listed = await workspaces.list();
  if (listed.length === 0) console.log("No workspaces.");
  listed.forEach((workspace) => console.log(lineOf(workspace)));
}

function lineOf(workspace: WorkspaceStatus): string {
  const { key, branch, branchedRepos, dirtyRepos, createdAt, path, lease } =
    workspace;
  const dirty =
    dirtyRepos.length === 0 ? "clean" : `dirty: ${dirtyRepos.join(", ")}`;
  return [
    workspaceLabelOf(key),
    branch,
    `on branch: ${branchedRepos.join(", ")}`,
    dirty,
    leaseLabelOf(lease),
    `age ${ageOf(createdAt)}`,
    path,
  ].join("  ");
}

function leaseLabelOf(lease: WorkspaceStatus["lease"]): string {
  if (!lease) return "no lease";
  if (!lease.isLive) return `lease abandoned by ${holderLabelOf(lease)}`;
  return `leased by ${holderLabelOf(lease)}`;
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
