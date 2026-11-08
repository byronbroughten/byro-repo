import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AgentTokenMinter } from "./AgentTokenMinter.ts";

const refreshToken = "1//stored-refresh-token";

interface SentRequest {
  url: string;
  body: URLSearchParams;
}

function credentialsDirWith(
  stored: Record<string, unknown>,
  clientSecret?: Record<string, unknown>,
): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-token-"));
  mkdirSync(join(dir, "credentials"));
  writeFileSync(
    join(dir, "credentials", "byronbroughtenai@gmail.com.json"),
    JSON.stringify(stored),
  );
  if (clientSecret) {
    writeFileSync(
      join(dir, "client_secret.json"),
      JSON.stringify(clientSecret),
    );
  }
  return dir;
}

// A fake token endpoint: it records each request and answers with the given status and body.
function tokenEndpoint(status: number, body: Record<string, unknown>) {
  const sent: SentRequest[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), body: init?.body as URLSearchParams });
    return new Response(JSON.stringify(body), { status });
  };
  return { sent, fetch: fetch as typeof globalThis.fetch };
}

describe("AgentTokenMinter", () => {
  it("mints an access token from the stored refresh token and client pair", async () => {
    const endpoint = tokenEndpoint(200, { access_token: "ya29.minted" });
    const credentialsDir = credentialsDirWith(
      {
        token: "ya29.stored",
        refresh_token: refreshToken,
        token_uri: "https://oauth2.example.test/token",
        expiry: "2999-01-01T00:00:00",
      },
      { installed: { client_id: "id-1", client_secret: "secret-1" } },
    );

    const token = await AgentTokenMinter.init({
      credentialsDir,
      fetch: endpoint.fetch,
    }).minted();

    expect(token).toBe("ya29.minted");
    expect(endpoint.sent).toHaveLength(1);
    const [request] = endpoint.sent;
    expect(request?.url).toBe("https://oauth2.example.test/token");
    expect(Object.fromEntries(request?.body ?? [])).toEqual({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: "id-1",
      client_secret: "secret-1",
    });
  });

  it("takes the stored client pair over client_secret.json's, and Google's endpoint when none is stored", async () => {
    const endpoint = tokenEndpoint(200, { access_token: "ya29.minted" });
    const credentialsDir = credentialsDirWith(
      { refresh_token: refreshToken, client_id: "id-2", client_secret: "s-2" },
      { installed: { client_id: "id-1", client_secret: "secret-1" } },
    );

    await AgentTokenMinter.init({
      credentialsDir,
      fetch: endpoint.fetch,
    }).minted();

    const [request] = endpoint.sent;
    expect(request?.url).toBe("https://oauth2.googleapis.com/token");
    expect(request?.body.get("client_id")).toBe("id-2");
    expect(request?.body.get("client_secret")).toBe("s-2");
  });

  it("keeps a stored token that hasn't expired as the current one, minting none", async () => {
    const endpoint = tokenEndpoint(200, { access_token: "ya29.minted" });
    const credentialsDir = credentialsDirWith({
      token: "ya29.stored",
      refresh_token: refreshToken,
      client_id: "id-2",
      client_secret: "s-2",
      expiry: "2999-01-01T00:00:00",
    });

    const minter = AgentTokenMinter.init({
      credentialsDir,
      fetch: endpoint.fetch,
    });

    expect(await minter.current()).toBe("ya29.stored");
    expect(endpoint.sent).toHaveLength(0);
  });

  it("mints a current token once the stored one has expired", async () => {
    const endpoint = tokenEndpoint(200, { access_token: "ya29.minted" });
    const credentialsDir = credentialsDirWith({
      token: "ya29.stored",
      refresh_token: refreshToken,
      client_id: "id-2",
      client_secret: "s-2",
      expiry: "2000-01-01T00:00:00",
    });

    const token = await AgentTokenMinter.init({
      credentialsDir,
      fetch: endpoint.fetch,
    }).current();

    expect(token).toBe("ya29.minted");
  });

  it("names Google's error and the setup script when the endpoint refuses, never the refresh token", async () => {
    const endpoint = tokenEndpoint(400, { error: "invalid_grant" });
    const credentialsDir = credentialsDirWith({
      refresh_token: refreshToken,
      client_id: "id-2",
      client_secret: "s-2",
    });

    const minting = AgentTokenMinter.init({
      credentialsDir,
      fetch: endpoint.fetch,
    }).minted();

    await expect(minting).rejects.toThrow(/400 invalid_grant/);
    await expect(minting).rejects.toThrow(/setup-agent-account-mcp\.sh/);
    await expect(minting).rejects.not.toThrow(refreshToken);
  });

  it("refuses to mint with no stored refresh token or no client pair", async () => {
    const endpoint = tokenEndpoint(200, { access_token: "ya29.minted" });
    const noRefresh = credentialsDirWith({ token: "ya29.stored" });
    const noClient = credentialsDirWith({ refresh_token: refreshToken });

    await expect(
      AgentTokenMinter.init({
        credentialsDir: noRefresh,
        fetch: endpoint.fetch,
      }).minted(),
    ).rejects.toThrow(/no refresh token/);
    await expect(
      AgentTokenMinter.init({
        credentialsDir: noClient,
        fetch: endpoint.fetch,
      }).minted(),
    ).rejects.toThrow(/no OAuth client/);
    expect(endpoint.sent).toHaveLength(0);
  });
});
