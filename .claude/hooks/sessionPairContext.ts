// PostToolUse on Bash: after `npm run issue:start`, states the session's model and effort as its transcript records them.
import { readFileSync } from "node:fs";

import { readHookInput, runFailOpen, writeHookOutput } from "./lib/hookIo.ts";
import { sessionPairLineOf } from "./lib/sessionPairContext.ts";

await runFailOpen(() => {
  const input = readHookInput();
  const command = input?.tool_input?.command;
  if (typeof command !== "string" || !input?.transcript_path) return;
  const line = sessionPairLineOf(
    command,
    readFileSync(input.transcript_path, "utf8"),
  );
  if (line === undefined) return;
  writeHookOutput({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: line,
    },
  });
});
