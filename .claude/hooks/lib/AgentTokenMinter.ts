// An access token for the agent account, from the gworkspace server's stored credentials: the tier gate's Drive owner lookup (tiers/driveOwners.ts) and `npm run google:script` (scripts/googleScript/) both take theirs here.
// A minted token isn't written back, so the server's own file is never raced, and no error names the refresh token.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const agentAccount = "byronbroughtenai@gmail.com";

// The credentials folder the gworkspace server's registration names; neither the hook nor the script sees the server's env.
const defaultCredentialsDir = join(homedir(), ".config", "gworkspace-mcp");
const googleTokenUri = "https://oauth2.googleapis.com/token";
const requestTimeoutMs = 5000;
const reauthorize =
  "re-authorize the agent account with `scripts/setup-agent-account-mcp.sh`";

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

interface MinterPlaces {
  credentialsDir: string;
  fetch: typeof fetch;
}

export class AgentTokenMinter {
  private readonly places: MinterPlaces;

  constructor(places: MinterPlaces) {
    this.places = places;
  }

  static init(places: Partial<MinterPlaces> = {}): AgentTokenMinter {
    return new AgentTokenMinter({
      credentialsDir: places.credentialsDir ?? defaultCredentialsDir,
      fetch: places.fetch ?? fetch,
    });
  }

  // The server's stored token while it lasts, else a minted one.
  async current(): Promise<string> {
    const stored = this._storedToken;
    if (stored.token && !hasExpired(stored.expiry)) return stored.token;
    return this._mintedFrom(stored);
  }

  // A fresh token from the stored refresh token, whatever the stored token's expiry.
  async minted(): Promise<string> {
    return this._mintedFrom(this._storedToken);
  }

  private get _storedToken(): StoredToken {
    return JSON.parse(
      readFileSync(
        join(this.places.credentialsDir, "credentials", `${agentAccount}.json`),
        "utf8",
      ),
    );
  }

  private async _mintedFrom(stored: StoredToken): Promise<string> {
    if (!stored.refresh_token) {
      throw new Error(
        `The agent account has no refresh token stored; ${reauthorize}.`,
      );
    }
    const client = { ...this._clientPair, ...definedPairOf(stored) };
    if (!client.client_id || !client.client_secret) {
      throw new Error(
        `The agent account has no OAuth client stored; ${reauthorize}.`,
      );
    }
    const response = await this.places.fetch(
      stored.token_uri ?? googleTokenUri,
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
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const error = fieldOf(body, "error");
      throw new Error(
        `Google's token endpoint refused the agent account's refresh (${response.status} ${typeof error === "string" ? error : "no error named"}); ${reauthorize}.`,
      );
    }
    const accessToken = fieldOf(body, "access_token");
    if (typeof accessToken !== "string") {
      throw new Error("Google's token endpoint returned no access token.");
    }
    return accessToken;
  }

  private get _clientPair(): ClientPair {
    try {
      const secret = JSON.parse(
        readFileSync(
          join(this.places.credentialsDir, "client_secret.json"),
          "utf8",
        ),
      );
      return secret.installed ?? secret.web ?? {};
    } catch {
      return {};
    }
  }
}

// google-auth writes expiry as naive UTC; a minute's margin covers the call the token is for.
function hasExpired(expiry: string | undefined): boolean {
  if (expiry === undefined) return true;
  const utc = /Z|[+-]\d\d:\d\d$/.test(expiry) ? expiry : `${expiry}Z`;
  const expiresAt = Date.parse(utc);
  return Number.isNaN(expiresAt) || expiresAt - 60_000 <= Date.now();
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
