// The real `DocumentsPort`: the Docs REST API's `documents.get` and
// `documents.batchUpdate`. Its caller names either the clasp login's credential
// file, the Docs module's own file, never a Sheets credential, whose one-time
// login is the runner README's Setup section and from which the port refreshes
// an access token, or a ready access token, so the port never sees a refresh
// token. A Doc is read with its suggestions inline, the view `batchUpdate`
// indices address.

import { readFileSync } from "node:fs";

import { DocsRequestRefused } from "./DocsRequestRefused.ts";
import type {
  BatchUpdateRequest,
  DocumentsPort,
  GoogleDocument,
} from "./googleDocs.ts";

const googleUrls = {
  token: "https://oauth2.googleapis.com/token",
  documents: "https://docs.googleapis.com/v1/documents",
} as const;

// clasp's own name for the one login in a file `clasp_config_auth` names.
const claspUser = "default";

/** Where the port gets its access token: a clasp login's file it refreshes from, or a token already minted. */
type RestAccess = { credentialPath: string } | { accessToken: string };

/** How the port gets its access token and reaches Google. */
type RestSources = RestAccess & { fetch: typeof fetch };

interface ClaspLogin {
  client_id: string;
  client_secret: string;
  refresh_token: string;
}

export class RestDocuments implements DocumentsPort {
  private readonly sources: RestSources;
  private mintedToken: Promise<string> | undefined;

  constructor(sources: RestSources) {
    this.sources = sources;
  }

  static init(sources: RestAccess & { fetch?: typeof fetch }): RestDocuments {
    return new RestDocuments({ fetch, ...sources });
  }

  async documentOf(documentId: string): Promise<GoogleDocument> {
    const response = await this._sent(
      "GET",
      `${googleUrls.documents}/${encodeURIComponent(documentId)}?suggestionsViewMode=SUGGESTIONS_INLINE`,
    );
    return (await response.json()) as GoogleDocument;
  }

  async batchUpdate(
    documentId: string,
    update: BatchUpdateRequest,
  ): Promise<void> {
    await this._sent(
      "POST",
      `${googleUrls.documents}/${encodeURIComponent(documentId)}:batchUpdate`,
      JSON.stringify(update),
    );
  }

  private async _sent(
    method: "GET" | "POST",
    url: string,
    body?: string,
  ): Promise<Response> {
    const accessToken = await this._accessToken();
    const response = await this.sources.fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body,
    });
    if (!response.ok) {
      throw new DocsRequestRefused(
        response.status,
        `Docs API ${response.status} for ${method} ${url}: ${await response.text()}`,
      );
    }
    return response;
  }

  private async _accessToken(): Promise<string> {
    const { sources } = this;
    if ("accessToken" in sources) return sources.accessToken;
    this.mintedToken ??= this._minted(sources.credentialPath);
    return this.mintedToken;
  }

  private async _minted(credentialPath: string): Promise<string> {
    const login = loginIn(credentialPath);
    const response = await this.sources.fetch(googleUrls.token, {
      method: "POST",
      body: new URLSearchParams({
        client_id: login.client_id,
        client_secret: login.client_secret,
        refresh_token: login.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    const body: unknown = await response.json().catch(() => undefined);
    const accessToken =
      body !== null && typeof body === "object" && "access_token" in body
        ? body.access_token
        : undefined;
    if (!response.ok || typeof accessToken !== "string") {
      throw new Error(
        `Google's token endpoint refused the clasp login in ${credentialPath} (${response.status}); ${loginStep}.`,
      );
    }
    return accessToken;
  }
}

function loginIn(credentialPath: string): ClaspLogin {
  const login: Partial<ClaspLogin> | undefined = JSON.parse(
    readFileSync(credentialPath, "utf8"),
  ).tokens?.[claspUser];
  if (
    login?.client_id === undefined ||
    login.client_secret === undefined ||
    login.refresh_token === undefined
  ) {
    throw new Error(`No clasp login in ${credentialPath}; ${loginStep}.`);
  }
  return {
    client_id: login.client_id,
    client_secret: login.client_secret,
    refresh_token: login.refresh_token,
  };
}

const loginStep =
  "run the Docs login step in the runner README's Setup section";
