// byro-repo's values for the spec runner's injected config. Every root script that drives the runner reads them here.
// The knobs, repo map and checks included, come from runner.config.json; the ntfy topic from gitignored runner.local.json.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ClaudeAgentStep } from "@byronbroughten/spec-runner/ClaudeAgentStep";
import { GhCli } from "@byronbroughten/spec-runner/GhCli";
import type {
  IssueRef,
  IssueWorkspacesConfig,
} from "@byronbroughten/spec-runner/IssueWorkspaces";
import { NtfyNotices } from "@byronbroughten/spec-runner/NtfyNotices";
import { loadRunKnobs } from "@byronbroughten/spec-runner/runKnobs";
import type { SpecRunConfig } from "@byronbroughten/spec-runner/SpecRun";
import type { WrapUpConfig } from "@byronbroughten/spec-runner/WrapUp";

const githubOwner = "byronbroughten";
const configFolder = fileURLToPath(new URL(".", import.meta.url));
const localConfigPath = join(configFolder, "runner.local.json");

// The git common dir, not this file's folder, so a script run inside an issue workspace still finds the primary root.
const primaryRoot = dirname(
  execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: configFolder, encoding: "utf8" },
  ).trim(),
);

export const runKnobs = loadRunKnobs(join(configFolder, "runner.config.json"));

export const issueWorkspacesConfig: IssueWorkspacesConfig = {
  primaryRoot,
  clonePaths: runKnobs.clonePaths,
  workspaceFolder: join(dirname(primaryRoot), "byro-repo-workspaces"),
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

const stateFolder = join(primaryRoot, ".runner");
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
    agentStep: ClaudeAgentStep.init(),
    github: new GhCli(owner),
    notices: NtfyNotices.init(ntfyTopic()),
    clock: { now: () => new Date() },
    githubOwner: owner,
    primaryRoot,
    workspaceFolder,
    symlinkedFiles,
    installDependencies,
    promoteCommandOf: ({ repo, number }: IssueRef) =>
      `npm run issue:promote -- ${repo} ${number}`,
    outcomeFolder,
    stateFolder,
    log: (line) => console.log(line),
  };
}

function ntfyTopic(): string {
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
