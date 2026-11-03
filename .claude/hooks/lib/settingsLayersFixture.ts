// Fake settings layers in temp folders, for the tests of sandboxState.ts and the code that reads it.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SettingsLayers } from "./sandboxState.ts";

// A file's content is written as is when it's a string, so a test can write one that doesn't parse.
type ClaudeFiles = Record<string, unknown>;

export const onBlock = { enabled: true, allowUnsandboxedCommands: false };

export function folderWith(files: ClaudeFiles): string {
  const root = mkdtempSync(join(tmpdir(), "sandbox-state-"));
  mkdirSync(join(root, ".claude"));
  Object.entries(files).forEach(([name, content]) => {
    writeFileSync(
      join(root, ".claude", name),
      typeof content === "string" ? content : JSON.stringify(content),
    );
  });
  return root;
}

export function layersOf({
  user = {},
  project = {},
  commandLine,
}: {
  user?: ClaudeFiles;
  project?: ClaudeFiles;
  commandLine?: ClaudeFiles;
}): SettingsLayers {
  return {
    userConfigDir: join(folderWith(user), ".claude"),
    sessionRoot: folderWith(project),
    gateRoot: commandLine ? folderWith(commandLine) : undefined,
  };
}
