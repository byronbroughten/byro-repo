// PostToolUse on every tool: a shim over the runner's context nudge, fired once per session doing ticket work or supervision; never blocks.
// The budget and handoff doc come from the runner's override file, or the runner's defaults if it can't load.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import {
  contextNudgeOf,
  sizePastBudgetOf,
} from "@byronbroughten/spec-runner/contextNudge";
import { IssueWorkspaces } from "@byronbroughten/spec-runner/IssueWorkspaces";
import { SupervisionRecords } from "@byronbroughten/spec-runner/SupervisionRecords";

import { nearestClaudeAncestor } from "../../scripts/runner/claudeAncestor.ts";
import {
  issueWorkspacesConfig,
  stateFolder,
} from "../../scripts/runner/runnerConfig.ts";
import {
  type BudgetedSession,
  contextNudgeKnobs,
  owedHandoffsOf,
} from "./lib/contextNudge.ts";
import {
  readHookInput,
  runFailOpen,
  sessionStatePath,
  writeHookOutput,
} from "./lib/hookIo.ts";
import { leasedWorkspacesOf } from "./lib/sessionEndRelease.ts";
import { sessionModeOf } from "./lib/tiers/tiers.ts";

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
  const knobs = contextNudgeKnobs();
  const size = sizePastBudgetOf(
    readFileSync(input.transcript_path, "utf8"),
    knobs.ticketBudget,
  );
  // Checked first, since reading the leases runs ps per workspace.
  if (size === undefined) return;
  const records = SupervisionRecords.init(stateFolder);
  const owed = owedHandoffsOf(await budgetedSessionOf(records), (lead) =>
    records.handoffPathOf(lead),
  );
  if (owed === undefined) return;
  const nudge = contextNudgeOf(size, {
    sessionId: input.session_id,
    ...knobs,
    owed,
  });
  // "wx" throws if a parallel call already claimed the nudge, so it fires once.
  writeFileSync(markerPath, "", { flag: "wx" });
  writeHookOutput({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: nudge,
    },
  });
});

async function budgetedSessionOf(
  records: SupervisionRecords,
): Promise<BudgetedSession> {
  const mode = sessionModeOf(process.env);
  const holder = nearestClaudeAncestor();
  if (!holder) return { mode, held: [], record: undefined };
  const leases = await IssueWorkspaces.init(issueWorkspacesConfig).leases();
  return {
    mode,
    held: leasedWorkspacesOf(leases, holder),
    record: await records.recordOf(holder),
  };
}
