// The log backup's two tabs, one per log: each one's header, its rows read from the log's folder and a row's file
// written back. A row's key is its first cell: a note's id, or an outcome row's `<repo>-<n>`.

import {
  fieldsOfNote,
  noteFieldNames,
  noteOfFields,
  restoreFrictionNote,
  writtenNotesIn,
} from "../frictionNotes.ts";
import {
  labelOf,
  restoreOutcomeRow,
  writtenColumns,
  writtenRowOfParts,
  writtenRowsIn,
} from "../outcomeLog.ts";

/** The two log folders a backup copies. */
export interface LogFolders {
  frictionFolder: string;
  outcomeFolder: string;
}

export interface LogTab {
  name: string;
  header: readonly string[];
  /** One row per file, the key first and the cells in the header's order. */
  rowsIn(folders: LogFolders): string[][];
  /** Writes the file a row's cells, by header name, came from, unless one is there; whether it wrote one. */
  restore(folders: LogFolders, cells: Map<string, string>): boolean;
}

const friction: LogTab = {
  name: "friction",
  header: noteFieldNames,
  rowsIn({ frictionFolder }) {
    return writtenNotesIn(frictionFolder).map((note) => {
      const fields = fieldsOfNote(note);
      return noteFieldNames.map((name) => fields.get(name) ?? "");
    });
  },
  restore({ frictionFolder }, cells) {
    return restoreFrictionNote(frictionFolder, noteOfFields(cells));
  },
};

const outcomeKeys = { key: "Key", spec: "Spec" } as const;

const outcomes: LogTab = {
  name: "outcomes",
  header: [outcomeKeys.key, outcomeKeys.spec, ...writtenColumns],
  rowsIn({ outcomeFolder }) {
    return writtenRowsIn(outcomeFolder).map((row) => [
      labelOf(row.issue, "-"),
      row.specUrl,
      ...writtenColumns.map((column) => row.cells.get(column) ?? ""),
    ]);
  },
  restore({ outcomeFolder }, cells) {
    const row = writtenRowOfParts({
      label: cells.get(outcomeKeys.key) ?? "",
      specUrl: cells.get(outcomeKeys.spec) ?? "",
      cells,
    });
    return restoreOutcomeRow(outcomeFolder, row);
  },
};

export const logTabs: readonly LogTab[] = [friction, outcomes];
