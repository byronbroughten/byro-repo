import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sandboxOffContextOf } from "./sandboxOffContext.ts";
import { sandboxStateOf, type SettingsLayers } from "./sandboxState.ts";

function folderWith(settings: unknown): string {
  const root = mkdtempSync(join(tmpdir(), "sandbox-off-context-"));
  mkdirSync(join(root, ".claude"));
  writeFileSync(
    join(root, ".claude", "settings.json"),
    typeof settings === "string" ? settings : JSON.stringify(settings),
  );
  return root;
}

function layersOf(user: unknown, project: unknown): SettingsLayers {
  return {
    userConfigDir: join(folderWith(user), ".claude"),
    sessionRoot: folderWith(project),
    gateRoot: undefined,
  };
}

const onBlock = {
  enabled: true,
  allowUnsandboxedCommands: false,
  excludedCommands: ["npm test"],
};

describe("sandboxOffContextOf", () => {
  it("adds nothing when the sandbox is on", () => {
    const state = sandboxStateOf(layersOf({}, { sandbox: onBlock }));
    expect(sandboxOffContextOf(state)).toBeUndefined();
  });

  it("names `enabled` not being true and its fix", () => {
    const state = sandboxStateOf(
      layersOf({}, { sandbox: { ...onBlock, enabled: false } }),
    );
    expect(sandboxOffContextOf(state)).toBe(
      'The sandbox is off for this session, as `sandbox.enabled` isn\'t true. Every Bash call not made only of `excludedCommands` entries will ask for a yes, and in a runner step be refused. To turn the box back on, set `"enabled": true` in the `sandbox` block.',
    );
  });

  it("names `allowUnsandboxedCommands` not being false and its fix", () => {
    const state = sandboxStateOf(
      layersOf(
        {},
        { sandbox: { ...onBlock, allowUnsandboxedCommands: undefined } },
      ),
    );
    expect(sandboxOffContextOf(state)).toBe(
      'The sandbox is off for this session, as `sandbox.allowUnsandboxedCommands` isn\'t false. Every Bash call not made only of `excludedCommands` entries will ask for a yes, and in a runner step be refused. To turn the box back on, set `"allowUnsandboxedCommands": false` in the `sandbox` block.',
    );
  });

  it("says every call asks when a layer can't be parsed, since it leaves no entries", () => {
    const layers = layersOf("{ not json", { sandbox: onBlock });
    const state = sandboxStateOf(layers);
    expect(sandboxOffContextOf(state)).toBe(
      `The sandbox is off for this session, as the settings layer \`${join(layers.userConfigDir, "settings.json")}\` can't be parsed. Every Bash call will ask for a yes, and in a runner step be refused. To turn the box back on, fix that file's JSON.`,
    );
  });
});
