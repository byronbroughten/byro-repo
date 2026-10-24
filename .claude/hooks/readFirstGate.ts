// PostToolUse on Read or Bash records a full read of the tier table; PreToolUse on Edit and Write denies an edit a read-first row covers until its doc is recorded.
import { runFullReadGate } from "./lib/fullReadGate.ts";
import {
  isTierTableBashRead,
  isTierTableRead,
  readFirstDecision,
  tierTablePath,
} from "./lib/readFirstGate.ts";

await runFullReadGate({
  marker: "tiers-read",
  docPath: tierTablePath,
  isDocRead: isTierTableRead,
  isDocBashRead: isTierTableBashRead,
  editDenyReason: (where, hasReadTierTable) =>
    readFirstDecision(where, hasReadTierTable ? [tierTablePath] : [])
      .denyReason,
});
