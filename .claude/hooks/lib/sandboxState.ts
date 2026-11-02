// The sandbox a session's Bash calls run under, merged from the settings layers Claude Code reads. See docs/claude-code-guardrails.md.
// Managed settings aren't read: the repo deploys none, and a session's own layers are the ones a step or the developer can change.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface SandboxState {
  // `enabled` and no way out through `allowUnsandboxedCommands`.
  isOn: boolean;
  excludedCommands: string[];
  filesystem: Record<string, unknown>;
}

export interface SettingsLayers {
  home: string;
  sessionRoot: string;
  // A runner step's `--settings` is the gate root's settings.json; an Interactive session has none.
  gateRoot: string | undefined;
}

type Layer = Record<string, unknown> | "malformed" | undefined;

// Lowest precedence first, as Claude Code's settings docs order them.
function layerPathsOf({
  home,
  sessionRoot,
  gateRoot,
}: SettingsLayers): string[] {
  return [
    join(home, ".claude", "settings.json"),
    join(sessionRoot, ".claude", "settings.json"),
    join(sessionRoot, ".claude", "settings.local.json"),
    ...(gateRoot === undefined
      ? []
      : [join(gateRoot, ".claude", "settings.json")]),
  ];
}

export function sandboxStateOf(layers: SettingsLayers): SandboxState {
  const read = layerPathsOf(layers).map(layerAt);
  const sandbox = read.reduce<Record<string, unknown>>((merged, layer) => {
    if (layer === undefined || layer === "malformed") return merged;
    return mergedOf(merged, objectOf(layer.sandbox));
  }, {});
  // A broken file asks rather than frees.
  const isMalformed = read.includes("malformed");
  return {
    isOn:
      !isMalformed &&
      sandbox.enabled === true &&
      sandbox.allowUnsandboxedCommands === false,
    excludedCommands: stringsOf(sandbox.excludedCommands),
    filesystem: objectOf(sandbox.filesystem),
  };
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
