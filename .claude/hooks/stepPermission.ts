// PermissionRequest on Edit, Write, Bash and Read, registered by the runner in each step's --settings rather than in .claude/settings.json; it answers only in a runner step.
import { dryRuns, shellPlacesOf } from "./lib/gateLookups.ts";
import { readHookInput, runFailOpen, writeHookOutput } from "./lib/hookIo.ts";
import { stepPermissionDecision } from "./lib/tiers/stepPermission.ts";
import { sessionModeOf } from "./lib/tiers/tiers.ts";

await runFailOpen(() => {
  const input = readHookInput();
  if (!input?.tool_name) return;
  const decision = stepPermissionDecision({
    toolName: input.tool_name,
    toolInput: input.tool_input ?? {},
    mode: sessionModeOf(process.env),
    dryRuns: dryRuns.read(input.session_id),
    places: shellPlacesOf(input),
  });
  if (decision !== "allow") return;
  writeHookOutput({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior: "allow" },
    },
  });
});
