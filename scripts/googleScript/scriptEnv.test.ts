import { describe, expect, it } from "vitest";

import { scriptEnvOf } from "./scriptEnv.ts";

describe("scriptEnvOf", () => {
  it("hands the script the access token and the account it belongs to", () => {
    const env = scriptEnvOf({ PATH: "/usr/bin" }, "ya29.minted");

    expect(env).toEqual({
      PATH: "/usr/bin",
      GOOGLE_ACCESS_TOKEN: "ya29.minted",
      GOOGLE_ACCOUNT: "byronbroughtenai@gmail.com",
    });
  });

  it("drops every Google or workspace-mcp variable the caller had, credential paths included", () => {
    const env = scriptEnvOf(
      {
        HOME: "/Users/x",
        GOOGLE_APPLICATION_CREDENTIALS: "/Users/x/key.json",
        GOOGLE_CLIENT_SECRET_PATH:
          "/Users/x/.config/gworkspace-mcp/client_secret.json",
        WORKSPACE_MCP_CREDENTIALS_DIR:
          "/Users/x/.config/gworkspace-mcp/credentials",
        GOOGLE_ACCESS_TOKEN: "ya29.someone-elses",
      },
      "ya29.minted",
    );

    expect(env).toEqual({
      HOME: "/Users/x",
      GOOGLE_ACCESS_TOKEN: "ya29.minted",
      GOOGLE_ACCOUNT: "byronbroughtenai@gmail.com",
    });
  });
});
