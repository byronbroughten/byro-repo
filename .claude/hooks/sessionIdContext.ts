// SessionStart: puts the session's id in context, for a handoff's `session: <id>` line and the wrap-up facts.
import { readHookInput, runFailOpen, writeHookOutput } from "./lib/hookIo.ts";

await runFailOpen(() => {
  const sessionId = readHookInput()?.session_id;
  if (sessionId === undefined) return;
  writeHookOutput({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: `session: ${sessionId}`,
    },
  });
});
