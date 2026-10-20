// PostToolUse on every tool: a shim over the runner's context nudge, fired once per ticket-work session; never blocks.
// The budget and handoff doc come from the runner's override file, or the runner's defaults if it can't load.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { contextNudgeOf } from "@byronbroughten/spec-runner/contextNudge";
import { IssueWorkspaces } from "@byronbroughten/spec-runner/IssueWorkspaces";

import { nearestClaudeAncestor } from "../../scripts/runner/claudeAncestor.ts";
import { issueWorkspacesConfig } from "../../scripts/runner/runnerConfig.ts";
import { contextNudgeKnobs, isTicketWork } from "./lib/contextNudge.ts";
import {
  readHookInput,
  runFailOpen,
  sessionStatePath,
  writeHookOutput,
} from "./lib/hookIo.ts";
import { leasedWorkspacesOf } from "./lib/leaseRelease.ts";
import { sessionModeOf } from "./lib/tiers.ts";

await runFailOpen(async () => {
  const input = readHookInput();
  // A subagent's own context isn't the session's budget.
  if (
    !input ||
    input.agent_type ||
    typeof input.transcript_path !== "string" ||
    input.session_id === undefined
  ) {
    return;
  }
  const markerPath = sessionStatePath(input.session_id, "context-nudge");
  if (existsSync(markerPath)) return;
  const nudge = contextNudgeOf(readFileSync(input.transcript_path, "utf8"), {
    sessionId: input.session_id,
    ...contextNudgeKnobs(),
  });
  if (!nudge) return;
  // Checked only past the budget, since reading the leases runs ps per workspace.
  const holder = nearestClaudeAncestor();
  const held = holder
    ? leasedWorkspacesOf(
        await IssueWorkspaces.init(issueWorkspacesConfig).leases(),
        holder,
      )
    : [];
  if (!isTicketWork(sessionModeOf(process.env), held)) return;
  // "wx" throws if a parallel call already claimed the nudge, so it fires once.
  writeFileSync(markerPath, "", { flag: "wx" });
  writeHookOutput({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: nudge,
    },
  });
});
