import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface SentRequest {
  url: string;
  method: string;
  authorization: string | undefined;
  body: string;
}

export const loggedIn = {
  tokens: {
    default: {
      client_id: "client-1",
      client_secret: "secret-1",
      refresh_token: "refresh-1",
    },
  },
};

export function credentialFile(contents: object): string {
  const path = join(
    mkdtempSync(join(tmpdir(), "rest-documents-")),
    "docs.json",
  );
  writeFileSync(path, JSON.stringify(contents));
  return path;
}

/** A fetch answering Google's token endpoint and then each Docs call with the next scripted answer. */
export function fakeGoogle(...docsAnswers: Response[]): {
  fetch: typeof fetch;
  sent: SentRequest[];
} {
  const sent: SentRequest[] = [];
  async function fakeFetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    const url = String(input);
    const headers = new Headers(init?.headers);
    sent.push({
      url,
      method: init?.method ?? "GET",
      authorization: headers.get("Authorization") ?? undefined,
      body: String(init?.body ?? ""),
    });
    if (url === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "ya29.access" });
    }
    const answer = docsAnswers.shift();
    if (answer === undefined) {
      throw new Error(`No answer scripted for ${url}.`);
    }
    return answer;
  }
  return { fetch: fakeFetch, sent };
}
