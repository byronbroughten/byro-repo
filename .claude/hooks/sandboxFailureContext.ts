// PostToolUseFailure on Bash: when the failed call's output shows the sandbox stopped it, says so and names the way through.
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import {
  projectDirOf,
  readHookInput,
  readJsonFile,
  runFailOpen,
  writeHookOutput,
} from "./lib/hookIo.ts";
import { sandboxContextOf, writeScopeOf } from "./lib/sandboxFailureContext.ts";

await runFailOpen(() => {
  const input = readHookInput();
  if (typeof input?.error !== "string") return;
  const root = process.env.BYRO_GATE_ROOT ?? projectDirOf(input);
  const settings = readJsonFile(join(root, ".claude", "settings.json"));
  const scope = writeScopeOf(settings, {
    home: homedir(),
    cwd: input.cwd ?? root,
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
