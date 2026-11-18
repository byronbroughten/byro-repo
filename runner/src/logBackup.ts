// `npm run logs`' core: copies the friction and outcome folders to a Sheet, one tab per log and one row per file, and
// rebuilds missing files from it, through the Sheets values port its entry passes. A sync adds and updates rows but
// never deletes one, and a restore never overwrites a file, so the Sheet stays the logs' backup (ADR 0030). The tabs
// are logBackup/logTabs.ts; the entry, which builds the REST port on a token minted for the agent account, is
// `scripts/runner/logs.ts`.

import { type LogFolders, type LogTab, logTabs } from "./logBackup/logTabs.ts";
import type { SheetValuesPort, TabRows } from "./logBackup/sheetValues.ts";

/** The Sheet, by its ID, and the folders it backs up. */
interface LogBackupRequest extends LogFolders {
  sheet: string;
}

export const logBackup = {
  /** Adds each file's missing row and updates each changed one, a line per tab saying how many. */
  async sync(
    values: SheetValuesPort,
    { sheet, ...folders }: LogBackupRequest,
  ): Promise<string> {
    return linesPerTab(async (tab) => {
      const held = await values.rowsOf(sheet, tab.name);
      const { rows, added, updated } = mergedRows(
        tab,
        held,
        tab.rowsIn(folders),
      );
      if (added + updated > 0) {
        await values.write(sheet, tab.name, [[...tab.header], ...rows]);
      }
      return `${tab.name}: ${added} added, ${updated} updated`;
    });
  },

  /** Writes the file of each row whose file is missing, a line per tab saying how many. */
  async restore(
    values: SheetValuesPort,
    { sheet, ...folders }: LogBackupRequest,
  ): Promise<string> {
    return linesPerTab(async (tab) => {
      const [header = [], ...rows] = await values.rowsOf(sheet, tab.name);
      let written = 0;
      for (const row of rows) {
        if ((row[0] ?? "") === "") continue;
        const cells = new Map(
          header.map((name, index) => [name, row[index] ?? ""]),
        );
        if (tab.restore(folders, cells)) written += 1;
      }
      return `${tab.name}: ${written} files written`;
    });
  },
};

async function linesPerTab(
  lineOf: (tab: LogTab) => Promise<string>,
): Promise<string> {
  const lines = [];
  for (const tab of logTabs) lines.push(await lineOf(tab));
  return `${lines.join("\n")}\n`;
}

interface MergedRows {
  rows: TabRows;
  added: number;
  updated: number;
}

// The held rows in their order under the tab's header, each file's row replacing its key's or appended.
function mergedRows(tab: LogTab, held: TabRows, fileRows: TabRows): MergedRows {
  const [heldHeader = [], ...heldRows] = held;
  const rows = heldRows.map((row) =>
    tab.header.map((name) => row[heldHeader.indexOf(name)] ?? ""),
  );
  const indexByKey = new Map(rows.map((row, index) => [row[0], index]));
  return fileRows.reduce<MergedRows>(
    (merged, row) => {
      const index = indexByKey.get(row[0]);
      if (index === undefined) {
        merged.rows.push(row);
        merged.added += 1;
      } else if (
        row.some((cell, column) => cell !== merged.rows[index]?.[column])
      ) {
        merged.rows[index] = row;
        merged.updated += 1;
      }
      return merged;
    },
    { rows, added: 0, updated: 0 },
  );
}
