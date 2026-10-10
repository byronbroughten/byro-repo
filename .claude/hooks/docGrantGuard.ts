// UserPromptSubmit records the Deliverable of a typed /implement-piece; PreToolUse on the gworkspace Doc writes allows a write to a granted Doc while its spec issue is open.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

import {
  deliverableDocIds,
  docGrantDecision,
  type DocGrants,
  governingIssue,
  grantedIssueOf,
  implementPieceIssue,
} from "./lib/docGrants.ts";
import { readHookInput, runFailOpen, sharedStatePath, writeHookOutput } from "./lib/hookIo.ts";

const specRepo = "byronbroughten/writing";
const grantsPath = sharedStatePath("doc-grants.json");

await runFailOpen(() => {
  const input = readHookInput();
  if (!input) return;
  if (input.hook_event_name === "UserPromptSubmit") {
    const issue = implementPieceIssue(input.prompt);
    if (issue !== undefined) recordGrants(issue);
    return;
  }
  const grantedIssue = grantedIssueOf(readGrants(), input.tool_input?.document_id);
  if (grantedIssue === undefined) return;
  const decision = docGrantDecision({
    toolName: input.tool_name,
    grantedIssue,
    issueState: viewIssue(grantedIssue, "state"),
  });
  if (!decision) return;
  writeHookOutput({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision.permissionDecision,
      permissionDecisionReason: decision.reason,
    },
  });
});

function recordGrants(issue: number): void {
  const body = viewIssue(issue, "body");
  if (body === undefined) return;
  const grants = readGrants();
  const governing = governingIssue(issue, body);
  deliverableDocIds(body).forEach((docId) => {
    grants[docId] = governing;
  });
  writeFileSync(grantsPath, JSON.stringify(grants));
}

function readGrants(): DocGrants {
  try {
    return JSON.parse(readFileSync(grantsPath, "utf8"));
  } catch {
    return {};
  }
}

function viewIssue(issue: number, field: "state" | "body"): string | undefined {
  const { status, stdout } = spawnSync(
    "gh",
    ["issue", "view", String(issue), "-R", specRepo, "--json", field, "--jq", `.${field}`],
    { encoding: "utf8", timeout: 8000 },
  );
  return status === 0 ? stdout.trim() : undefined;
}
