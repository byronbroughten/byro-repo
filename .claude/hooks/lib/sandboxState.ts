// The sandbox a session's Bash calls run under, merged from the settings layers Claude Code reads. See docs/claude-code-guardrails.md.
// Managed settings aren't read: the repo deploys none, and a session's own layers are the ones a step or the developer can change.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { type HookInput, projectDirOf } from "./hookIo.ts";

export interface SandboxState {
  // `enabled` after merging, whatever `allowUnsandboxedCommands` says.
  isEnabled: boolean;
  // Enabled, with no way out through `allowUnsandboxedCommands`, and every layer parsed.
  isOn: boolean;
  excludedCommands: string[];
  filesystem: SandboxFilesystem;
  off: SandboxOff | undefined;
}

// What made the sandbox off, how to turn it back on, and the entries a call may still be made of to get its tier rows: none when a layer can't be parsed.
export interface SandboxOff {
  cause: string;
  fix: string;
  excludedCommands: string[];
}

export interface SandboxFilesystem {
  allowWrite: string[];
  denyWrite: string[];
}

export interface SettingsLayers {
  // `CLAUDE_CONFIG_DIR`, or `~/.claude`.
  userConfigDir: string;
  sessionRoot: string;
  // A runner step's `--settings` is the gate root's settings.json; an Interactive session has none.
  gateRoot: string | undefined;
}

type Layer = Record<string, unknown> | "malformed" | undefined;

export function sessionSandboxStateOf(
  input: HookInput | undefined,
): SandboxState {
  return sandboxStateOf({
    userConfigDir: process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"),
    sessionRoot: projectDirOf(input),
    gateRoot: process.env.BYRO_GATE_ROOT,
  });
}

export function sandboxStateOf(layers: SettingsLayers): SandboxState {
  const paths = layerPathsOf(layers);
  const parsedLayers = paths.map(layerAt);
  const sandbox = parsedLayers.reduce<Record<string, unknown>>(
    (merged, layer) => {
      if (layer === undefined || layer === "malformed") return merged;
      return mergedOf(merged, objectOf(layer.sandbox));
    },
    {},
  );
  const isEnabled = sandbox.enabled === true;
  const excludedCommands = stringsOf(sandbox.excludedCommands);
  const malformedPath = paths[parsedLayers.indexOf("malformed")];
  const filesystem = objectOf(sandbox.filesystem);
  const off = offOf(sandbox, malformedPath);
  return {
    isEnabled,
    isOn: off === undefined,
    excludedCommands,
    filesystem: {
      allowWrite: stringsOf(filesystem.allowWrite),
      denyWrite: stringsOf(filesystem.denyWrite),
    },
    off,
  };
}

// A broken file asks rather than frees, so it reads no entries.
function offOf(
  sandbox: Record<string, unknown>,
  malformedPath: string | undefined,
): SandboxOff | undefined {
  const excludedCommands = stringsOf(sandbox.excludedCommands);
  if (malformedPath !== undefined) {
    return {
      cause: `the settings layer \`${malformedPath}\` can't be parsed`,
      fix: "fix that file's JSON",
      excludedCommands: [],
    };
  }
  if (sandbox.enabled !== true) {
    return {
      cause: "`sandbox.enabled` isn't true",
      fix: 'set `"enabled": true` in the `sandbox` block',
      excludedCommands,
    };
  }
  if (sandbox.allowUnsandboxedCommands !== false) {
    return {
      cause: "`sandbox.allowUnsandboxedCommands` isn't false",
      fix: 'set `"allowUnsandboxedCommands": false` in the `sandbox` block',
      excludedCommands,
    };
  }
  return undefined;
}

// Lowest precedence first, as Claude Code's settings docs order them.
function layerPathsOf({
  userConfigDir,
  sessionRoot,
  gateRoot,
}: SettingsLayers): string[] {
  return [
    join(userConfigDir, "settings.json"),
    join(sessionRoot, ".claude", "settings.json"),
    join(sessionRoot, ".claude", "settings.local.json"),
    ...(gateRoot === undefined
      ? []
      : [join(gateRoot, ".claude", "settings.json")]),
  ];
}

function layerAt(path: string): Layer {
  if (!existsSync(path)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isObject(parsed) ? parsed : "malformed";
  } catch {
    return "malformed";
  }
}

// Claude Code's merge: a higher layer's value wins, and lists combine.
function mergedOf(
  lower: Record<string, unknown>,
  higher: Record<string, unknown>,
): Record<string, unknown> {
  return Object.entries(higher).reduce<Record<string, unknown>>(
    (merged, [key, value]) => {
      const below = merged[key];
      if (Array.isArray(below) && Array.isArray(value)) {
        merged[key] = [...new Set([...below, ...value])];
      } else if (isObject(below) && isObject(value)) {
        merged[key] = mergedOf(below, value);
      } else {
        merged[key] = value;
      }
      return merged;
    },
    { ...lower },
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectOf(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {};
}

function stringsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => typeof entry === "string");
}
