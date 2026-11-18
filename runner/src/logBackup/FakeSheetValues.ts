import type { SheetValuesPort, TabRows } from "./sheetValues.ts";

/** An in-memory Sheet of tabs, a write overwriting only the cells it covers, as the Sheets API's does. */
export class FakeSheetValues implements SheetValuesPort {
  readonly tabs = new Map<string, TabRows>();

  async rowsOf(_spreadsheetId: string, tab: string): Promise<TabRows> {
    return trimmed(this.tabs.get(tab) ?? []);
  }

  async write(
    _spreadsheetId: string,
    tab: string,
    rows: TabRows,
  ): Promise<void> {
    const grid = (this.tabs.get(tab) ?? []).map((row) => [...row]);
    for (const [r, row] of rows.entries()) {
      const held = grid[r] ?? [];
      for (const [c, cell] of row.entries()) held[c] = cell;
      grid[r] = held;
    }
    this.tabs.set(tab, grid);
  }
}

function trimmed(grid: TabRows): TabRows {
  const rows = grid.map((row) => {
    const kept = [...row];
    while (kept.length > 0 && (kept.at(-1) ?? "") === "") kept.pop();
    return kept;
  });
  while (rows.length > 0 && rows.at(-1)?.length === 0) rows.pop();
  return rows;
}
