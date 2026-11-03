import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sandboxOffContextOf } from "./sandboxOffContext.ts";
import { sandboxStateOf } from "./sandboxState.ts";
import { layersOf, onBlock } from "./settingsLayersFixture.ts";

const entriesBlock = { ...onBlock, excludedCommands: ["npm test"] };

function contextOf(sandbox: Record<string, unknown>): string | undefined {
  return sandboxOffContextOf(
    sandboxStateOf(layersOf({ project: { "settings.json": { sandbox } } })),
  );
}

describe("sandboxOffContextOf", () => {
  it("adds nothing when the sandbox is on", () => {
    expect(contextOf(entriesBlock)).toBeUndefined();
  });

  it("names `enabled` not being true and its fix", () => {
    expect(contextOf({ ...entriesBlock, enabled: false })).toBe(
      'For this session, the sandbox is off, as `sandbox.enabled` isn\'t true. Every Bash call not made only of `excludedCommands` entries will ask for a yes, and in a runner step be refused. To turn the box back on, set `"enabled": true` in the `sandbox` block.',
    );
  });

  it("names `allowUnsandboxedCommands` not being false and its fix", () => {
    expect(
      contextOf({ ...entriesBlock, allowUnsandboxedCommands: undefined }),
    ).toBe(
      'For this session, the sandbox is off, as `sandbox.allowUnsandboxedCommands` isn\'t false. Every Bash call not made only of `excludedCommands` entries will ask for a yes, and in a runner step be refused. To turn the box back on, set `"allowUnsandboxedCommands": false` in the `sandbox` block.',
    );
  });

  it("says every call asks when a layer can't be parsed, since it leaves no entries", () => {
    const layers = layersOf({
      user: { "settings.json": "{ not json" },
      project: { "settings.json": { sandbox: entriesBlock } },
    });
    expect(sandboxOffContextOf(sandboxStateOf(layers))).toBe(
      `For this session, the sandbox is off, as the settings layer \`${join(layers.userConfigDir, "settings.json")}\` can't be parsed. Every Bash call will ask for a yes, and in a runner step be refused. To turn the box back on, fix that file's JSON.`,
    );
  });
});
