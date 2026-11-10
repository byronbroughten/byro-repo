import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DocsRequestRefused } from "./DocsRequestRefused.ts";
import type { GoogleDocument } from "./googleDocs.ts";
import { RestDocuments } from "./RestDocuments.ts";

interface SentRequest {
  url: string;
  method: string;
  authorization: string | undefined;
  body: string;
}

const document: GoogleDocument = {
  documentId: "doc-1",
  revisionId: "rev-1",
  body: { content: [] },
};

function credentialFile(contents: object): string {
  const path = join(
    mkdtempSync(join(tmpdir(), "rest-documents-")),
    "docs.json",
  );
  writeFileSync(path, JSON.stringify(contents));
  return path;
}

const loggedIn = {
  tokens: {
    default: {
      client_id: "client-1",
      client_secret: "secret-1",
      refresh_token: "refresh-1",
    },
  },
};

/** A fetch answering Google's token endpoint and then each Docs call with the next scripted answer. */
function fakeGoogle(...docsAnswers: Response[]): {
  fetch: typeof fetch;
  sent: SentRequest[];
} {
  const sent: SentRequest[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
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
  };
  return { fetch: fakeFetch, sent };
}

describe("RestDocuments", () => {
  it("reads a Doc with its suggestions inline, as the developer's clasp login", async () => {
    const google = fakeGoogle(Response.json(document));
    const documents = RestDocuments.init({
      credentialPath: credentialFile(loggedIn),
      fetch: google.fetch,
    });

    expect(await documents.documentOf("doc-1")).toEqual(document);
    const [tokenRequest, getRequest] = google.sent;
    expect(new URLSearchParams(tokenRequest?.body)).toEqual(
      new URLSearchParams({
        client_id: "client-1",
        client_secret: "secret-1",
        refresh_token: "refresh-1",
        grant_type: "refresh_token",
      }),
    );
    expect(getRequest).toMatchObject({
      url: "https://docs.googleapis.com/v1/documents/doc-1?suggestionsViewMode=SUGGESTIONS_INLINE",
      method: "GET",
      authorization: "Bearer ya29.access",
    });
  });

  it("sends a batchUpdate under its required revision, minting the token once", async () => {
    const google = fakeGoogle(
      Response.json(document),
      Response.json({ replies: [] }),
    );
    const documents = RestDocuments.init({
      credentialPath: credentialFile(loggedIn),
      fetch: google.fetch,
    });
    const update = {
      requests: [{ insertText: { text: "Hi", location: { index: 1 } } }],
      writeControl: { requiredRevisionId: "rev-1" },
    };

    await documents.documentOf("doc-1");
    await documents.batchUpdate("doc-1", update);

    expect(google.sent.map(({ url }) => url)).toEqual([
      "https://oauth2.googleapis.com/token",
      "https://docs.googleapis.com/v1/documents/doc-1?suggestionsViewMode=SUGGESTIONS_INLINE",
      "https://docs.googleapis.com/v1/documents/doc-1:batchUpdate",
    ]);
    expect(google.sent[2]).toMatchObject({
      method: "POST",
      authorization: "Bearer ya29.access",
    });
    expect(JSON.parse(google.sent[2]?.body ?? "")).toEqual(update);
  });

  it("rejects a refused request with its status", async () => {
    const google = fakeGoogle(
      new Response("The required revision ID does not match.", { status: 400 }),
    );
    const documents = RestDocuments.init({
      credentialPath: credentialFile(loggedIn),
      fetch: google.fetch,
    });

    await expect(
      documents.batchUpdate("doc-1", {
        requests: [],
        writeControl: { requiredRevisionId: "rev-0" },
      }),
    ).rejects.toThrow(
      new DocsRequestRefused(
        400,
        "Docs API 400 for POST https://docs.googleapis.com/v1/documents/doc-1:batchUpdate: The required revision ID does not match.",
      ),
    );
  });

  it("names the credential file and its login step when it holds no login", async () => {
    const path = credentialFile({ tokens: {} });
    const documents = RestDocuments.init({
      credentialPath: path,
      fetch: fakeGoogle().fetch,
    });

    await expect(documents.documentOf("doc-1")).rejects.toThrow(
      `No clasp login in ${path}; run the Docs login step in the runner README's Setup section.`,
    );
  });
});
