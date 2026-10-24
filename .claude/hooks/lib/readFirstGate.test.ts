import { describe, expect, it } from "vitest";

import type { EditDecision } from "./fullDocRead.ts";
import {
  codeStylePath,
  proseStylePath,
  readFirstDecision,
  type ReadFirstRow,
  readFirstRows,
  tierTablePath,
} from "./readFirstGate.ts";

const projectDir = "/repo";
const generatedDirs = [
  "packages/real-estate/src/generated",
  "packages/framework/dev/generated",
];
const allDocs = readFirstRows.map((row) => row.docPath);
function except(docPath: string): string[] {
  return allDocs.filter((read) => read !== docPath);
}
function edit(
  filePath: string,
  docsRead: string[],
  cwd = projectDir,
): EditDecision {
  return readFirstDecision(
    { projectDir, cwd, filePath, generatedDirs },
    docsRead,
  );
}
const allowed = { denyReason: undefined };

const tierPaths = [
  "/repo/.claude/hooks/lib/tiers/tiers.ts",
  "/repo/.claude/hooks/lib/tiers/driveTiers.test.ts",
  "/repo/.claude/hooks/tierGate.ts",
  "/repo/.claude/hooks/gmailGate.ts",
  "/repo/.claude/settings.json",
  "/repo/.claude/settings.local.json",
  "/repo/packages/framework/.claude/settings.json",
  "/repo/.claude/worktrees/byro-repo-issue-1-x/.claude/settings.json",
  "/repo/runner/src/claudeWriteDecision.ts",
  "/repo/.claude/worktrees/byro-repo-issue-1-x/.claude/hooks/lib/tiers/tiers.ts",
  "/repo/.claude/worktrees/byro-repo-issue-1-x/.claude/hooks/tierGate.ts",
  "/repo/.claude/worktrees/byro-repo-issue-1-x/runner/src/claudeWriteDecision.ts",
];

describe("the tiers row", () => {
  const unread = except(tierTablePath);

  it.each(tierPaths)("refuses %s before the tier table is read", (path) => {
    expect(edit(path, unread).denyReason).toMatch(
      /docs\/targets-and-gates\.md/,
    );
  });

  it.each(tierPaths)("allows %s after the tier table is read", (path) => {
    expect(edit(path, allDocs)).toEqual(allowed);
  });

  it("allows an unrelated file", () => {
    expect(edit("/repo/.claude/hooks/lib/lintSet.ts", unread)).toEqual(allowed);
    expect(edit("/repo/runner/src/ClaudeAgentStep.ts", unread)).toEqual(
      allowed,
    );
    expect(edit("/repo/.claude/settings/notes.md", unread)).toEqual(allowed);
    expect(edit("/elsewhere/.claude/settings.json", unread)).toEqual(allowed);
  });

  it("judges a relative path from the working directory against the project root", () => {
    expect(
      edit("tiers.ts", unread, "/repo/.claude/hooks/lib/tiers").denyReason,
    ).toBeDefined();
    expect(
      edit("../.claude/settings.json", unread, "/repo/runner").denyReason,
    ).toBeDefined();
    expect(edit("tiers.ts", unread, "/repo/.claude/hooks/lib")).toEqual(
      allowed,
    );
  });

  it("states both tier-change rules", () => {
    const reason = edit("/repo/.claude/settings.json", []).denyReason;
    expect(reason).toMatch(/docs\/targets-and-gates\.md \(the tier table\)/);
    expect(reason).toContain(
      "Change a tier rule only when your ticket or the developer's request calls for it; then no extra yes is needed. When neither does, leave the rule alone and don't ask.",
    );
    expect(reason).toContain(
      "The tier table and the tier code change in the same commit.",
    );
  });
});

describe("the code-style row", () => {
  const unread = except(codeStylePath);
  const frameworkFile =
    "/repo/packages/framework/src/02_SpreadsheetRaw/SheetRaw.ts";

  it.each([
    frameworkFile,
    "/repo/packages/real-estate/src/index.ts",
    "/repo/packages/framework/dev/devConfigs.ts",
    "/repo/.claude/hooks/lib/bashReads.ts",
    "/repo/scripts/docLint.ts",
    "/repo/packages/framework/scripts/rollupPreset.js",
    "/repo/eslint.config.mjs",
  ])(
    "refuses %s, which ESLint lints, before the code rules are read",
    (path) => {
      expect(edit(path, unread).denyReason).toMatch(
        /config\/docs\/code-style\.md \(the code rules\)/,
      );
    },
  );

  it("refuses a relative path resolved from the working directory", () => {
    expect(
      edit(
        "SheetRaw.ts",
        unread,
        "/repo/packages/framework/src/02_SpreadsheetRaw",
      ).denyReason,
    ).toBeDefined();
  });

  it("allows a linted edit after the code rules are read", () => {
    expect(edit(frameworkFile, [codeStylePath])).toEqual(allowed);
  });

  it.each([
    "/repo/packages/framework/dist/bundle.js",
    "/repo/coverage/prettify.js",
    "/repo/node_modules/x/index.js",
    "/repo/.claude/worktrees/agent-1/scripts/docLint.ts",
    "/elsewhere/packages/framework/src/x.ts",
    "/repo/packages/framework/src/AGENTS.md",
    "/repo/packages/framework/sheets.config.json",
    "/repo/packages/real-estate/src/generated/sheetConfigs.ts",
    "/repo/packages/framework/dev/generated/sheetConfigs.ts",
  ])("allows %s, outside the ESLint set or generated", (path) => {
    expect(edit(path, unread)).toEqual(allowed);
  });

  it("points at the framework's rules and the reasoning folder, without saying it only covers packages/", () => {
    const reason = edit(frameworkFile, []).denyReason;
    expect(reason).toContain(
      "Framework or app code also follows packages/framework/docs/code-style.md.",
    );
    expect(reason).toMatch(/config\/docs\/code-style\//);
    expect(reason).not.toMatch(/under packages/);
  });
});

describe("the prose-style row", () => {
  const unread = except(proseStylePath);

  it.each([
    "/repo/AGENTS.md",
    "/repo/.claude/skills/tdd/SKILL.md",
    "/repo/packages/framework/README.md",
    "/repo/docs/adr/0011-x.md",
  ])("refuses %s before the prose rules are read", (path) => {
    expect(edit(path, unread).denyReason).toMatch(
      /docs\/prose-style\.md \(the prose rules\)/,
    );
  });

  it("judges a relative path from the working directory against the project root", () => {
    expect(
      edit("AGENTS.md", unread, "/repo/packages/framework/src").denyReason,
    ).toBeDefined();
    expect(
      edit("../writing/pieces/a.md", unread, "/repo/packages/framework"),
    ).toEqual(allowed);
  });

  it("allows a markdown edit after the prose rules are read", () => {
    expect(edit("/repo/AGENTS.md", [proseStylePath])).toEqual(allowed);
  });

  it.each([
    "/repo/packages/writing/pieces/a.md",
    "/repo/docs/agents/outcomes/byro-repo-382/byro-repo-384.md",
    "/repo/package.json",
    "/elsewhere/AGENTS.md",
    "/repo/node_modules/x/README.md",
    "/repo/.claude/worktrees/agent-1/AGENTS.md",
  ])("allows %s, which the row skips", (path) => {
    expect(edit(path, unread)).toEqual(allowed);
  });

  it("allows a code edit", () => {
    expect(edit("/repo/scripts/docLint.ts", [codeStylePath])).toEqual(allowed);
  });

  it("points at the reasoning folder", () => {
    expect(edit("/repo/AGENTS.md", []).denyReason).toMatch(
      /docs\/prose-style\//,
    );
  });
});

describe("the refusal reason", () => {
  it("asks for a full read and a retry, and says a partial read doesn't count", () => {
    const reason = edit("/repo/AGENTS.md", []).denyReason;
    expect(reason).toMatch(/full Read/);
    expect(reason).toMatch(/partial/);
    expect(reason).toMatch(/retry/);
  });

  it("names both docs in one refusal for tier code before either is read", () => {
    const reason = edit(
      "/repo/.claude/hooks/lib/tiers/tiers.ts",
      [],
    ).denyReason;
    expect(reason).toMatch(
      /docs\/targets-and-gates\.md \(the tier table\) and config\/docs\/code-style\.md \(the code rules\)/,
    );
    expect(reason).toContain(
      "The tier table and the tier code change in the same commit.",
    );
    expect(reason).toContain(
      "Framework or app code also follows packages/framework/docs/code-style.md.",
    );
  });
});

describe("readFirstDecision over a given table", () => {
  const throwingRow: ReadFirstRow = {
    docPath: "docs/broken.md",
    docName: "the broken doc",
    marker: "broken-read",
    rules: [],
    covers: () => {
      throw new Error("bad row");
    },
  };
  const markdownRow: ReadFirstRow = {
    docPath: "docs/notes.md",
    docName: "the notes",
    marker: "notes-read",
    rules: ["Keep it short."],
    covers: (target) => target.endsWith(".md"),
  };

  it("fails a throwing row open while another row still refuses", () => {
    const decision = readFirstDecision(
      {
        projectDir,
        cwd: projectDir,
        filePath: "/repo/AGENTS.md",
        generatedDirs,
      },
      [],
      [throwingRow, markdownRow],
    );
    expect(decision.denyReason).toMatch(/docs\/notes\.md \(the notes\)/);
    expect(decision.denyReason).toContain("Keep it short.");
    expect(decision.denyReason).not.toMatch(/broken/);
  });
});
