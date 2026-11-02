// PostToolUseFailure on Bash: when the failed call's output shows the sandbox stopped it, says so and names the way through.
import { homedir, tmpdir } from "node:os";

import {
  gateRootOf,
  readHookInput,
  runFailOpen,
  settingsLayersOf,
  writeHookOutput,
} from "./lib/hookIo.ts";
import { sandboxContextOf, writeScopeOf } from "./lib/sandboxFailureContext.ts";
import { sandboxStateOf } from "./lib/sandboxState.ts";

await runFailOpen(() => {
  const input = readHookInput();
  if (typeof input?.error !== "string") return;
  const { filesystem } = sandboxStateOf(settingsLayersOf(input));
  const scope = writeScopeOf(filesystem, {
    home: homedir(),
    cwd: input.cwd ?? gateRootOf(input),
    tmpdir: tmpdir(),
  });
  const context = sandboxContextOf(input.error, scope);
  if (context === undefined) return;
  writeHookOutput({
    hookSpecificOutput: {
      hookEventName: "PostToolUseFailure",
      additionalContext: context,
    },
  });
});
