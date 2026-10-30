import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { backfilledOutcomeFile } from "./outcomeBackfill.ts";

const fixtures = join(import.meta.dirname, "..", "fixtures", "transcripts");

let home: string;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "backfill-")));
  cpSync(fixtures, join(home, "shared", "projects", "-workspace-byro-repo"), {
    recursive: true,
  });
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const blankRow = [
  "# byro-repo#9 outcome",
  "",
  "| Issue | Pair | Account | Files changed | Peak context | Result | Proposals | Review rounds | Retries | Duration | Cost (API-equivalent) | Review cost | What review caught | Session ids |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  "| #9 | unrecorded | unrecorded | 3 | unrecorded | Pass | 0 | 1 | 0 | unrecorded | unrecorded | unrecorded | a \\| b | unrecorded |",
  "",
].join("\n");

const sessions = [
  { agent: "implement" as const, sessionId: "session-implement-2", account: 1 },
  { agent: "review" as const, sessionId: "session-review", account: 2 },
];

function rowOf(file: string): string {
  return file.split("\n")[4] ?? "";
}

describe("backfilledOutcomeFile", () => {
  it("fills every transcript fact from sessions found under any config folder", () => {
    const accountTwo = join(home, "account-2");
    mkdirSync(join(accountTwo, "projects", "p"), { recursive: true });
    renameSync(
      join(
        home,
        "shared",
        "projects",
        "-workspace-byro-repo",
        "session-review.jsonl",
      ),
      join(accountTwo, "projects", "p", "session-review.jsonl"),
    );
    const file = backfilledOutcomeFile(blankRow, sessions, [
      join(home, "shared"),
      accountTwo,
    ]);
    expect(rowOf(file)).toBe(
      "| #9 | Opus medium | 1, 2 | 3 | 90K | Pass | 0 | 1 | 0 | 24 min | $0.17 | $0.02 | a \\| b | session-implement-2, session-review |",
    );
  });

  it("keeps a fact unrecorded only when a transcript it reads is gone", () => {
    rmSync(
      join(
        home,
        "shared",
        "projects",
        "-workspace-byro-repo",
        "session-review.jsonl",
      ),
    );
    const missing = backfilledOutcomeFile(blankRow, sessions, [
      join(home, "shared"),
    ]);
    expect(rowOf(missing)).toBe(
      "| #9 | Opus medium | 1, 2 | 3 | 90K | Pass | 0 | 1 | 0 | unrecorded | $0.17 | unrecorded | a \\| b | session-implement-2, session-review |",
    );
  });
});
