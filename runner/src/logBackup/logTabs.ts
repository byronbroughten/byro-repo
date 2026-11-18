// The log backup's two tabs, one per log: each one's header, its rows read from the log's folder and a row's file
// written back. A row's key is its first cell: a note's id, or an outcome row's `<repo>-<n>`.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import {
  fieldsOfNote,
  noteFieldNames,
  noteOfFields,
  restoreFrictionNote,
  writtenNotesIn,
} from "../frictionNotes.ts";
import type { IssueRef } from "../IssueWorkspaces.ts";
import {
  outcomePathOf,
  type WrittenColumn,
  writtenColumns,
  writtenFileOf,
  writtenRowOf,
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
    return rowFilesIn(outcomeFolder).map(({ key, path }) => {
      const row = writtenRowOf(issueOfKey(key), readFileSync(path, "utf8"));
      return [
        key,
        row.specUrl,
        ...writtenColumns.map((column) => row.cells.get(column) ?? ""),
      ];
    });
  },
  restore({ outcomeFolder }, cells) {
    const specUrl = cells.get(outcomeKeys.spec) ?? "";
    const row = {
      issue: issueOfKey(cells.get(outcomeKeys.key) ?? ""),
      spec: specOfUrl(specUrl),
      specUrl,
      cells: new Map(
        writtenColumns.map((column): [WrittenColumn, string] => [
          column,
          cells.get(column) ?? "",
        ]),
      ),
    };
    const path = outcomePathOf(outcomeFolder, row);
    if (existsSync(path)) return false;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, writtenFileOf(row));
    return true;
  },
};

export const logTabs: readonly LogTab[] = [friction, outcomes];

// A spec's folder of row files; a file beside them, an older log's, isn't a row.
function rowFilesIn(outcomeFolder: string): { key: string; path: string }[] {
  if (!existsSync(outcomeFolder)) return [];
  return readdirSync(outcomeFolder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .flatMap((folder) =>
      readdirSync(join(outcomeFolder, folder))
        .filter((name) => name.endsWith(".md"))
        .sort()
        .map((name) => ({
          key: name.slice(0, -".md".length),
          path: join(outcomeFolder, folder, name),
        })),
    );
}

function issueOfKey(key: string): IssueRef {
  const [, repo, number] = /^(.+)-(\d+)$/.exec(key) ?? [];
  if (repo === undefined) {
    throw new Error(`The outcome row key "${key}" isn't <repo>-<n>.`);
  }
  return { repo, number: Number(number) };
}

function specOfUrl(specUrl: string): IssueRef {
  const [, repo, number] = /\/([^/]+)\/issues\/(\d+)$/.exec(specUrl) ?? [];
  if (repo === undefined) {
    throw new Error(`The outcome row's Spec "${specUrl}" isn't an issue URL.`);
  }
  return { repo, number: Number(number) };
}
