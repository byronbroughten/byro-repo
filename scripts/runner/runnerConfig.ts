// byro-repo's values for the spec runner's injected config. Every root script that drives the runner reads them here.
// The knobs come from runner.config.json; the code Workflow's checks and review skill, the piece Workflow's commands and
// token path, and wrap-up's merge check are set here; the repo map comes from the primary root's clones.
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
import { codeWorkflowOf } from "@byronbroughten/spec-runner/codeWorkflow";
import { CswapUsageReader } from "@byronbroughten/spec-runner/CswapUsageReader";
import { EventFileNotices } from "@byronbroughten/spec-runner/EventFileNotices";
import { GhCli } from "@byronbroughten/spec-runner/GhCli";
import type { DocumentsPort } from "@byronbroughten/spec-runner/googleDocs";
import type { ImplementCodeSkillInput } from "@byronbroughten/spec-runner/implementCodeSkill";
import type { ImplementPieceSkillInput } from "@byronbroughten/spec-runner/implementPieceSkill";
import type {
  IssueRef,
  IssueWorkspacesConfig,
} from "@byronbroughten/spec-runner/IssueWorkspaces";
import type { WrittenOutcomeRow } from "@byronbroughten/spec-runner/outcomeRowWriter";
import { pieceWorkflowOf } from "@byronbroughten/spec-runner/pieceWorkflow";
import { RestDocuments } from "@byronbroughten/spec-runner/RestDocuments";
import {
  type Command,
  loadRunKnobs,
} from "@byronbroughten/spec-runner/runKnobs";
import type { SpecRunConfig } from "@byronbroughten/spec-runner/SpecRun";
import { configFolderOf } from "@byronbroughten/spec-runner/transcriptFacts";
import type {
  WrapUpCommands,
  WrapUpConfig,
} from "@byronbroughten/spec-runner/WrapUp";

export const githubOwner = "byronbroughten";
// The one login whose text is Trusted text; fixed here, never taken from a command line.
export const developer = githubOwner;
// The commands /implement-code names; implementCodeSkill.test.ts keeps the committed skill generated from them.
export const implementCodeCommands: ImplementCodeSkillInput = {
  promoteCommand: promoteCommandOf("<repo>", "<n>"),
  reviewCommand: "npm run runner -- review <owner>/<repo> <n>",
  resolveCommand: "npm run runner -- resolve <owner>/<repo> <n>",
  decideCommand: "npm run runner -- decide <owner>/<repo> <spec> R<n>.<k>",
  wrapUpCommand: "npm run wrap-up -- <repo> <n>",
  closeParentCommand: "npm run issue:close-parent -- <repo> <p>",
  closeProjectPath: ".claude/skills/close-project/SKILL.md",
};
const overlapCommand: Command = ["npm", "run", "overlap", "--"];
// The commands /implement-piece names; implementPieceSkill.test.ts keeps the committed skill generated from them.
export const implementPieceCommands: ImplementPieceSkillInput = {
  ...implementCodeCommands,
  overlapCommand,
  piecePullCommand: "npm run piece:pull -- <repo> <n>",
};
// Each ticket's checks after review, and the skill whose SKILL.md its review prompt carries.
const codeWorkflow = codeWorkflowOf({
  checks: [["npm", "run", "check"]],
  reviewSkillName: "code-review",
});
const scriptFolder = fileURLToPath(new URL(".", import.meta.url));
// The piece checks over a Docs port: the run's, or piece:pull's as the agent account.
export function pieceWorkflowOver(
  documents: DocumentsPort,
): SpecRunConfig["workflows"]["piece"] {
  return pieceWorkflowOf({
    overlapCommand,
    verifyQuotesCommand: ["npm", "run", "verify:quotes", "--"],
    documents,
  });
}
// A run picks among them, and issue:start names a session's skill from the same pick.
// The piece Workflow's Docs port is over the Docs clasp credential file, read only once a pull calls it.
export const workflows: SpecRunConfig["workflows"] = {
  code: codeWorkflow,
  piece: pieceWorkflowOver(
    RestDocuments.init({
      credentialPath: join(homedir(), ".clasprc-docs.json"),
    }),
  ),
};

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
export const repoMap = { githubOwner, clonePaths: runKnobs.clonePaths };

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
  removeCommand: "npm run issue:remove",
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
// Gitignored with the state folder, so a landing writes its row without a commit.
export const outcomeFolder = join(stateFolder, "outcomes");
// Wrap-up's check on the merged workspace, for every landing, code or piece.
const mergeChecks: WrapUpConfig["mergeChecks"] = [["npm", "run", "check"]];

// Shared by npm run wrap-up and the runner's landings, so a dependency a branch adds reaches the primary either way.
const wrapUpCommands: WrapUpCommands = {
  // Workspaces copy node_modules rather than install, so this is how a landed prepare change reaches the primaries.
  async afterFastForward(root) {
    execFileSync("npm", ["run", "prepare"], { cwd: root, stdio: "inherit" });
  },
  async installDependencies(root) {
    execFileSync("npm", ["install", "--ignore-scripts"], {
      cwd: root,
      stdio: "inherit",
    });
  },
};

export const wrapUpConfig: WrapUpConfig = {
  ...wrapUpCommands,
  workspaces: issueWorkspacesConfig,
  github: new GhCli(githubOwner),
  githubOwner,
  developer,
  mergeChecks,
  outcomeFolder,
  stateFolder,
  knobs: { silenceTimeoutMs: runKnobs.silenceTimeoutMs },
  writeOutcomeRow: async (root, request) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        ["scripts/runner/outcomeRow.ts", JSON.stringify(request)],
        { cwd: root, encoding: "utf8" },
      ),
    ) as WrittenOutcomeRow,
  log: (line) => console.log(line),
};

export function specRunConfigOf(owner: string): SpecRunConfig {
  const {
    workspaceFolder,
    symlinkedFiles,
    installDependencies,
    removeCommand,
  } = issueWorkspacesConfig;
  return {
    knobs: runKnobs,
    workflows,
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
    wrapUpCommands,
    promoteCommandOf: ({ repo, number }: IssueRef) =>
      promoteCommandOf(repo, `${number}`),
    removeCommand,
    mergeChecks,
    outcomeFolder,
    stateFolder,
    configFolder: configFolderOf(process.env, homedir()),
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
