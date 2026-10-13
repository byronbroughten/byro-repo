// Lands one ticket from its facts file in .runner/<repo>-<n>.facts.json; a rerun skips the steps already done.
// Usage: npm run wrap-up -- <repo> <n>.
import { issueLabelOf } from "@byronbroughten/spec-runner/IssueWorkspaces";
import { type ParentCheck, WrapUp } from "@byronbroughten/spec-runner/WrapUp";
import { WrapUpFailure } from "@byronbroughten/spec-runner/WrapUpFailure";

import { wrapUpConfig } from "./runnerConfig.ts";

try {
  const [repo, number] = process.argv.slice(2);
  if (repo === undefined || !Number.isInteger(Number(number))) {
    throw new Error("Usage: npm run wrap-up -- <repo> <n>");
  }
  const issue = { repo, number: Number(number) };
  const result = await WrapUp.init(wrapUpConfig).run(issue);
  console.log(`Landed ${issueLabelOf(issue)}: ${result.filesChanged} files.`);
  result.branchDeleteFailures.forEach((failure) =>
    console.log(`Branch delete failed: ${failure}`),
  );
  console.log(parentLineOf(result.parent));
} catch (error) {
  if (error instanceof WrapUpFailure) {
    console.error(`Wrap-up failed (${error.kind}): ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
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
