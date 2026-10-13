// PostToolUse on every tool: the first time a main session's context passes the ticket budget, remind it to hand off. Fires once per session; never blocks.
// The budget and handoff doc come from the runner's override file, or the runner's defaults if it can't load.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { runKnobsOrDefaults } from "@byronbroughten/spec-runner/runKnobs";

import { contextNudgeContext } from "./lib/contextNudge.ts";
import {
  readHookInput,
  runFailOpen,
  sessionStatePath,
  writeHookOutput,
} from "./lib/hookIo.ts";

await runFailOpen(() => {
  const input = readHookInput();
  // A subagent's own context isn't the session's budget.
  if (!input || input.agent_type || typeof input.transcript_path !== "string") {
    return;
  }
  const markerPath = sessionStatePath(input.session_id, "context-nudge");
  if (existsSync(markerPath)) return;
  const knobs = runKnobsOrDefaults(
    join(import.meta.dirname, "../../scripts/runner/runner.config.json"),
  );
  const context = contextNudgeContext(
    readFileSync(input.transcript_path, "utf8"),
    knobs,
  );
  if (!context) return;
  // "wx" throws if a parallel call already claimed the nudge, so it fires once.
  writeFileSync(markerPath, "", { flag: "wx" });
  writeHookOutput({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: context,
    },
  });
});
