// byro-repo's values for the spec runner's injected config. Every root script that drives the runner reads them here.
// The knobs, checks included, come from runner.config.json; the repo map from the primary root's clones.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ClaudeAgentStep,
  type HookEntry,
  type McpServerConfig,
} from "@byronbroughten/spec-runner/ClaudeAgentStep";
import { clonePathsOf } from "@byronbroughten/spec-runner/clonePaths";
import { CswapUsageReader } from "@byronbroughten/spec-runner/CswapUsageReader";
import { EventFileNotices } from "@byronbroughten/spec-runner/EventFileNotices";
import { GhCli } from "@byronbroughten/spec-runner/GhCli";
import type { ImplementCodeSkillInput } from "@byronbroughten/spec-runner/implementCodeSkill";
import type {
  IssueRef,
  IssueWorkspacesConfig,
} from "@byronbroughten/spec-runner/IssueWorkspaces";
import type { WrittenOutcomeRow } from "@byronbroughten/spec-runner/outcomeRowWriter";
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
  resolveCommand: "npm run runner -- resolve <owner>/<repo> <n>",
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
export const runKnobs = loadRunKnobs(
  join(scriptFolder, "runner.config.json"),
  clonePathsOf(primaryRoot),
);

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

// Registered per step rather than in .claude/settings.json; rooted like every gate, so a step's edit to it waits for master.
const stepPermissionHook: HookEntry = {
  matcher: "Edit|Write|Bash|Read",
  hooks: [
    {
      type: "command",
      command:
        'node "${BYRO_GATE_ROOT:-$CLAUDE_PROJECT_DIR}/.claude/hooks/stepPermission.ts"',
    },
  ],
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
  writeOutcomeRow: async (root, request) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        ["scripts/runner/outcomeRow.ts", JSON.stringify(request)],
        { cwd: root, encoding: "utf8" },
      ),
    ) as WrittenOutcomeRow,
  // Workspaces copy node_modules rather than install, so this is how a landed prepare change reaches the primaries.
  async afterFastForward(root) {
    execFileSync("npm", ["run", "prepare"], { cwd: root, stdio: "inherit" });
  },
  log: (line) => console.log(line),
};

export function specRunConfigOf(owner: string): SpecRunConfig {
  const { workspaceFolder, symlinkedFiles, installDependencies } =
    issueWorkspacesConfig;
  return {
    knobs: runKnobs,
    agentStep: ClaudeAgentStep.init({
      gworkspaceServer: gworkspaceServer(),
      permissionHook: stepPermissionHook,
    }),
    github: new GhCli(owner),
    notices: EventFileNotices.init(stateFolder),
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

function promoteCommandOf(repo: string, number: string): string {
  return `npm run issue:promote -- ${repo} ${number}`;
}
