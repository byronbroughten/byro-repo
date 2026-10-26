// PreToolUse on Edit and Write: warns, without blocking, before a hand edit inside any package's generated folder.
import { sep } from "node:path";

import {
  projectDirOf,
  readHookInput,
  runFailOpen,
  writeHookOutput,
} from "./lib/hookIo.ts";
import { rootRelative } from "./lib/lintSet.ts";
import { readSheetsConfigs } from "./lib/sheetsConfigs.ts";

await runFailOpen(() => {
  const input = readHookInput();
  if (!input) return;
  const filePath = input.tool_input?.file_path;
  if (
    !["Edit", "Write"].includes(input.tool_name ?? "") ||
    typeof filePath !== "string"
  ) {
    return;
  }
  const projectDir = projectDirOf(input);
  const target = rootRelative({ projectDir, cwd: input.cwd, filePath });
  const owner = readSheetsConfigs(projectDir).find(({ generatedDir }) =>
    target.startsWith(generatedDir + sep),
  );
  if (!owner) return;
  writeHookOutput({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext:
        `Generated-data warning: ${target} is generated. Fix the sheet and run \`npm run ${owner.scriptPrefix}:gen:configs\` instead of ` +
        "hand-editing it. That includes config-sheet floor entries: fix the live tab or the seed (packages/framework/docs/generated-data.md).",
    },
  });
});
