// Puts a ready-* label on an issue in place of its triage label, once its body passes the check issue:file applies.
// Usage: npm run issue:ready -- <repo> <n> <label>
// The check: docs/agents/tickets.md's ## Where and ## Model fit.
import { GhCli } from "@byronbroughten/spec-runner/GhCli";
import { TicketReadier } from "@byronbroughten/spec-runner/TicketReadier";

import { githubOwner, runKnobs } from "./runnerConfig.ts";

const args = process.argv.slice(2);
const allowedRepos = Object.keys(runKnobs.clonePaths);
try {
  const [repo = "", number = "", label = ""] = args;
  if (
    !allowedRepos.includes(repo) ||
    args.length !== 3 ||
    !/^\d+$/.test(number)
  ) {
    throw new Error(
      `Usage: npm run issue:ready -- <repo> <n> <label>, with <repo> one of ${allowedRepos.join(", ")}.`,
    );
  }
  const line = await TicketReadier.init(new GhCli(githubOwner)).ready(
    { repo, number: Number(number) },
    label,
  );
  console.log(line);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
