// SessionEnd releases every workspace lease and the supervision record held by this session's claude process, so none is released by hand.
import { IssueWorkspaces } from "@byronbroughten/spec-runner/IssueWorkspaces";
import { SupervisionRecords } from "@byronbroughten/spec-runner/SupervisionRecords";

import { nearestClaudeAncestor } from "../../scripts/runner/claudeAncestor.ts";
import {
  issueWorkspacesConfig,
  stateFolder,
} from "../../scripts/runner/runnerConfig.ts";
import { readHookInput, runFailOpen } from "./lib/hookIo.ts";
import {
  endsProcess,
  leasedWorkspacesOf,
  releaseSupervisionAtEnd,
} from "./lib/leaseRelease.ts";
import { sessionModeOf } from "./lib/tiers.ts";

await runFailOpen(async () => {
  // A runner step's claude holds no lease; the run holds it under its own pid.
  if (sessionModeOf(process.env) === "runnerStep") return;
  const input = readHookInput();
  if (input?.hook_event_name !== "SessionEnd" || !endsProcess(input.reason)) {
    return;
  }
  const holder = nearestClaudeAncestor();
  if (!holder) return;
  await releaseSupervisionAtEnd(
    SupervisionRecords.init(stateFolder),
    holder,
    input.reason,
  );
  const workspaces = IssueWorkspaces.init(issueWorkspacesConfig);
  const leased = leasedWorkspacesOf(await workspaces.leases(), holder);
  for (const workspace of leased) await workspaces.releaseLease(workspace);
});
