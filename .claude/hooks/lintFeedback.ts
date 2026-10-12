// PostToolUse on Edit and Write, after Prettier: runs `eslint --fix` on the edited file and reports the errors it can't fix.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { readHookInput, runFailOpen, writeHookOutput } from "./lib/hookIo.ts";
import { lintFeedback } from "./lib/lintFeedback.ts";
import { isInLintSet, projectRelative } from "./lib/lintSet.ts";
import { readSheetsConfigs } from "./lib/sheetsConfigs.ts";

await runFailOpen(() => {
  const input = readHookInput();
  if (!input || !["Edit", "Write"].includes(input.tool_name ?? "")) return;
  const filePath = input.tool_input?.file_path;
  if (typeof filePath !== "string") return;
  const projectDir =
    process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
  const location = { projectDir, cwd: input.cwd ?? projectDir, filePath };
  const generatedDirs = readSheetsConfigs(projectDir).map(
    ({ generatedDir }) => generatedDir,
  );
  if (!isInLintSet({ ...location, generatedDirs })) return;
  const absolutePath = resolve(location.cwd, filePath);
  const before = readFileSync(absolutePath, "utf8");
  const configLookup = ["--flag", "v10_config_lookup_from_file"]; // finds each package's own eslint.config.mjs
  // Unused variables are off for this run: an import added one edit before its use isn't an error yet.
  const { stdout } = spawnSync(
    binPath(projectDir, "eslint"),
    [
      ...configLookup,
      "--fix",
      "--rule",
      "@typescript-eslint/no-unused-vars: off",
      "--format",
      "json",
      absolutePath,
    ],
    { cwd: projectDir, encoding: "utf8", timeout: 20_000 },
  );
  if (readFileSync(absolutePath, "utf8") !== before) {
    spawnSync(
      binPath(projectDir, "prettier"),
      ["--write", "--log-level", "warn", absolutePath],
      { cwd: projectDir, timeout: 8_000 },
    );
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

function binPath(projectDir: string, name: string): string {
  return join(projectDir, "node_modules", ".bin", name);
}
