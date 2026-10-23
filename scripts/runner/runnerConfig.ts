// byro-repo's values for the spec runner's injected config. Every root script that drives the runner reads them here.
// The knobs, repo map and checks included, come from runner.config.json; the ntfy topic from gitignored runner.local.json.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ClaudeAgentStep,
  type McpServerConfig,
} from "@byronbroughten/spec-runner/ClaudeAgentStep";
import { CswapUsageReader } from "@byronbroughten/spec-runner/CswapUsageReader";
import { EventFileNotices } from "@byronbroughten/spec-runner/EventFileNotices";
import { GhCli } from "@byronbroughten/spec-runner/GhCli";
import type { ImplementCodeSkillInput } from "@byronbroughten/spec-runner/implementCodeSkill";
import type {
  IssueRef,
  IssueWorkspacesConfig,
} from "@byronbroughten/spec-runner/IssueWorkspaces";
import { composedNotices } from "@byronbroughten/spec-runner/Notices";
import { NtfyNotices } from "@byronbroughten/spec-runner/NtfyNotices";
import { loadRunKnobs } from "@byronbroughten/spec-runner/runKnobs";
import type { SpecRunConfig } from "@byronbroughten/spec-runner/SpecRun";
import type { WrapUpConfig } from "@byronbroughten/spec-runner/WrapUp";

export const githubOwner = "byronbroughten";
// The one login whose text is Trusted text; fixed here, never taken from a command line.
export const developer = githubOwner;
// The commands /implement-code names; implementCodeSkill.test.ts keeps the committed skill generated from them.
export const implementCodeCommands: ImplementCodeSkillInput = {
  promoteCommand: promoteCommandOf("<repo>", "<n>"),
  reviewCommand: "npm run runner -- review <owner>/<repo> <n>",
  wrapUpCommand: "npm run wrap-up -- <repo> <n>",
};
const scriptFolder = fileURLToPath(new URL(".", import.meta.url));

// The git common dir, not this file's folder, so a script run inside an issue workspace still finds the primary root.
const primaryRoot = dirname(
  execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: scriptFolder, encoding: "utf8" },
  ).trim(),
);
// Gitignored, so only the primary root has it.
const localConfigPath = join(
  primaryRoot,
  "scripts",
  "runner",
  "runner.local.json",
);

export const runKnobs = loadRunKnobs(join(scriptFolder, "runner.config.json"));

export const issueWorkspacesConfig: IssueWorkspacesConfig = {
  primaryRoot,
  clonePaths: runKnobs.clonePaths,
  // EnterWorktree asks for approval on any path outside the repo's .claude/worktrees/, whatever the allow rules say.
  workspaceFolder: join(primaryRoot, ".claude", "worktrees"),
  symlinkedFiles: ["sheets.config.json", ".clasp.json"],
  async installDependencies(workspaceRoot) {
    execFileSync("npm", ["install"], { cwd: workspaceRoot, stdio: "inherit" });
  },
  async issueTitle({ repo, number }) {
    return execFileSync(
      "gh",
      [
        "issue",
        "view",
        String(number),
        "-R",
        `${githubOwner}/${repo}`,
        "--json",
        "title",
        "-q",
        ".title",
      ],
      { encoding: "utf8" },
    ).trim();
  },
};

export const stateFolder = join(primaryRoot, ".runner");
const outcomeFolder = "docs/agents/outcomes";

export const wrapUpConfig: WrapUpConfig = {
  workspaces: issueWorkspacesConfig,
  github: new GhCli(githubOwner),
  githubOwner,
  checks: runKnobs.checks,
  outcomeFolder,
  stateFolder,
  log: (line) => console.log(line),
};

export function specRunConfigOf(owner: string): SpecRunConfig {
  const { workspaceFolder, symlinkedFiles, installDependencies } =
    issueWorkspacesConfig;
  return {
    knobs: runKnobs,
    agentStep: ClaudeAgentStep.init("cswap", gworkspaceServer()),
    github: new GhCli(owner),
    notices: composedNotices(
      // Read on each send, so review, status and stop, which never send, need no topic.
      { send: (notice) => NtfyNotices.init(ntfyTopic()).send(notice) },
      EventFileNotices.init(stateFolder),
    ),
    usageReader: CswapUsageReader.init(),
    clock: { now: () => new Date() },
    githubOwner: owner,
    developer,
    primaryRoot,
    workspaceFolder,
    symlinkedFiles,
    installDependencies,
    promoteCommandOf: ({ repo, number }: IssueRef) =>
      promoteCommandOf(repo, `${number}`),
    outcomeFolder,
    stateFolder,
    log: (line) => console.log(line),
  };
}

// The primary root's local-scope server; a step runs in an issue workspace, which has none of its own.
function gworkspaceServer(): McpServerConfig | undefined {
  const path = join(homedir(), ".claude.json");
  if (!existsSync(path)) return undefined;
  const config = JSON.parse(readFileSync(path, "utf8")) as {
    projects?: Record<string, { mcpServers?: Record<string, McpServerConfig> }>;
  };
  return config.projects?.[primaryRoot]?.mcpServers?.gworkspace;
}

export function ntfyTopic(): string {
  const missing = `Put {"ntfyTopic": "<a long random string>"} in ${localConfigPath}, then subscribe to that topic in the ntfy app.`;
  if (!existsSync(localConfigPath)) throw new Error(missing);
  const { ntfyTopic } = JSON.parse(readFileSync(localConfigPath, "utf8")) as {
    ntfyTopic?: unknown;
  };
  if (typeof ntfyTopic !== "string" || ntfyTopic === "") {
    throw new Error(missing);
  }
  return ntfyTopic;
}

function promoteCommandOf(repo: string, number: string): string {
  return `npm run issue:promote -- ${repo} ${number}`;
}
