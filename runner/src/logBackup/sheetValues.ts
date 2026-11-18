// The Sheets values layer the log backup copies through: a tab's rows of text cells, read and written from A1.

/** A tab's rows, the header first, each a list of text cells. */
export type TabRows = string[][];

export interface SheetValuesPort {
  /** A tab's rows, with trailing blank cells and rows left off as the API leaves them; none for a tab the Sheet lacks. */
  rowsOf(spreadsheetId: string, tab: string): Promise<TabRows>;
  /** Writes `rows` over the tab from A1 as text, adding the tab first when the Sheet lacks it. */
  write(spreadsheetId: string, tab: string, rows: TabRows): Promise<void>;
}
