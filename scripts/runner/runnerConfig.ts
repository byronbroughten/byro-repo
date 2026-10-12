// byro-repo's values for the spec runner's injected config. Every root script that drives the runner reads them here.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { IssueWorkspacesConfig } from "@byronbroughten/spec-runner/IssueWorkspaces";

const githubOwner = "byronbroughten";

// The git common dir, not this file's folder, so a script run inside an issue workspace still finds the primary root.
const primaryRoot = dirname(
  execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: fileURLToPath(new URL(".", import.meta.url)), encoding: "utf8" },
  ).trim(),
);

export const issueWorkspacesConfig: IssueWorkspacesConfig = {
  primaryRoot,
  clonePaths: {
    "byro-repo": ".",
    "sheets-framework": "packages/framework",
    "sheets-real-estate": "packages/real-estate",
    utils: "packages/utils",
    writing: "packages/writing",
  },
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
