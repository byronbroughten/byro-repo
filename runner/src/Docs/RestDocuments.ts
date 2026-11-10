// The real `DocumentsPort`: the Docs REST API's `documents.get` and
// `documents.batchUpdate`, as the developer. It refreshes an access token from
// the clasp login in the credential file its caller names, the Docs module's
// own file, never a Sheets credential; the one-time login is the runner
// README's Setup section. A Doc is read with its suggestions inline, the view
// `batchUpdate` indices address.

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

/** Where the port reads its clasp login from and how it reaches Google. */
interface RestSources {
  credentialPath: string;
  fetch: typeof fetch;
}

interface ClaspLogin {
  client_id: string;
  client_secret: string;
  refresh_token: string;
}

export class RestDocuments implements DocumentsPort {
  private readonly sources: RestSources;
  private accessToken: Promise<string> | undefined;

  constructor(sources: RestSources) {
    this.sources = sources;
  }

  static init(
    sources: Pick<RestSources, "credentialPath"> & Partial<RestSources>,
  ): RestDocuments {
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
    this.accessToken ??= this._minted();
    const response = await this.sources.fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${await this.accessToken}`,
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

  private async _minted(): Promise<string> {
    const login = this._login();
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
        `Google's token endpoint refused the clasp login in ${this.sources.credentialPath} (${response.status}); ${loginStep}.`,
      );
    }
    return accessToken;
  }

  private _login(): ClaspLogin {
    const { credentialPath } = this.sources;
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
}

const loginStep =
  "run the Docs login step in the runner README's Setup section";
