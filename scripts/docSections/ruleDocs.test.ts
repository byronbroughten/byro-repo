import { describe, expect, it } from "vitest";

import { ruleDocs } from "./ruleDocs.ts";

const proseStyle = [
  "# Prose style",
  "",
  "Lead.",
  "",
  "## One home per fact",
  "",
  "- **Each file has one job.**",
  "",
  "## File shapes",
  "",
  "- **A rule line is short.**",
  "",
].join("\n");
const docs: Record<string, string> = { "docs/prose-style.md": proseStyle };

function textOf(args: string[]): string {
  return ruleDocs.textOf(args, (path) => {
    const text = docs[path];
    if (text === undefined) throw new Error(`no fixture for ${path}`);
    return text;
  });
}

describe("ruleDocs.textOf", () => {
  it("prints the whole of a doc it knows when no section is named", () => {
    expect(textOf(["docs/prose-style.md"])).toBe(proseStyle);
  });

  it("prints only the named `##` sections, in the order named", () => {
    expect(
      textOf(["./docs/prose-style.md", "File shapes", "One home per fact"]),
    ).toBe(
      [
        "## File shapes\n\n- **A rule line is short.**",
        "## One home per fact\n\n- **Each file has one job.**",
      ].join("\n\n"),
    );
  });

  it("refuses a doc it doesn't know, naming it and the docs it knows", () => {
    expect(() => textOf(["docs/agents/handoffs.md"])).toThrow(
      /`docs\/agents\/handoffs\.md` is no doc `npm run doc:sections` prints; it prints .*docs\/agents\/tickets\.md/,
    );
  });

  it("refuses a section the doc lacks, naming it", () => {
    expect(() => textOf(["docs/prose-style.md", "Smells", "Nope"])).toThrow(
      "`docs/prose-style.md` has no `## Smells` section",
    );
  });

  it("refuses a call naming no doc, with its usage", () => {
    expect(() => textOf([])).toThrow("usage: npm run doc:sections");
  });
});
