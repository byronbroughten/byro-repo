// PostToolUse on Edit and Write: Prettier on the edited file, then `eslint --fix` on a file in the lint set, reporting the errors it can't fix. A workspace file runs its workspace's own tools from that root.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { readHookInput, runFailOpen, writeHookOutput } from "./lib/hookIo.ts";
import { lintFeedback } from "./lib/lintFeedback.ts";
import { isInLintSet, projectRelative, rootOf } from "./lib/lintSet.ts";
import { readSheetsConfigs } from "./lib/sheetsConfigs.ts";

await runFailOpen(() => {
  const input = readHookInput();
  if (!input || !["Edit", "Write"].includes(input.tool_name ?? "")) return;
  const filePath = input.tool_input?.file_path;
  if (typeof filePath !== "string") return;
  const projectDir =
    process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
  const location = { projectDir, cwd: input.cwd ?? projectDir, filePath };
  const root = rootOf(location);
  const absolutePath = resolve(location.cwd, filePath);
  runPrettier(root, ["--ignore-unknown", absolutePath]);
  const generatedDirs = readSheetsConfigs(projectDir).map(
    ({ generatedDir }) => generatedDir,
  );
  if (!isInLintSet({ ...location, generatedDirs })) return;
  const eslint = binPath(root, "eslint");
  if (!existsSync(eslint)) return;
  const before = readFileSync(absolutePath, "utf8");
  const configLookup = ["--flag", "v10_config_lookup_from_file"]; // finds each package's own eslint.config.mjs
  // Unused variables are off for this run: an import added one edit before its use isn't an error yet.
  const { stdout } = spawnSync(
    eslint,
    [
      ...configLookup,
      "--fix",
      "--rule",
      "@typescript-eslint/no-unused-vars: off",
      "--format",
      "json",
      absolutePath,
    ],
    { cwd: root, encoding: "utf8", timeout: 20_000 },
  );
  if (readFileSync(absolutePath, "utf8") !== before) {
    runPrettier(root, [absolutePath]);
  }
  const feedback = lintFeedback({
    eslintJson: stdout ?? "",
    filePath: projectRelative(location),
  });
  if (!feedback) return;
  writeHookOutput({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: feedback,
    },
  });
});

// Never the primary's binary for a workspace file: its branch may pin other versions and configs.
function runPrettier(root: string, args: string[]): void {
  const prettier = binPath(root, "prettier");
  if (!existsSync(prettier)) return;
  spawnSync(prettier, ["--write", "--log-level", "warn", ...args], {
    cwd: root,
    timeout: 8_000,
  });
}

function binPath(root: string, name: string): string {
  return join(root, "node_modules", ".bin", name);
}
