// PostToolUseFailure on Bash: when the failed call's output shows the sandbox stopped it, says so and names the way through.
import { homedir, tmpdir } from "node:os";

import {
  projectDirOf,
  readHookInput,
  runFailOpen,
  writeHookOutput,
} from "./lib/hookIo.ts";
import { sandboxContextOf, writeScopeOf } from "./lib/sandboxFailureContext.ts";
import { sessionSandboxStateOf } from "./lib/sandboxState.ts";

await runFailOpen(() => {
  const input = readHookInput();
  if (typeof input?.error !== "string") return;
  const { filesystem } = sessionSandboxStateOf(input);
  const scope = writeScopeOf(filesystem, {
    home: homedir(),
    cwd: input.cwd ?? projectDirOf(input),
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
