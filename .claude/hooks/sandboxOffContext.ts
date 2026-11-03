// SessionStart: when the sandbox state the tier gate reads is off, says what turned it off, how to turn it back on, and that Bash calls will ask.
import { readHookInput, runFailOpen, writeHookOutput } from "./lib/hookIo.ts";
import { sandboxOffContextOf } from "./lib/sandboxOffContext.ts";
import { sessionSandboxStateOf } from "./lib/sandboxState.ts";

await runFailOpen(() => {
  const input = readHookInput();
  const context = sandboxOffContextOf(sessionSandboxStateOf(input));
  if (context === undefined) return;
  writeHookOutput({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: context,
    },
  });
});
