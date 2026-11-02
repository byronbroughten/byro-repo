import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sandboxStateOf, type SettingsLayers } from "./sandboxState.ts";

function folderWith(files: Record<string, unknown>): string {
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

const onBlock = { enabled: true, allowUnsandboxedCommands: false };

function layersOf({
  user = {},
  project = {},
  commandLine,
}: {
  user?: Record<string, unknown>;
  project?: Record<string, unknown>;
  commandLine?: Record<string, unknown>;
}): SettingsLayers {
  return {
    userConfigDir: join(folderWith(user), ".claude"),
    sessionRoot: folderWith(project),
    gateRoot: commandLine ? folderWith(commandLine) : undefined,
  };
}

describe("sandboxStateOf", () => {
  it("merges the user, project and local layers as Claude Code does", () => {
    const state = sandboxStateOf(
      layersOf({
        user: {
          "settings.json": {
            sandbox: {
              enabled: false,
              excludedCommands: ["npm test"],
              filesystem: { allowWrite: ["~/.npm"] },
            },
          },
        },
        project: {
          "settings.json": {
            sandbox: {
              ...onBlock,
              excludedCommands: ["npm test", "npm run app*"],
              filesystem: { allowWrite: ["/tmp"], denyWrite: ["~/.ssh"] },
            },
          },
          "settings.local.json": {
            sandbox: { excludedCommands: ["npm run jev"] },
          },
        },
      }),
    );
    expect(state).toEqual({
      isEnabled: true,
      isOn: true,
      excludedCommands: ["npm test", "npm run app*", "npm run jev"],
      filesystem: { allowWrite: ["~/.npm", "/tmp"], denyWrite: ["~/.ssh"] },
      off: undefined,
    });
  });

  it("adds a runner step's --settings layer above the local one", () => {
    const state = sandboxStateOf(
      layersOf({
        project: {
          "settings.local.json": {
            sandbox: { enabled: false, excludedCommands: ["npm test"] },
          },
        },
        commandLine: {
          "settings.json": {
            sandbox: { ...onBlock, excludedCommands: ["npm run jev"] },
          },
        },
      }),
    );
    expect(state.isOn).toBe(true);
    expect(state.excludedCommands).toEqual(["npm test", "npm run jev"]);
  });

  it("reads off when a higher layer turns the sandbox off, and keeps its entries", () => {
    const state = sandboxStateOf(
      layersOf({
        user: {
          "settings.json": {
            sandbox: { ...onBlock, excludedCommands: ["npm test"] },
          },
        },
        project: { "settings.local.json": { sandbox: { enabled: false } } },
      }),
    );
    expect(state.isOn).toBe(false);
    expect(state.isEnabled).toBe(false);
    expect(state.excludedCommands).toEqual(["npm test"]);
    expect(state.off).toEqual({
      cause: "`sandbox.enabled` isn't true",
      fix: 'set `"enabled": true` in the `sandbox` block',
      excludedCommands: ["npm test"],
    });
  });

  it("reads `allowUnsandboxedCommands: true` as off", () => {
    const state = sandboxStateOf(
      layersOf({
        project: {
          "settings.json": {
            sandbox: { enabled: true, allowUnsandboxedCommands: true },
          },
        },
      }),
    );
    expect(state.isOn).toBe(false);
    expect(state.isEnabled).toBe(true);
    expect(state.off?.cause).toBe(
      "`sandbox.allowUnsandboxedCommands` isn't false",
    );
  });

  it.each([["{ not json"], ["[]"], ["null"]])(
    "reads a layer that exists but isn't a settings object (%s) as off",
    (content) => {
      const layers = layersOf({
        user: { "settings.json": content },
        project: {
          "settings.json": {
            sandbox: { ...onBlock, excludedCommands: ["npm test"] },
          },
        },
      });
      const state = sandboxStateOf(layers);
      expect(state).toEqual({
        isEnabled: true,
        isOn: false,
        excludedCommands: ["npm test"],
        filesystem: { allowWrite: [], denyWrite: [] },
        off: {
          cause: `the settings layer \`${join(layers.userConfigDir, "settings.json")}\` can't be parsed`,
          fix: "fix that file's JSON",
          excludedCommands: [],
        },
      });
    },
  );

  it("skips a missing layer", () => {
    const state = sandboxStateOf({
      userConfigDir: join(tmpdir(), "no-such-home", ".claude"),
      sessionRoot: folderWith({
        "settings.json": { sandbox: onBlock },
      }),
      gateRoot: undefined,
    });
    expect(state).toEqual({
      isEnabled: true,
      isOn: true,
      excludedCommands: [],
      filesystem: { allowWrite: [], denyWrite: [] },
      off: undefined,
    });
  });

  it("drops entries that aren't strings", () => {
    const state = sandboxStateOf(
      layersOf({
        project: {
          "settings.json": {
            sandbox: { ...onBlock, excludedCommands: ["npm test", 3] },
          },
        },
      }),
    );
    expect(state.excludedCommands).toEqual(["npm test"]);
  });
});
