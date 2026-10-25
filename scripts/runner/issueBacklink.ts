// Ends an issue's body with its ADR's `Design decision:` line; the body never reaches the caller, so it needs no Trusted-text check.
// Usage: npm run issue:backlink -- <repo> <n> <adr-path>
import { execFileSync } from "node:child_process";

import { backlinkLineOf, withBacklink } from "./backlink.ts";
import { githubOwner, runKnobs } from "./runnerConfig.ts";

const [repo = "", number = "", adrPath = ""] = process.argv.slice(2);
const allowedRepos = Object.keys(runKnobs.clonePaths);
try {
  if (!allowedRepos.includes(repo) || !/^\d+$/.test(number) || !adrPath) {
    throw new Error(
      `Usage: npm run issue:backlink -- <repo> <n> <adr-path>, with <repo> one of ${allowedRepos.join(", ")}.`,
    );
  }
  const ownerRepo = `${githubOwner}/${repo}`;
  const line = backlinkLineOf(ownerRepo, adrPath);
  const body = execFileSync(
    "gh",
    ["issue", "view", number, "-R", ownerRepo, "--json", "body", "-q", ".body"],
    { encoding: "utf8" },
  ).replace(/\n$/, ""); // The newline -q prints after the body, not the body's own.
  const backlinked = withBacklink(body, line);
  if (backlinked === body) {
    console.log(`${ownerRepo}#${number} already ends with: ${line}`);
  } else {
    execFileSync(
      "gh",
      ["issue", "edit", number, "-R", ownerRepo, "--body-file", "-"],
      { input: backlinked, stdio: ["pipe", "ignore", "inherit"] },
    );
    console.log(`Appended to ${ownerRepo}#${number}: ${line}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
