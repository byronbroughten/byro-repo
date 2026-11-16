import { describe, expect, it } from "vitest";

import { DocsRequestRefused } from "./DocsRequestRefused.ts";
import type { GoogleDocument } from "./googleDocs.ts";
import { RestDocuments } from "./RestDocuments.ts";
import { credentialFile, fakeGoogle, loggedIn } from "./restFixtures.ts";

const document: GoogleDocument = {
  documentId: "doc-1",
  revisionId: "rev-1",
  body: { content: [] },
};

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

  it("reads a Doc as a ready access token, minting nothing", async () => {
    const google = fakeGoogle(Response.json(document));
    const documents = RestDocuments.init({
      accessToken: "ya29.ready",
      fetch: google.fetch,
    });

    expect(await documents.documentOf("doc-1")).toEqual(document);
    expect(google.sent).toHaveLength(1);
    expect(google.sent[0]).toMatchObject({
      url: "https://docs.googleapis.com/v1/documents/doc-1?suggestionsViewMode=SUGGESTIONS_INLINE",
      authorization: "Bearer ya29.ready",
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
