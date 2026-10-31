// SessionEnd ends this session's supervision, keeping its offset for /runner to rejoin from, and on a process end releases every workspace lease its claude process holds, so none is released by hand.
import { IssueWorkspaces } from "@byronbroughten/spec-runner/IssueWorkspaces";
import { SupervisionRecords } from "@byronbroughten/spec-runner/SupervisionRecords";

import { nearestClaudeAncestor } from "../../scripts/runner/claudeAncestor.ts";
import {
  issueWorkspacesConfig,
  stateFolder,
} from "../../scripts/runner/runnerConfig.ts";
import { readHookInput, runFailOpen } from "./lib/hookIo.ts";
import {
  leasedWorkspacesOf,
  sessionEndReleaseOf,
} from "./lib/sessionEndRelease.ts";
import { sessionModeOf } from "./lib/tiers/tiers.ts";

await runFailOpen(async () => {
  // A runner step's claude holds no lease; the run holds it under its own pid.
  if (sessionModeOf(process.env) === "runnerStep") return;
  const input = readHookInput();
  if (input?.hook_event_name !== "SessionEnd") return;
  const holder = nearestClaudeAncestor();
  if (!holder) return;
  const { endedBy, isLeaseReleased } = sessionEndReleaseOf(input.reason);
  await SupervisionRecords.init(stateFolder).end(holder, endedBy);
  if (!isLeaseReleased) return;
  const workspaces = IssueWorkspaces.init(issueWorkspacesConfig);
  const leased = leasedWorkspacesOf(await workspaces.leases(), holder);
  for (const workspace of leased) await workspaces.releaseLease(workspace);
});
