import { describe, expect, it } from "vitest";

import { fakeGoogle } from "../Docs/restFixtures.ts";
import { RestSheetValues } from "./RestSheetValues.ts";

const titles = (...names: string[]) =>
  Response.json({ sheets: names.map((title) => ({ properties: { title } })) });

describe("RestSheetValues", () => {
  it("reads a tab's rows as the token's account", async () => {
    const google = fakeGoogle(
      titles("friction"),
      Response.json({ values: [["id"], ["n-1"]] }),
    );
    const values = RestSheetValues.init({
      accessToken: "ya29.ready",
      fetch: google.fetch,
    });

    expect(await values.rowsOf("sheet-1", "friction")).toEqual([
      ["id"],
      ["n-1"],
    ]);
    expect(google.sent.map(({ authorization }) => authorization)).toEqual([
      "Bearer ya29.ready",
      "Bearer ya29.ready",
    ]);
    expect(google.sent[1]?.url).toBe(
      "https://sheets.googleapis.com/v4/spreadsheets/sheet-1/values/'friction'!A1%3AZZ?majorDimension=ROWS",
    );
  });

  it("reads no rows from a tab the Sheet lacks", async () => {
    const values = RestSheetValues.init({
      accessToken: "ya29.ready",
      fetch: fakeGoogle(titles("Sheet1")).fetch,
    });

    expect(await values.rowsOf("sheet-1", "friction")).toEqual([]);
  });

  it("adds a missing tab before writing its rows as text", async () => {
    const google = fakeGoogle(
      titles("Sheet1"),
      Response.json({}),
      Response.json({}),
    );
    const values = RestSheetValues.init({
      accessToken: "ya29.ready",
      fetch: google.fetch,
    });

    await values.write("sheet-1", "outcomes", [["Key"], ["byro-repo-1"]]);

    expect(google.sent.map(({ method }) => method)).toEqual([
      "GET",
      "POST",
      "PUT",
    ]);
    expect(JSON.parse(google.sent[1]?.body ?? "")).toEqual({
      requests: [{ addSheet: { properties: { title: "outcomes" } } }],
    });
    expect(google.sent[2]?.url).toContain("?valueInputOption=RAW");
    expect(JSON.parse(google.sent[2]?.body ?? "")).toEqual({
      majorDimension: "ROWS",
      values: [["Key"], ["byro-repo-1"]],
    });
  });

  it("names the status and request of a refusal", async () => {
    const values = RestSheetValues.init({
      accessToken: "ya29.ready",
      fetch: fakeGoogle(new Response("Not allowed.", { status: 403 })).fetch,
    });

    await expect(values.rowsOf("sheet-1", "friction")).rejects.toThrow(
      /^Sheets API 403 for GET .*: Not allowed\.$/,
    );
  });
});
