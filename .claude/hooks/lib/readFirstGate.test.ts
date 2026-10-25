import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { type EditDecision, isFullDocRead } from "./fullDocRead.ts";
import type { ToolInput } from "./hookIo.ts";
import {
  codeStylePath,
  proseStylePath,
  readFirstDecision,
  type ReadFirstRow,
  readFirstRows,
  tierTablePath,
  writingDocPaths,
} from "./readFirstGate.ts";

const projectDir = "/repo";
const generatedDirs = [
  "packages/real-estate/src/generated",
  "packages/framework/dev/generated",
];
const allDocs = readFirstRows.flatMap((row) => row.docs.map((doc) => doc.path));
function except(...docPaths: string[]): string[] {
  return allDocs.filter((read) => !docPaths.includes(read));
}
function call(
  toolName: string,
  toolInput: ToolInput,
  docsRead: string[],
  cwd = projectDir,
): EditDecision {
  return readFirstDecision(
    { projectDir, cwd, toolName, toolInput, generatedDirs },
    docsRead,
  );
}
function edit(
  filePath: string,
  docsRead: string[],
  cwd = projectDir,
): EditDecision {
  return call("Edit", { file_path: filePath }, docsRead, cwd);
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
    "/repo/.claude/worktrees/agent-1/scripts/docLint.ts",
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
    expect(
      edit("/repo/.claude/worktrees/agent-1/scripts/docLint.ts", [
        codeStylePath,
      ]),
    ).toEqual(allowed);
  });

  it("skips a workspace's generated configs", () => {
    expect(
      edit(
        "/repo/.claude/worktrees/agent-1/packages/real-estate/src/generated/sheetConfigs.ts",
        unread,
      ),
    ).toEqual(allowed);
  });

  it.each([
    "/repo/packages/framework/dist/bundle.js",
    "/repo/coverage/prettify.js",
    "/repo/node_modules/x/index.js",
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
    "/repo/.claude/worktrees/agent-1/AGENTS.md",
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
    expect(
      edit("/repo/.claude/worktrees/agent-1/AGENTS.md", [proseStylePath]),
    ).toEqual(allowed);
  });

  it.each([
    "/repo/packages/writing/pieces/a.md",
    "/repo/docs/agents/outcomes/byro-repo-382/byro-repo-384.md",
    "/repo/package.json",
    "/elsewhere/AGENTS.md",
    "/repo/node_modules/x/README.md",
    "/repo/.claude/worktrees/agent-1/packages/writing/pieces/a.md",
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

describe("the writing row", () => {
  // Real tool inputs carry more fields than the gate reads.
  type DocArgs = ToolInput & Record<string, unknown>;
  const unread = except(writingDocPaths.voice, writingDocPaths.craft);
  function docWrite(
    toolName: string,
    toolInput: DocArgs,
    docsRead: string[],
  ): EditDecision {
    return call(`mcp__gworkspace__${toolName}`, toolInput, docsRead);
  }

  const contentWrites: [string, DocArgs][] = [
    ["create_doc", { content: "Hello, reader." }],
    ["modify_doc_text", { text: "A new sentence.", bold: true }],
    [
      "find_and_replace_doc",
      { find_text: "{{TITLE}}", replace_text: "Q3 report" },
    ],
    ["insert_doc_elements", { element_type: "list", text: "First item" }],
    [
      "batch_update_doc",
      {
        operations: [
          { type: "insert_text", end_of_segment: true, text: "Title\n" },
        ],
      },
    ],
    [
      "batch_update_doc",
      {
        operations: [
          { type: "replace_text", start_index: 1, end_index: 4, text: "New" },
        ],
      },
    ],
    [
      "batch_update_doc",
      {
        operations: [
          { type: "format_text", bold: true },
          { type: "find_replace" },
        ],
      },
    ],
    [
      "batch_update_doc",
      { operations: [{ type: "replace_named_range_content", text: "x" }] },
    ],
  ];

  const formattingWrites: [string, DocArgs][] = [
    ["update_paragraph_style", { heading_level: 1 }],
    ["modify_doc_text", { bold: true, font_size: 12 }],
    [
      "batch_update_doc",
      {
        operations: [
          { type: "format_text", italic: true },
          { type: "update_paragraph_style" },
        ],
      },
    ],
    ["create_doc", { title: "Empty" }],
  ];

  it.each(contentWrites)(
    "refuses a %s text write before either sheet is read",
    (toolName, toolInput) => {
      const reason = docWrite(toolName, toolInput, unread).denyReason;
      expect(reason).toMatch(
        /docs\/writing-voice\.md \(the voice sheet\) and docs\/writing-craft\.md \(the craft sheet\)/,
      );
    },
  );

  it.each(contentWrites)(
    "refuses a %s text write when only one sheet is read, naming the other",
    (toolName, toolInput) => {
      const voiceOnly = docWrite(
        toolName,
        toolInput,
        except(writingDocPaths.craft),
      ).denyReason;
      expect(voiceOnly).toMatch(/docs\/writing-craft\.md/);
      expect(voiceOnly).not.toMatch(/docs\/writing-voice\.md/);
      const craftOnly = docWrite(
        toolName,
        toolInput,
        except(writingDocPaths.voice),
      ).denyReason;
      expect(craftOnly).toMatch(/docs\/writing-voice\.md/);
      expect(craftOnly).not.toMatch(/docs\/writing-craft\.md/);
    },
  );

  it.each(formattingWrites)(
    "allows a formatting-only %s write before the reads",
    (toolName, toolInput) => {
      expect(docWrite(toolName, toolInput, unread)).toEqual(allowed);
    },
  );

  it.each([...contentWrites, ...formattingWrites])(
    "allows a %s write after both sheets are read",
    (toolName, toolInput) => {
      expect(docWrite(toolName, toolInput, allDocs)).toEqual(allowed);
    },
  );

  it("leaves other tools alone", () => {
    expect(call("Edit", { text: "x" }, unread)).toEqual(allowed);
    expect(docWrite("modify_sheet_values", { text: "x" }, unread)).toEqual(
      allowed,
    );
  });

  it("calls Doc text reader-facing prose and points academic work to its sheet", () => {
    const reason = docWrite("create_doc", { content: "x" }, unread).denyReason;
    expect(reason).toMatch(/reader-facing prose/);
    expect(reason).toMatch(/docs\/academic-writing-style\.md/);
    expect(reason).toMatch(/full Read with no offset or limit/);
    expect(reason).toMatch(/retry/);
  });

  describe("a full Read of a writing sheet", () => {
    function read(
      docPath: string,
      filePath: string,
      bounds: { offset?: number; limit?: number } = {},
    ): boolean {
      return isFullDocRead(
        { projectDir, cwd: projectDir, filePath, totalLines: 30, ...bounds },
        docPath,
      );
    }
    const { voice, craft } = writingDocPaths;

    it("is true for a full Read of each sheet", () => {
      expect(read(voice, "/repo/docs/writing-voice.md")).toBe(true);
      expect(read(craft, "/repo/docs/writing-craft.md")).toBe(true);
      expect(
        read(craft, "/repo/docs/writing-craft.md", { offset: 1, limit: 2000 }),
      ).toBe(true);
    });

    it("is false for a partial Read of either sheet", () => {
      expect(read(voice, "/repo/docs/writing-voice.md", { limit: 10 })).toBe(
        false,
      );
      expect(read(craft, "/repo/docs/writing-craft.md", { offset: 5 })).toBe(
        false,
      );
    });

    it("is false for a Read of another file", () => {
      expect(read(voice, "/repo/docs/writing-craft.md")).toBe(false);
      expect(read(craft, "/repo/docs/writing-voice.md")).toBe(false);
      expect(read(voice, "/repo/docs/academic-writing-style.md")).toBe(false);
      expect(read(craft, "/repo/docs/academic-writing-style.md")).toBe(false);
      expect(read(voice, "/repo/docs/writing-voice/register.md")).toBe(false);
      expect(read(craft, "/repo/docs/writing-craft/sentences.md")).toBe(false);
    });
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
    docs: [
      { path: "docs/broken.md", name: "the broken doc", marker: "broken-read" },
    ],
    rules: [],
    tools: ["Edit"],
    covers: () => {
      throw new Error("bad row");
    },
  };
  const markdownRow: ReadFirstRow = {
    docs: [{ path: "docs/notes.md", name: "the notes", marker: "notes-read" }],
    rules: ["Keep it short."],
    tools: ["Edit"],
    covers: ({ target }) => target?.endsWith(".md") ?? false,
  };

  it("fails a throwing row open while another row still refuses", () => {
    const decision = readFirstDecision(
      {
        projectDir,
        cwd: projectDir,
        toolName: "Edit",
        toolInput: { file_path: "/repo/AGENTS.md" },
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

describe("the hook's PreToolUse matcher", () => {
  it("names exactly the rows' tools", () => {
    const settings = JSON.parse(
      readFileSync(new URL("../../settings.json", import.meta.url), "utf8"),
    );
    const matched: string[] = settings.hooks.PreToolUse.filter(
      ({ hooks }: { hooks: { command: string }[] }) =>
        hooks.some(({ command }) => command.includes("readFirstGate.ts")),
    ).flatMap(({ matcher }: { matcher: string }) => matcher.split("|"));
    expect(new Set(matched)).toEqual(
      new Set(readFirstRows.flatMap((row) => row.tools)),
    );
  });
});
