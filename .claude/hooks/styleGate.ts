// PostToolUse on Read or Bash records a full read of config/docs/code-style.md; PreToolUse on Edit and Write denies a gated code edit until one is recorded.
import { runFullReadGate } from "./lib/fullReadGate.ts";
import { readSheetsConfigs } from "./lib/sheetsConfigs.ts";
import {
  editDecision,
  isStyleBashRead,
  isStyleRead,
  stylePath,
} from "./lib/styleGate.ts";

await runFullReadGate({
  marker: "style-read",
  docPath: stylePath,
  isDocRead: isStyleRead,
  isDocBashRead: isStyleBashRead,
  editDenyReason: (where, hasReadStyle) =>
    editDecision({
      ...where,
      hasReadStyle,
      generatedDirs: readSheetsConfigs(where.projectDir).map(
        ({ generatedDir }) => generatedDir,
      ),
    }).denyReason,
});
