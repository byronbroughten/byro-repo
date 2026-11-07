import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closingFactsOf } from "./closingFacts.ts";

let temp: string;

beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), "closing-facts-test-"));
});

afterEach(() => {
  rmSync(temp, { recursive: true, force: true });
});

function noteFile(text: string): string {
  const path = join(temp, "closing.md");
  writeFileSync(path, text);
  return path;
}

describe("closingFactsOf", () => {
  it("takes the closing comment and undone boxes from --closing and --undone", () => {
    expect(
      closingFactsOf({
        closing: "Landed it.",
        undone: ["Docs match: Left for #219."],
      }),
    ).toEqual({
      closingComment: "Landed it.",
      boxesUndone: [{ box: "Docs match", reason: "Left for #219." }],
    });
  });

  it("takes the closing comment from --closing-file as written, `$(` and backticks included", () => {
    const note = "Reads `\\$(cd …)` and `` `cd …` `` as nested.";

    expect(
      closingFactsOf({ closingFile: noteFile(`${note}\n`), undone: [] }),
    ).toEqual({ closingComment: note, boxesUndone: [] });
  });

  it("gives no closing facts when neither flag is passed", () => {
    expect(closingFactsOf({ undone: [] })).toBe(undefined);
  });

  it("refuses --closing beside --closing-file", () => {
    expect(() =>
      closingFactsOf({
        closing: "Landed it.",
        closingFile: noteFile("Landed it."),
        undone: [],
      }),
    ).toThrow('Pass --closing "…" or --closing-file <path>, not both');
  });

  it("refuses --undone with no closing comment", () => {
    expect(() => closingFactsOf({ undone: ["Docs match: later."] })).toThrow(
      '--undone needs --closing "…" or --closing-file <path> with it',
    );
  });

  it("refuses an --undone with no reason", () => {
    expect(() =>
      closingFactsOf({ closing: "Landed it.", undone: ["Docs match"] }),
    ).toThrow('--undone takes "<box>: <reason>", not "Docs match"');
  });
});
