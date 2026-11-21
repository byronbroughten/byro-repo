import { afterEach, describe, expect, it, vi } from "vitest";

import { heldSendsSetting } from "./gateLookups.ts";
import { folderWith } from "./settingsLayersFixture.ts";

function localSettingsWith(content: unknown): string {
  return folderWith({ "settings.local.json": content });
}

describe("heldSendsSetting.at", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads agentDiscretion from the env block of the primary's settings.local.json", () => {
    const root = localSettingsWith({
      env: { BYRO_HELD_SENDS: "agentDiscretion" },
    });
    expect(heldSendsSetting.at(root)).toBe("agentDiscretion");
  });

  it("reads confirm for confirm, no value, an unknown value or a top-level key", () => {
    for (const settings of [
      { env: { BYRO_HELD_SENDS: "confirm" } },
      { env: {} },
      {},
      { env: { BYRO_HELD_SENDS: "yes" } },
      { BYRO_HELD_SENDS: "agentDiscretion" },
      { env: "BYRO_HELD_SENDS=agentDiscretion" },
    ]) {
      expect(heldSendsSetting.at(localSettingsWith(settings))).toBe("confirm");
    }
  });

  it("reads confirm for a missing or malformed file", () => {
    expect(heldSendsSetting.at(folderWith({}))).toBe("confirm");
    expect(heldSendsSetting.at(localSettingsWith("{ not json"))).toBe(
      "confirm",
    );
    expect(heldSendsSetting.at(localSettingsWith("[]"))).toBe("confirm");
  });

  it("ignores the process environment's value", () => {
    vi.stubEnv("BYRO_HELD_SENDS", "agentDiscretion");
    expect(heldSendsSetting.at(localSettingsWith({}))).toBe("confirm");
  });
});

describe("heldSendsSetting.read", () => {
  it("reads confirm from a folder in no git checkout, which has no primary", () => {
    const root = localSettingsWith({
      env: { BYRO_HELD_SENDS: "agentDiscretion" },
    });
    expect(heldSendsSetting.read(root)).toBe("confirm");
  });
});
