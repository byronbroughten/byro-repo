// SessionEnd releases every workspace lease held by this session's claude process, so none is released by hand.
import { IssueWorkspaces } from "@byronbroughten/spec-runner/IssueWorkspaces";

import { nearestClaudeAncestor } from "../../scripts/runner/claudeAncestor.ts";
import { issueWorkspacesConfig } from "../../scripts/runner/runnerConfig.ts";
import { readHookInput, runFailOpen } from "./lib/hookIo.ts";
import { endsProcess, leasedWorkspacesOf } from "./lib/leaseRelease.ts";

await runFailOpen(async () => {
  const input = readHookInput();
  if (input?.hook_event_name !== "SessionEnd" || !endsProcess(input.reason)) {
    return;
  }
  const holder = nearestClaudeAncestor();
  if (!holder) return;
  const workspaces = IssueWorkspaces.init(issueWorkspacesConfig);
  const leased = leasedWorkspacesOf(await workspaces.list(), holder);
  for (const workspace of leased) await workspaces.releaseLease(workspace);
});
