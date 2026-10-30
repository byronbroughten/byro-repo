// Starts, lists, promotes and removes workspaces, each keyed by an issue or, for a session workspace, by a slug.
// The runner creates its own issue workspaces; `start` is the interactive session's way into one, leased to its claude.
// Usage: npm run issue:start -- (<repo> <n> | --session <slug>) [--claude [--no-prompt]], npm run issue:list,
// npm run issue:promote -- <repo> <n> <repo-to-promote>,
// or npm run issue:remove -- (<repo> <n> | --session <slug>) [--force].
import { spawn } from "node:child_process";
import { homedir } from "node:os";

import { FactsFile } from "@byronbroughten/spec-runner/FactsFile";
import {
  holderLabelOf,
  type IssueRef,
  IssueWorkspaces,
  type Lease,
  type LeaseHolder,
  type Workspace,
  type WorkspaceKey,
  workspaceLabelOf,
  type WorkspaceStatus,
} from "@byronbroughten/spec-runner/IssueWorkspaces";
import { SupervisionRecords } from "@byronbroughten/spec-runner/SupervisionRecords";

import { nearestClaudeAncestor } from "./claudeAncestor.ts";
import { activeAccount } from "./cswapAccount.ts";
import { issueReader } from "./issueReader.ts";
import { issueWorkspacesConfig, stateFolder } from "./runnerConfig.ts";
import { startedSessionOf } from "./startedSession.ts";
import { startReportOf } from "./startReport.ts";

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
    args.filter((arg) => arg !== "--claude" && arg !== "--no-prompt"),
    `Usage: npm run issue:start -- ${keyUsage} [--claude [--no-prompt]]`,
  );
  if (args.includes("--claude")) {
    await openClaude(key, !args.includes("--no-prompt"));
    return;
  }
  const holder = nearestClaudeAncestor();
  const { path } = await workspaces.start(key, holder);
  console.log(
    startReportOf({
      path,
      hasLease: holder !== undefined,
      cwd: process.cwd(),
      ticketText: await ticketTextOf(key),
    }),
  );
  if (holder) await recordSession(key, holder);
}

// The Model fit section and the comments a session reads on entering; a session workspace has no ticket.
async function ticketTextOf(key: WorkspaceKey): Promise<string | undefined> {
  if ("session" in key) return undefined;
  return issueReader.read([
    key.repo,
    String(key.number),
    "--body",
    "--comments",
    "--hide-others",
  ]);
}

// SessionStart records a session that starts in the workspace; this records one that moves in later.
async function recordSession(
  key: WorkspaceKey,
  holder: LeaseHolder,
): Promise<void> {
  const supervision =
    await SupervisionRecords.init(stateFolder).recordOf(holder);
  const started = startedSessionOf({
    key,
    env: process.env,
    account: activeAccount(),
    homeFolder: homedir(),
    isSupervisor: supervision !== undefined,
  });
  if (started === undefined) return;
  FactsFile.init(stateFolder).addSession(started.issue, started.session);
}

// Opens at the primary root, not the workspace, so hooks never point into a folder wrap-up removes.
// Runs in the foreground so the session takes over the terminal, and passes its exit status on.
async function openClaude(
  key: WorkspaceKey,
  sendsPrompt: boolean,
): Promise<void> {
  const claude = spawn("claude", sendsPrompt ? [startIssuePromptOf(key)] : [], {
    cwd: issueWorkspacesConfig.primaryRoot,
    stdio: "inherit",
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    claude.on("error", reject);
    claude.on("exit", resolve);
  });
  process.exitCode = (await exited) ?? 1;
}

function startIssuePromptOf(key: WorkspaceKey): string {
  if ("session" in key) return `/start-issue --session ${key.session}`;
  return `/start-issue ${key.repo} ${key.number}`;
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

function leaseLabelOf(lease: Lease | undefined): string {
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
  await workspaces.remove(workspace, {
    force: args.includes("--force"),
    holder: nearestClaudeAncestor(),
  });
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
