// Files a folder of ticket drafts as issues, each a sub-issue of <parent> with its blocked-by edges, then reads each back.
// Usage: npm run issue:file -- <repo> [<parent>] <drafts-folder>
// The draft format: docs/agents/issue-tracker.md#file-tickets-from-drafts.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { GhCli } from "@byronbroughten/spec-runner/GhCli";
import { TicketFiler } from "@byronbroughten/spec-runner/TicketFiler";

import { githubOwner, runKnobs } from "./runnerConfig.ts";

const args = process.argv.slice(2);
const allowedRepos = Object.keys(runKnobs.clonePaths);
try {
  const [repo = "", ...rest] = args;
  const folder = rest.at(-1) ?? "";
  const parent = rest.length === 2 ? rest[0] : undefined;
  if (
    !allowedRepos.includes(repo) ||
    rest.length < 1 ||
    rest.length > 2 ||
    (parent !== undefined && !/^\d+$/.test(parent))
  ) {
    throw new Error(
      `Usage: npm run issue:file -- <repo> [<parent>] <drafts-folder>, with <repo> one of ${allowedRepos.join(", ")}.`,
    );
  }
  // npm runs a root script from the workspace root, which a relative folder is read against.
  const files = readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map(({ name }) => ({
      fileName: name,
      text: readFileSync(join(folder, name), "utf8"),
    }));
  const report = await TicketFiler.init(new GhCli(githubOwner)).file({
    repo,
    parent: parent === undefined ? undefined : Number(parent),
    files,
  });
  if (report.exitCode === 0) console.log(report.text);
  else console.error(report.text);
  process.exitCode = report.exitCode;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
