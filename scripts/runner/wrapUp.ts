// Lands one ticket's issue branches with the facts in .runner/<repo>-<n>.facts.json, or a session workspace's branches
// with no facts file; --keep lands mid-session and keeps the workspace. An interactive ticket passes its closing facts
// as arguments, and --no-code lands a ticket with no branch. A rerun skips the steps already done.
import { parseArgs } from "node:util";

import type {
  ClosingFacts,
  UndoneBox,
} from "@byronbroughten/spec-runner/FactsFile";
import {
  issueLabelOf,
  workspaceLabelOf,
} from "@byronbroughten/spec-runner/IssueWorkspaces";
import { type ParentCheck, WrapUp } from "@byronbroughten/spec-runner/WrapUp";
import { WrapUpFailure } from "@byronbroughten/spec-runner/WrapUpFailure";

import { nearestClaudeAncestor } from "./claudeAncestor.ts";
import { wrapUpConfig } from "./runnerConfig.ts";

const usage =
  'Usage: npm run wrap-up -- (<repo> <n> [--closing "…" [--undone "<box>: <reason>"]...] [--no-code] | --session <slug> [--keep])';

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
    closing: closingFactsOf(values.closing, values.undone),
    hasNoCode: values["no-code"],
  });
  console.log(`Landed ${issueLabelOf(issue)}: ${result.filesChanged} files.`);
  logBranchDeleteFailures(result.branchDeleteFailures);
  console.log(parentLineOf(result.parent));
}

function closingFactsOf(
  closingComment: string | undefined,
  undone: string[],
): ClosingFacts | undefined {
  if (closingComment === undefined) {
    if (undone.length > 0) throw new Error("--undone needs --closing with it");
    return undefined;
  }
  return { closingComment, boxesUndone: undone.map(undoneBoxOf) };
}

function undoneBoxOf(value: string): UndoneBox {
  const separator = value.indexOf(": ");
  if (separator === -1) {
    throw new Error(`--undone takes "<box>: <reason>", not "${value}"`);
  }
  return {
    box: value.slice(0, separator),
    reason: value.slice(separator + 2),
  };
}

async function landSession(args: string[]): Promise<void> {
  const keep = args.includes("--keep");
  const [session, ...rest] = args.filter((arg) => arg !== "--keep");
  if (session === undefined || session.startsWith("--") || rest.length > 0) {
    throw new Error(usage);
  }
  const wrapUp = WrapUp.init(wrapUpConfig);
  const options = { holder: nearestClaudeAncestor() };
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
