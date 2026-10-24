import { describe, expect, it } from "vitest";

import type { EditDecision } from "./fullDocRead.ts";
import {
  isTierTableBashRead,
  isTierTableRead,
  readFirstDecision,
  type ReadFirstRow,
  readFirstRows,
  tierTablePath,
} from "./readFirstGate.ts";
import { BashReads } from "./tiers/bashReads.ts";

const projectDir = "/repo";
function edit(
  filePath: string,
  docsRead: string[],
  cwd = projectDir,
): EditDecision {
  return readFirstDecision({ projectDir, cwd, filePath }, docsRead);
}

const coveredPaths = [
  "/repo/.claude/hooks/lib/tiers/tiers.ts",
  "/repo/.claude/hooks/lib/tiers/driveTiers.test.ts",
  "/repo/.claude/hooks/tierGate.ts",
  "/repo/.claude/hooks/gmailGate.ts",
  "/repo/.claude/settings.json",
  "/repo/.claude/settings.local.json",
  "/repo/packages/framework/.claude/settings.json",
  "/repo/.claude/worktrees/byro-repo-issue-1-x/.claude/settings.json",
  "/repo/runner/src/claudeWriteDecision.ts",
];

describe("readFirstDecision with the tiers row", () => {
  it.each(coveredPaths)("refuses %s before the tier table is read", (path) => {
    expect(edit(path, []).denyReason).toMatch(/docs\/targets-and-gates\.md/);
  });

  it.each(coveredPaths)("allows %s after the tier table is read", (path) => {
    expect(edit(path, [tierTablePath])).toEqual({ denyReason: undefined });
  });

  it("always allows an unrelated file", () => {
    expect(edit("/repo/.claude/hooks/lib/proseGate.ts", [])).toEqual({
      denyReason: undefined,
    });
    expect(edit("/repo/runner/src/ClaudeAgentStep.ts", [])).toEqual({
      denyReason: undefined,
    });
    expect(edit("/repo/.claude/settings/notes.md", [])).toEqual({
      denyReason: undefined,
    });
    expect(edit("/elsewhere/.claude/settings.json", [])).toEqual({
      denyReason: undefined,
    });
  });

  it("judges a relative path from the working directory against the project root", () => {
    expect(
      edit("tiers.ts", [], "/repo/.claude/hooks/lib/tiers").denyReason,
    ).toBeDefined();
    expect(
      edit("../.claude/settings.json", [], "/repo/runner").denyReason,
    ).toBeDefined();
    expect(edit("tiers.ts", [], "/repo/.claude/hooks/lib")).toEqual({
      denyReason: undefined,
    });
  });

  it("doesn't count another doc as the tier table", () => {
    expect(
      edit("/repo/.claude/settings.json", ["docs/prose-style.md"]).denyReason,
    ).toBeDefined();
  });
});

describe("the refusal reason", () => {
  const reason = edit("/repo/.claude/settings.json", []).denyReason;

  it("names the tier table and asks for a full read", () => {
    expect(reason).toMatch(/docs\/targets-and-gates\.md \(the tier table\)/);
    expect(reason).toMatch(/full Read/);
    expect(reason).toMatch(/retry/);
  });

  it("states both tier-change rules", () => {
    expect(reason).toContain(
      "Change a tier rule only when your ticket or the developer's request calls for it; then no extra yes is needed. When neither does, leave the rule alone and don't ask.",
    );
    expect(reason).toContain(
      "The tier table and the tier code change in the same commit.",
    );
  });
});

describe("readFirstDecision over a given table", () => {
  const throwingRow: ReadFirstRow = {
    docPath: "docs/broken.md",
    docName: "the broken doc",
    rules: [],
    covers: () => {
      throw new Error("bad row");
    },
  };
  const markdownRow: ReadFirstRow = {
    docPath: "docs/prose-style.md",
    docName: "the prose rules",
    rules: ["Keep it short."],
    covers: (target) => target.endsWith(".md"),
  };

  it("fails a throwing row open while another row still refuses", () => {
    const decision = readFirstDecision(
      { projectDir, cwd: projectDir, filePath: "/repo/AGENTS.md" },
      [],
      [throwingRow, markdownRow],
    );
    expect(decision.denyReason).toMatch(/docs\/prose-style\.md/);
    expect(decision.denyReason).not.toMatch(/broken/);
  });

  it("names every doc still missing in one refusal", () => {
    const decision = readFirstDecision(
      { projectDir, cwd: projectDir, filePath: "/repo/.claude/settings.json" },
      [],
      [...readFirstRows, { ...markdownRow, covers: () => true }],
    );
    expect(decision.denyReason).toMatch(
      /docs\/targets-and-gates\.md \(the tier table\) and docs\/prose-style\.md \(the prose rules\)/,
    );
    expect(decision.denyReason).toContain("Keep it short.");
  });

  it("drops a row whose doc was read", () => {
    const decision = readFirstDecision(
      { projectDir, cwd: projectDir, filePath: "/repo/.claude/settings.json" },
      [tierTablePath],
      [...readFirstRows, { ...markdownRow, covers: () => true }],
    );
    expect(decision.denyReason).not.toMatch(/targets-and-gates/);
    expect(decision.denyReason).toMatch(/prose-style/);
  });
});

describe("isTierTableRead", () => {
  function read(bounds: { offset?: number; limit?: number } = {}): boolean {
    return isTierTableRead({
      projectDir,
      cwd: projectDir,
      filePath: "/repo/docs/targets-and-gates.md",
      totalLines: 120,
      ...bounds,
    });
  }

  it("counts a Read covering the whole file", () => {
    expect(read()).toBe(true);
    expect(read({ offset: 1, limit: 2000 })).toBe(true);
  });

  it("doesn't count a partial Read", () => {
    expect(read({ limit: 40 })).toBe(false);
    expect(read({ offset: 30 })).toBe(false);
  });
});

describe("isTierTableBashRead", () => {
  function bashRead(command: string): boolean {
    const wholeFilePaths = BashReads.init({
      command,
      cwd: projectDir,
      projectDir,
    }).wholeFilePaths();
    return isTierTableBashRead(projectDir, wholeFilePaths);
  }

  it("counts a whole-file cat", () => {
    expect(bashRead("cat docs/targets-and-gates.md")).toBe(true);
  });

  it("doesn't count a cat a pipe trims", () => {
    expect(bashRead("cat docs/targets-and-gates.md | head -20")).toBe(false);
  });
});
