// PreToolUse on Bash: denies Bash reads of columnConfigs.ts and whole-file dumps of large repo files.
import { readHookInput, runFailOpen, writeDenyOutput } from "./lib/hookIo.ts";
import { BashReads } from "./lib/tiers/bashReads.ts";

await runFailOpen(() => {
  const input = readHookInput();
  const command = input?.tool_input?.command;
  if (input?.tool_name !== "Bash" || typeof command !== "string") return;
  const { denyReason } = BashReads.initFromHook(input, command).classify();
  if (!denyReason) return;
  writeDenyOutput(denyReason);
});
