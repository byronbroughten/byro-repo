// The tier gate's real owner lookup: the gworkspace server's stored token for the agent account, refreshed when expired, asking Drive for a file's owners only.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { OwnerLookup } from "./driveTiers.ts";

// The credentials folder the gworkspace server's registration names; the hook doesn't see the server's env.
const credentialsDir = join(homedir(), ".config", "gworkspace-mcp");
const agentAccount = "byronbroughtenai@gmail.com";
const requestTimeoutMs = 5000;

// workspace-mcp's stored google-auth credentials; a client pair missing here comes from client_secret.json.
interface StoredToken {
  token?: string;
  refresh_token?: string;
  token_uri?: string;
  client_id?: string;
  client_secret?: string;
  expiry?: string;
}

interface ClientPair {
  client_id?: string;
  client_secret?: string;
}

// Any failure, a thrown one included, is undefined, which the gate treats as not the developer's.
export async function driveOwnersOf(fileId: string): ReturnType<OwnerLookup> {
  try {
    const accessToken = await accessTokenOf(readStoredToken());
    if (accessToken === undefined) return undefined;
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=owners(emailAddress)&supportsAllDrives=true`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    if (!response.ok) return undefined;
    const owners = fieldOf(await response.json(), "owners");
    if (!Array.isArray(owners)) return undefined;
    return owners.flatMap((owner) =>
      typeof owner?.emailAddress === "string" ? [owner.emailAddress] : [],
    );
  } catch {
    return undefined;
  }
}

function readStoredToken(): StoredToken {
  return JSON.parse(
    readFileSync(
      join(credentialsDir, "credentials", `${agentAccount}.json`),
      "utf8",
    ),
  );
}

// The refreshed token isn't written back, so the server's own file is never raced.
async function accessTokenOf(stored: StoredToken): Promise<string | undefined> {
  if (stored.token && !hasExpired(stored.expiry)) return stored.token;
  if (!stored.refresh_token) return undefined;
  const client = { ...readClientPair(), ...definedPairOf(stored) };
  if (!client.client_id || !client.client_secret) return undefined;
  const response = await fetch(
    stored.token_uri ?? "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: stored.refresh_token,
        client_id: client.client_id,
        client_secret: client.client_secret,
      }),
      signal: AbortSignal.timeout(requestTimeoutMs),
    },
  );
  if (!response.ok) return undefined;
  const accessToken = fieldOf(await response.json(), "access_token");
  return typeof accessToken === "string" ? accessToken : undefined;
}

// google-auth writes expiry as naive UTC; a minute's margin covers the Drive call.
function hasExpired(expiry: string | undefined): boolean {
  if (expiry === undefined) return true;
  const utc = /Z|[+-]\d\d:\d\d$/.test(expiry) ? expiry : `${expiry}Z`;
  const expiresAt = Date.parse(utc);
  return Number.isNaN(expiresAt) || expiresAt - 60_000 <= Date.now();
}

function readClientPair(): ClientPair {
  try {
    const secret = JSON.parse(
      readFileSync(join(credentialsDir, "client_secret.json"), "utf8"),
    );
    return secret.installed ?? secret.web ?? {};
  } catch {
    return {};
  }
}

function definedPairOf({ client_id, client_secret }: StoredToken): ClientPair {
  return {
    ...(client_id ? { client_id } : {}),
    ...(client_secret ? { client_secret } : {}),
  };
}

function fieldOf(body: unknown, key: string): unknown {
  return body && typeof body === "object"
    ? (body as Record<string, unknown>)[key]
    : undefined;
}
