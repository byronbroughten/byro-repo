// Friction notes: one Markdown file per note in the friction folder under the primary root's state folder, its fields at
// the top between `---` lines and the note below them. A note's id is `<date>-<session>-<k>`, or `<date>-<k>` with no
// session, `<k>` counting from 1 past the highest that date and session already hold, and its file is `<id>.md`; an
// agent writing a note by hand forms it the same way, so two sessions filing at once never pick the same file.
// No note is ever deleted, and only log mode changes a status. SpecRun/ReviewItemDecider.ts files one per decided Propose.

import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
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
  // Blank, `addressed <link>` or `dismissed: <reason>`.
  status: string;
  body: string;
}

export interface WrittenNote {
  id: string;
  path: string;
}

export function frictionFolderOf(stateFolder: string): string {
  return join(stateFolder, "friction");
}

export function noteDateOf(time: Date): string {
  const month = String(time.getMonth() + 1).padStart(2, "0");
  const day = String(time.getDate()).padStart(2, "0");
  return `${time.getFullYear()}-${month}-${day}`;
}

// `wx` refuses a file another writer took meanwhile, so the next number is tried instead.
export function writeFrictionNote(
  folder: string,
  note: FrictionNote,
): WrittenNote {
  mkdirSync(folder, { recursive: true });
  const prefix = idPrefixOf(note);
  for (let k = nextNumberOf(folder, prefix); ; k += 1) {
    const id = `${prefix}${k}`;
    const path = join(folder, `${id}.md`);
    try {
      writeFileSync(path, noteFileOf(id, note), { flag: "wx" });
      return { id, path };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
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

export function noteFileOf(id: string, note: FrictionNote): string {
  const fields = [
    ["id", id],
    ["date", note.date],
    ["session", note.session],
    ["workflow", note.workflow],
    ["filed-by", note.filedBy],
    ["source", note.source],
    ["status", note.status],
  ];
  const lines = fields.map(([name, value]) =>
    value === "" ? `${name}:` : `${name}: ${value}`,
  );
  return ["---", ...lines, "---", "", note.body, ""].join("\n");
}
