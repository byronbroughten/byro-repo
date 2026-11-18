// Friction notes: one Markdown file per note in the friction folder under the primary root's state folder, its fields at
// the top between `---` lines and the note below them. A note's id is `<date>-<session>-<k>`, or `<date>-<k>` with no
// session, `<k>` counting from 1 past the highest that date and session already hold, and its file is `<id>.md`; an
// agent writing a note by hand forms it the same way, so two sessions filing at once never pick the same file.
// No note is ever deleted, and only log mode changes a status. SpecRun/ReviewItemDecider.ts files one per decided Propose;
// logBackup.ts reads them for `npm run logs` and writes one back on a restore.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type { WorkflowName } from "./Workflow.ts";

// `shared` for friction no one Workflow owns.
export type NoteWorkflow = WorkflowName | "shared";

export type NoteFiler = "developer" | "agent" | "judge-findings";

export interface FrictionNote {
  // `YYYY-MM-DD`, local.
  date: string;
  // The filing session's id; blank when it has none.
  session: string;
  workflow: NoteWorkflow;
  filedBy: NoteFiler;
  // `<repo>#<spec> R<n>.<k>`, or blank.
  source: string;
  status: NoteStatus;
  body: string;
}

export type NoteStatus = "" | `addressed ${string}` | `dismissed: ${string}`;

/** A note as its file holds it, with the id it was filed under; a hand-written or restored file's fields are unchecked text. */
export type WrittenNote = Record<keyof FrictionNote | "id", string>;

/** A written note's fields as its file names them, the body last. */
export const noteFieldNames = [
  "id",
  "date",
  "session",
  "workflow",
  "filed-by",
  "source",
  "status",
  "body",
] as const;

type NoteFieldName = (typeof noteFieldNames)[number];

export function frictionFolderOf(stateFolder: string): string {
  return join(stateFolder, "friction");
}

// `wx` refuses a file another writer took meanwhile, so the next number is tried instead.
export function writeFrictionNote(folder: string, note: FrictionNote): void {
  mkdirSync(folder, { recursive: true });
  const prefix = idPrefixOf(note);
  for (let k = nextNumberOf(folder, prefix); ; k += 1) {
    const id = `${prefix}${k}`;
    if (writtenAnew(folder, { ...note, id })) return;
  }
}

/** The notes in `folder`, by file name; none for a missing folder. */
export function writtenNotesIn(folder: string): WrittenNote[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) =>
      writtenNoteOf(name, readFileSync(join(folder, name), "utf8")),
    );
}

/** Writes a read note back under its own id, leaving a file already there alone; whether it wrote one. */
export function restoreFrictionNote(
  folder: string,
  note: WrittenNote,
): boolean {
  mkdirSync(folder, { recursive: true });
  return writtenAnew(folder, note);
}

/** A written note's fields by the names its file gives them. */
export function fieldsOfNote(note: WrittenNote): Map<NoteFieldName, string> {
  return new Map([
    ["id", note.id],
    ["date", note.date],
    ["session", note.session],
    ["workflow", note.workflow],
    ["filed-by", note.filedBy],
    ["source", note.source],
    ["status", note.status],
    ["body", note.body],
  ]);
}

/** The note whose fields, by the names its file gives them, are `fields`; a missing field is blank. */
export function noteOfFields(fields: Map<string, string>): WrittenNote {
  return {
    id: fields.get("id") ?? "",
    date: fields.get("date") ?? "",
    session: fields.get("session") ?? "",
    workflow: fields.get("workflow") ?? "",
    filedBy: fields.get("filed-by") ?? "",
    source: fields.get("source") ?? "",
    status: fields.get("status") ?? "",
    body: fields.get("body") ?? "",
  };
}

function idPrefixOf({ date, session }: FrictionNote): string {
  return session === "" ? `${date}-` : `${date}-${session}-`;
}

function nextNumberOf(folder: string, prefix: string): number {
  const numbers = readdirSync(folder).flatMap((name) => {
    if (!name.startsWith(prefix) || !name.endsWith(".md")) return [];
    const rest = name.slice(prefix.length, -".md".length);
    return /^\d+$/.test(rest) ? [Number(rest)] : [];
  });
  return Math.max(0, ...numbers) + 1;
}

// `wx`, so a file already there is never overwritten.
function writtenAnew(folder: string, note: WrittenNote): boolean {
  try {
    writeFileSync(join(folder, `${note.id}.md`), noteFileOf(note), {
      flag: "wx",
    });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return false;
  }
}

function noteFileOf(note: WrittenNote): string {
  const lines = [...fieldsOfNote(note)]
    .filter(([name]) => name !== "body")
    .map(([name, value]) => (value === "" ? `${name}:` : `${name}: ${value}`));
  return ["---", ...lines, "---", "", note.body, ""].join("\n");
}

function writtenNoteOf(name: string, file: string): WrittenNote {
  const [, front, body] =
    /^---\n([\s\S]*?)\n---\n\n?([\s\S]*?)\n?$/.exec(file) ?? [];
  if (front === undefined || body === undefined) {
    throw new Error(
      `The friction note ${name} has no fields between --- lines.`,
    );
  }
  const fields = new Map(
    front.split("\n").map((line) => {
      const colon = line.indexOf(":");
      return [line.slice(0, colon), line.slice(colon + 1).trim()];
    }),
  );
  fields.set("body", body);
  fields.set("id", fields.get("id") ?? name.slice(0, -".md".length));
  return noteOfFields(fields);
}
