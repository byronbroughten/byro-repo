import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { docPrint } from "./docPrint.ts";
import { fixtureDocument } from "./Docs/docFixtures.ts";
import { FakeDocuments } from "./Docs/FakeDocuments.ts";
import { RestDocuments } from "./Docs/RestDocuments.ts";

const documents = new FakeDocuments([fixtureDocument("headings")]);
const headingsMarkdown =
  "# A Field Guide to Kettles\n\n## Why kettles\n\nA kettle boils water faster than a pan.\n\n### Spouts\n\nMost spouts face away.\n\n## Which kettle\n\nBuy the one with a whistle.\n";
const account = "agent@example.com";

/** A fetch answering the token endpoint, then each Docs call with the next scripted answer. */
function fakeGoogle(...docsAnswers: Response[]): typeof fetch {
  return async (input) => {
    if (String(input) === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "ya29.access" });
    }
    const answer = docsAnswers.shift();
    if (answer === undefined) throw new Error(`No answer for ${input}.`);
    return answer;
  };
}

function credentialFile(): string {
  const path = join(mkdtempSync(join(tmpdir(), "doc-print-")), "docs.json");
  writeFileSync(
    path,
    JSON.stringify({
      tokens: {
        default: {
          client_id: "client-1",
          client_secret: "secret-1",
          refresh_token: "refresh-1",
        },
      },
    }),
  );
  return path;
}

describe("docPrint.markdownOf", () => {
  it("prints a Doc named by its ID as the dialect's Markdown", async () => {
    expect(
      await docPrint.markdownOf(documents, { doc: "doc-headings", account }),
    ).toBe(headingsMarkdown);
  });

  it("prints a Doc named by its URL", async () => {
    expect(
      await docPrint.markdownOf(documents, {
        doc: "https://docs.google.com/document/d/doc-headings/edit?tab=t.0",
        account,
      }),
    ).toBe(headingsMarkdown);
  });

  it("prints the same Markdown through a port built from a token as from a credential file", async () => {
    const fromToken = RestDocuments.init({
      accessToken: "ya29.ready",
      fetch: fakeGoogle(Response.json(fixtureDocument("headings"))),
    });
    const fromFile = RestDocuments.init({
      credentialPath: credentialFile(),
      fetch: fakeGoogle(Response.json(fixtureDocument("headings"))),
    });

    const doc = "doc-headings";
    expect(await docPrint.markdownOf(fromToken, { doc, account })).toBe(
      headingsMarkdown,
    );
    expect(await docPrint.markdownOf(fromFile, { doc, account })).toBe(
      headingsMarkdown,
    );
  });

  it.each([403, 404])(
    "says the Doc may not be shared with the agent account on a %i",
    async (status) => {
      const refused = RestDocuments.init({
        accessToken: "ya29.ready",
        fetch: fakeGoogle(new Response("Not allowed.", { status })),
      });

      await expect(
        docPrint.markdownOf(refused, { doc: "doc-1", account }),
      ).rejects.toThrow(
        `The Doc doc-1 may not be shared with the agent account, ${account} (Docs API ${status}).`,
      );
    },
  );

  it("lets any other refusal through as it was", async () => {
    const refused = RestDocuments.init({
      accessToken: "ya29.ready",
      fetch: fakeGoogle(new Response("Down.", { status: 500 })),
    });

    await expect(
      docPrint.markdownOf(refused, { doc: "doc-1", account }),
    ).rejects.toThrow(/^Docs API 500 for GET /);
  });
});
