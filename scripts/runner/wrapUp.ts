// Lands one ticket from its facts file in .runner/<repo>-<n>.facts.json, or a session workspace's branches with no facts
// file; --keep lands mid-session and keeps the workspace. A rerun skips the steps already done.
// Usage: npm run wrap-up -- (<repo> <n> | --session <slug> [--keep]).
import { issueLabelOf } from "@byronbroughten/spec-runner/IssueWorkspaces";
import { type ParentCheck, WrapUp } from "@byronbroughten/spec-runner/WrapUp";
import { WrapUpFailure } from "@byronbroughten/spec-runner/WrapUpFailure";

import { wrapUpConfig } from "./runnerConfig.ts";

const usage =
  "Usage: npm run wrap-up -- (<repo> <n> | --session <slug> [--keep])";

try {
  const args = process.argv.slice(2);
  if (args[0] === "--session") {
    await landSession(args.slice(1));
  } else {
    await landIssue(args);
  }
} catch (error) {
  if (error instanceof WrapUpFailure) {
    console.error(`Wrap-up failed (${error.kind}): ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
}

async function landIssue([repo, number]: string[]): Promise<void> {
  if (repo === undefined || !Number.isInteger(Number(number))) {
    throw new Error(usage);
  }
  const issue = { repo, number: Number(number) };
  const result = await WrapUp.init(wrapUpConfig).run(issue);
  console.log(`Landed ${issueLabelOf(issue)}: ${result.filesChanged} files.`);
  logBranchDeleteFailures(result.branchDeleteFailures);
  console.log(parentLineOf(result.parent));
}

async function landSession(args: string[]): Promise<void> {
  const keep = args.includes("--keep");
  const [session, ...rest] = args.filter((arg) => arg !== "--keep");
  if (session === undefined || session.startsWith("--") || rest.length > 0) {
    throw new Error(usage);
  }
  const result = await WrapUp.init(wrapUpConfig).runSession(session, { keep });
  console.log(`Landed session ${session}: ${result.filesChanged} files.`);
  logBranchDeleteFailures(result.branchDeleteFailures);
  if (keep) console.log("The workspace stays, level with master.");
}

function logBranchDeleteFailures(failures: string[]): void {
  failures.forEach((failure) =>
    console.log(`Branch delete failed: ${failure}`),
  );
}

function parentLineOf(check: ParentCheck): string {
  if (check.kind === "none") return "No parent to close.";
  const parent = issueLabelOf(check.parent);
  if (check.kind === "ready-to-close") {
    return `Parent ${parent} has every sub-issue closed: close it out with the prompt in docs/agents/git-workflow.md.`;
  }
  if (check.kind === "map") {
    return `Parent ${parent} is a wayfinder map; it stays open.`;
  }
  return `Parent ${parent} still has open sub-issues.`;
}
