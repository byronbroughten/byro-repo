import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { backlinkLineOf, type Clones, withBacklink } from "./backlink.ts";

const rootAdr = "docs/adr/0007-issue-reader.md";
const frameworkAdr = "packages/framework/docs/adr/0009-selector-options.md";
const line = `Design decision: byronbroughten/byro-repo/${rootAdr}`;
const frameworkLine =
  "Design decision: byronbroughten/sheets-framework/docs/adr/0009-selector-options.md";

let clones: Clones;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "backlink-"));
  [rootAdr, frameworkAdr, "docs/agents/jev.md"].forEach((path) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), "");
  });
  clones = {
    owner: "byronbroughten",
    root,
    clonePaths: { "byro-repo": ".", "sheets-framework": "packages/framework" },
  };
});

afterEach(() => {
  rmSync(clones.root, { recursive: true, force: true });
});

describe("backlinkLineOf", () => {
  it("names the root repo for an ADR in the workspace root's docs/adr", () => {
    expect(backlinkLineOf(rootAdr, clones)).toBe(line);
  });

  it("names the clone an ADR's path sits in", () => {
    expect(backlinkLineOf(frameworkAdr, clones)).toBe(frameworkLine);
  });

  it("refuses a path that isn't directly under a clone's docs/adr", () => {
    [
      "docs/agents/jev.md",
      "packages/other/docs/adr/0001-x.md",
      "../docs/adr/0007-issue-reader.md",
    ].forEach((path) =>
      expect(() => backlinkLineOf(path, clones)).toThrow(
        "docs/adr/NNNN-slug.md",
      ),
    );
  });

  it("refuses an ADR path with no file behind it", () => {
    expect(() =>
      backlinkLineOf("docs/adr/0099-not-written.md", clones),
    ).toThrow("no file");
  });
});

describe("withBacklink", () => {
  it("puts the first backlink after a blank line", () => {
    expect(withBacklink("## Problem\n\nText.", line)).toBe(
      `## Problem\n\nText.\n\n${line}`,
    );
  });

  it("puts a later backlink straight after the block", () => {
    expect(withBacklink(`Text.\n\n${frameworkLine}`, line)).toBe(
      `Text.\n\n${frameworkLine}\n${line}`,
    );
  });

  it("returns a body whose block already holds the line unchanged", () => {
    [`Text.\n\n${line}`, `Text.\n\n${line}\n${frameworkLine}`].forEach((body) =>
      expect(withBacklink(body, line)).toBe(body),
    );
  });

  it("treats a trailing newline or CRLF line ends as the body's own", () => {
    expect(withBacklink("Text.\n", line)).toBe(`Text.\n\n${line}`);
    expect(withBacklink(`Text.\n\n${line}\n`, line)).toBe(`Text.\n\n${line}\n`);
    expect(withBacklink(`Text.\r\n\r\n${line}\r\n`, line)).toBe(
      `Text.\r\n\r\n${line}\r\n`,
    );
  });
});
