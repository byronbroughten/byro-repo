import { describe, expect, it } from "vitest";

import { docPrint } from "./docPrint.ts";
import { fixtureDocument } from "./Docs/docFixtures.ts";
import { FakeDocuments } from "./Docs/FakeDocuments.ts";
import { RestDocuments } from "./Docs/RestDocuments.ts";
import { credentialFile, fakeGoogle, loggedIn } from "./Docs/restFixtures.ts";

const documents = new FakeDocuments([fixtureDocument("headings")]);
const headingsMarkdown =
  "# A Field Guide to Kettles\n\n## Why kettles\n\nA kettle boils water faster than a pan.\n\n### Spouts\n\nMost spouts face away.\n\n## Which kettle\n\nBuy the one with a whistle.\n";
const account = "agent@example.com";

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
      fetch: fakeGoogle(Response.json(fixtureDocument("headings"))).fetch,
    });
    const fromFile = RestDocuments.init({
      credentialPath: credentialFile(loggedIn),
      fetch: fakeGoogle(Response.json(fixtureDocument("headings"))).fetch,
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
        fetch: fakeGoogle(new Response("Not allowed.", { status })).fetch,
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
      fetch: fakeGoogle(new Response("Down.", { status: 500 })).fetch,
    });

    await expect(
      docPrint.markdownOf(refused, { doc: "doc-1", account }),
    ).rejects.toThrow(/^Docs API 500 for GET /);
  });
});
