import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const settingsPath = fileURLToPath(
  new URL("../settings.json", import.meta.url),
);

const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
  env: Record<string, string>;
  permissions: { deny: string[] };
  sandbox: {
    excludedCommands: string[];
    network: { allowedDomains: string[] };
  };
};

describe("the project settings, for the live aliases run in the box on the agent-account credential", () => {
  it("leave no `app` or `dev` entry in `excludedCommands`", () => {
    expect(
      settings.sandbox.excludedCommands.filter((entry) =>
        /^npm run (app|dev)\b/.test(entry),
      ),
    ).toEqual([]);
  });

  it.each([
    "sheets.googleapis.com",
    "oauth2.googleapis.com",
    "script.googleapis.com",
  ])("let the box reach `%s`", (host) => {
    expect(settings.sandbox.network.allowedDomains).toContain(host);
  });

  it("point `clasp_config_auth` at the agent credential's absolute path", () => {
    expect(settings.env.clasp_config_auth).toMatch(
      /^\/.+\/\.config\/sheets-framework\/agent-auth\.json$/,
    );
  });

  it("keep the read deny on `~/.clasprc.json`", () => {
    expect(settings.permissions.deny).toContain("Read(~/.clasprc.json)");
  });
});
