import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { type FrictionNote, writeFrictionNote } from "./frictionNotes.ts";
import { logBackup } from "./logBackup.ts";
import { FakeSheetValues } from "./logBackup/FakeSheetValues.ts";

const spreadsheetId = "sheet-1";
const frictionHeader = [
  "id",
  "date",
  "session",
  "workflow",
  "filed-by",
  "source",
  "status",
  "body",
];
const outcomeHeader = [
  "Key",
  "Spec",
  "Issue",
  "Workflow",
  "Pair",
  "Account",
  "Files changed",
  "Estimate",
  "Peak context",
  "Result",
  "Proposals",
  "Review rounds",
  "Retries",
  "Limit resumes",
  "Duration",
  "Cost (API-equivalent)",
  "Review cost",
  "What review caught",
  "Session ids",
  "Landed",
  "Triage cost",
  "Limit used",
];

const note: FrictionNote = {
  date: "2026-11-18",
  session: "s1",
  workflow: "code",
  filedBy: "developer",
  source: "byro-repo#828 R1.2",
  status: "",
  body: "The review list was long.\n\nSecond paragraph.",
};

// A row file as wrap-up writes one, a pipe in a cell escaped.
const outcomeFile = [
  "# byro-repo#834 outcome",
  "",
  "Spec: [byro-repo#828](https://github.com/byronbroughten/byro-repo/issues/828)",
  "",
  "| Issue | Workflow | Pair | Account | Files changed | Estimate | Peak context | Result | Proposals | Review rounds | Retries | Limit resumes | Duration | Cost (API-equivalent) | Review cost | What review caught | Session ids | Landed |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  "| #834 | code | Opus medium | a@example.com | 6 | ~133K | 158K | Pass | 0 | 1 | 0 | 0 | 10 min | $1.92 | $1.88 | Fixed: the \\|Defer word. | s-1, s-2 | 2026-11-17T10:00:00.000Z |",
  "",
].join("\n");

const outcomeRow = [
  "byro-repo-834",
  "https://github.com/byronbroughten/byro-repo/issues/828",
  "#834",
  "code",
  "Opus medium",
  "a@example.com",
  "6",
  "~133K",
  "158K",
  "Pass",
  "0",
  "1",
  "0",
  "0",
  "10 min",
  "$1.92",
  "$1.88",
  "Fixed: the |Defer word.",
  "s-1, s-2",
  "2026-11-17T10:00:00.000Z",
];

let folders: { frictionFolder: string; outcomeFolder: string };
let sheet: FakeSheetValues;

beforeEach(() => {
  const state = mkdtempSync(join(tmpdir(), "log-backup-"));
  folders = {
    frictionFolder: join(state, "friction"),
    outcomeFolder: join(state, "outcomes"),
  };
  sheet = new FakeSheetValues();
});

function request() {
  return { sheet: spreadsheetId, ...folders };
}

function writeOutcomeFile(): void {
  mkdirSync(join(folders.outcomeFolder, "byro-repo-828"), { recursive: true });
  writeFileSync(
    join(folders.outcomeFolder, "byro-repo-828", "byro-repo-834.md"),
    outcomeFile,
  );
}

describe("logBackup.sync", () => {
  it("leaves one row per file, in the tab for its log", async () => {
    writeFrictionNote(folders.frictionFolder, note);
    writeFrictionNote(folders.frictionFolder, { ...note, body: "Another." });
    writeOutcomeFile();

    await logBackup.sync(sheet, request());

    expect(sheet.tabs.get("friction")).toEqual([
      frictionHeader,
      [
        "2026-11-18-s1-1",
        "2026-11-18",
        "s1",
        "code",
        "developer",
        "byro-repo#828 R1.2",
        "",
        "The review list was long.\n\nSecond paragraph.",
      ],
      [
        "2026-11-18-s1-2",
        "2026-11-18",
        "s1",
        "code",
        "developer",
        "byro-repo#828 R1.2",
        "",
        "Another.",
      ],
    ]);
    expect(sheet.tabs.get("outcomes")).toEqual([
      outcomeHeader,
      [...outcomeRow, "", ""],
    ]);
  });

  it("updates the row of a note whose status changed, in place", async () => {
    writeFrictionNote(folders.frictionFolder, note);
    writeFrictionNote(folders.frictionFolder, { ...note, body: "Another." });
    await logBackup.sync(sheet, request());
    const path = join(folders.frictionFolder, "2026-11-18-s1-1.md");
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(
        "status:",
        "status: addressed byro-repo#841",
      ),
    );

    const summary = await logBackup.sync(sheet, request());

    const rows = sheet.tabs.get("friction") ?? [];
    expect(rows.map((row) => [row[0], row[6]])).toEqual([
      ["id", "status"],
      ["2026-11-18-s1-1", "addressed byro-repo#841"],
      ["2026-11-18-s1-2", ""],
    ]);
    expect(summary).toBe(
      "friction: 0 added, 1 updated\noutcomes: 0 added, 0 updated\n",
    );
  });

  it("leaves a row whose file is gone, and rows a developer added, where they were", async () => {
    sheet.tabs.set("friction", [
      frictionHeader,
      ["2026-01-01-1", "2026-01-01", "", "shared", "developer", "", "", "Old."],
    ]);
    writeFrictionNote(folders.frictionFolder, note);

    await logBackup.sync(sheet, request());

    expect(sheet.tabs.get("friction")?.map((row) => row[0])).toEqual([
      "id",
      "2026-01-01-1",
      "2026-11-18-s1-1",
    ]);
  });

  it.each([
    ["missing", () => undefined],
    ["empty", () => mkdirSync(folders.frictionFolder, { recursive: true })],
  ])("leaves the grid unchanged from a %s folder", async (_, makeFolder) => {
    makeFolder();
    const held = [frictionHeader, ["2026-01-01-1", "2026-01-01"]];
    sheet.tabs.set("friction", held);

    await logBackup.sync(sheet, request());

    expect(sheet.tabs.get("friction")).toBe(held);
    expect(sheet.tabs.has("outcomes")).toBe(false);
  });
});

describe("logBackup.restore", () => {
  it("writes every missing file as the synced one, leaving a file already there untouched", async () => {
    writeFrictionNote(folders.frictionFolder, note);
    writeFrictionNote(folders.frictionFolder, { ...note, body: "Another." });
    writeOutcomeFile();
    await logBackup.sync(sheet, request());
    const synced = filesIn(folders);
    const restoredFolders = {
      frictionFolder: join(mkdtempSync(join(tmpdir(), "log-restore-")), "f"),
      outcomeFolder: join(mkdtempSync(join(tmpdir(), "log-restore-")), "o"),
    };
    mkdirSync(restoredFolders.frictionFolder);
    writeFileSync(
      join(restoredFolders.frictionFolder, "2026-11-18-s1-2.md"),
      "kept",
    );

    const summary = await logBackup.restore(sheet, {
      sheet: spreadsheetId,
      ...restoredFolders,
    });

    expect(filesIn(restoredFolders)).toEqual({
      ...synced,
      "friction/2026-11-18-s1-2.md": "kept",
    });
    expect(summary).toBe(
      "friction: 1 files written\noutcomes: 1 files written\n",
    );
  });

  it("writes an outcome file that reads back as the row synced", async () => {
    writeOutcomeFile();
    await logBackup.sync(sheet, request());
    const restored = join(mkdtempSync(join(tmpdir(), "log-restore-")), "o");

    await logBackup.restore(sheet, {
      sheet: spreadsheetId,
      frictionFolder: join(restored, "..", "f"),
      outcomeFolder: restored,
    });

    expect(
      readFileSync(join(restored, "byro-repo-828", "byro-repo-834.md"), "utf8"),
    ).toBe(outcomeFile);
  });

  it("writes nothing from a Sheet with no tabs", async () => {
    await logBackup.restore(sheet, request());

    expect(existsSync(folders.frictionFolder)).toBe(false);
    expect(existsSync(folders.outcomeFolder)).toBe(false);
  });
});

// Each file under the two folders by its log and its path in that log's folder.
function filesIn({
  frictionFolder,
  outcomeFolder,
}: typeof folders): Record<string, string> {
  const outcomes = readdirSync(outcomeFolder, { recursive: true })
    .map(String)
    .filter((path) => path.endsWith(".md"))
    .map((path) => [
      `outcomes/${path}`,
      readFileSync(join(outcomeFolder, path), "utf8"),
    ]);
  const notes = readdirSync(frictionFolder).map((name) => [
    `friction/${name}`,
    readFileSync(join(frictionFolder, name), "utf8"),
  ]);
  return Object.fromEntries([...notes, ...outcomes]);
}
