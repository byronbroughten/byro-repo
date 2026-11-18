// The real `SheetValuesPort`: the Sheets REST API's `values.get` and `values.update`, and `batchUpdate`'s `addSheet` for
// a tab the Sheet lacks, on an access token its caller mints, so the port never sees a refresh token.

import type { SheetValuesPort, TabRows } from "./sheetValues.ts";

const spreadsheetsUrl = "https://sheets.googleapis.com/v4/spreadsheets";

interface SpreadsheetTitles {
  sheets?: { properties?: { title?: string } }[];
}

export class RestSheetValues implements SheetValuesPort {
  private readonly accessToken: string;
  private readonly fetch: typeof fetch;

  constructor(accessToken: string, fetchOf: typeof fetch) {
    this.accessToken = accessToken;
    this.fetch = fetchOf;
  }

  static init({
    accessToken,
    fetch: fetchOf = fetch,
  }: {
    accessToken: string;
    fetch?: typeof fetch;
  }): RestSheetValues {
    return new RestSheetValues(accessToken, fetchOf);
  }

  async rowsOf(spreadsheetId: string, tab: string): Promise<TabRows> {
    if (!(await this._tabsOf(spreadsheetId)).includes(tab)) return [];
    const response = await this._sent(
      "GET",
      `${valuesUrlOf(spreadsheetId, tab)}?majorDimension=ROWS`,
    );
    const { values } = (await response.json()) as { values?: TabRows };
    return values ?? [];
  }

  async write(
    spreadsheetId: string,
    tab: string,
    rows: TabRows,
  ): Promise<void> {
    if (!(await this._tabsOf(spreadsheetId)).includes(tab)) {
      await this._sent(
        "POST",
        `${spreadsheetsUrl}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
        JSON.stringify({
          requests: [{ addSheet: { properties: { title: tab } } }],
        }),
      );
    }
    await this._sent(
      "PUT",
      `${valuesUrlOf(spreadsheetId, tab)}?valueInputOption=RAW`,
      JSON.stringify({ majorDimension: "ROWS", values: rows }),
    );
  }

  private async _tabsOf(spreadsheetId: string): Promise<string[]> {
    const response = await this._sent(
      "GET",
      `${spreadsheetsUrl}/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`,
    );
    const { sheets = [] } = (await response.json()) as SpreadsheetTitles;
    return sheets.flatMap((sheet) => sheet.properties?.title ?? []);
  }

  private async _sent(
    method: "GET" | "POST" | "PUT",
    url: string,
    body?: string,
  ): Promise<Response> {
    const response = await this.fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body,
    });
    if (!response.ok) {
      throw new Error(
        `Sheets API ${response.status} for ${method} ${url}: ${await response.text()}`,
      );
    }
    return response;
  }
}

// A quoted A1 range from A1, so a tab name is never read as a cell reference.
function valuesUrlOf(spreadsheetId: string, tab: string): string {
  return `${spreadsheetsUrl}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`'${tab}'!A1:ZZ`)}`;
}
