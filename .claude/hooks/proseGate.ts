// PostToolUse on Read or Bash records a full read of docs/prose-style.md; PreToolUse on Edit and Write denies a gated markdown edit until one is recorded.
import { runFullReadGate } from "./lib/fullReadGate.ts";
import {
  editDecision,
  isProseBashRead,
  isProseRead,
  prosePath,
} from "./lib/proseGate.ts";

await runFullReadGate({
  marker: "prose-read",
  docPath: prosePath,
  isDocRead: isProseRead,
  isDocBashRead: isProseBashRead,
  editDenyReason: (where, hasReadProse) =>
    editDecision({ ...where, hasReadProse }).denyReason,
});
