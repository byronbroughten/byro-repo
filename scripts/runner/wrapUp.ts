// Lands one ticket's issue branches with the facts in .runner/<repo>-<n>.facts.json, or a session workspace's branches
// with no facts file; --keep lands mid-session and keeps the workspace. An interactive ticket passes its closing facts
// as arguments, and --no-code lands a ticket with no branch. A rerun skips the steps already done.
import { parseArgs } from "node:util";

import {
  issueLabelOf,
  workspaceLabelOf,
} from "@byronbroughten/spec-runner/IssueWorkspaces";
import {
  leftOpenLineOf,
  type ParentCheck,
  WrapUp,
} from "@byronbroughten/spec-runner/WrapUp";
import { WrapUpFailure } from "@byronbroughten/spec-runner/WrapUpFailure";

import { nearestClaudeAncestor } from "./claudeAncestor.ts";
import { closingFactsOf } from "./closingFacts.ts";
import { wrapUpConfig } from "./runnerConfig.ts";

const usage =
  'Usage: npm run wrap-up -- (<repo> <n> [(--closing "…" | --closing-file <path>) [--undone "<box>: <reason>"]...] [--no-code] | --session <slug> [--keep] [--new-dependency <name>]...)';

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

async function landIssue(args: string[]): Promise<void> {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      closing: { type: "string" },
      "closing-file": { type: "string" },
      undone: { type: "string", multiple: true, default: [] },
      "no-code": { type: "boolean", default: false },
    },
  });
  const [repo, number, ...rest] = positionals;
  if (
    repo === undefined ||
    !Number.isInteger(Number(number)) ||
    rest.length > 0
  ) {
    throw new Error(usage);
  }
  const issue = { repo, number: Number(number) };
  const result = await WrapUp.init(wrapUpConfig).run(issue, {
    closing: closingFactsOf({
      closing: values.closing,
      closingFile: values["closing-file"],
      undone: values.undone,
    }),
    hasNoCode: values["no-code"],
  });
  console.log(`Landed ${issueLabelOf(issue)}: ${result.filesChanged} files.`);
  logBranchDeleteFailures(result.branchDeleteFailures);
  if (result.isLeftOpen) console.log(leftOpenLineOf(issue));
  console.log(parentLineOf(result.parent));
}

async function landSession(args: string[]): Promise<void> {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      keep: { type: "boolean", default: false },
      "new-dependency": { type: "string", multiple: true, default: [] },
    },
  });
  const [session, ...rest] = positionals;
  if (session === undefined || rest.length > 0) throw new Error(usage);
  const { keep } = values;
  const wrapUp = WrapUp.init(wrapUpConfig);
  const options = {
    holder: nearestClaudeAncestor(),
    newDependencies: values["new-dependency"],
  };
  const result = keep
    ? await wrapUp.keepSession(session, options)
    : await wrapUp.runSession(session, options);
  console.log(
    `Landed ${workspaceLabelOf({ session })}: ${result.filesChanged} files.`,
  );
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
