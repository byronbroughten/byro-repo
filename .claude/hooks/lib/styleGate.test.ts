import { describe, expect, it } from "vitest";

import {
  cursorEditDecision,
  cursorFilePath,
  cursorReadBounds,
  type EditDecision,
  editDecision,
  frameworkStylePath,
  isFullDocRead,
  isPostToolUse,
  isStyleRead,
  styleGateReason,
} from "./styleGate.ts";

const projectDir = "/repo";
const generatedDirs = ["packages/real-estate/src/generated", "packages/framework/dev/generated"];
function edit(filePath: string, hasReadStyle: boolean, cwd = projectDir): EditDecision {
  return editDecision({ projectDir, cwd, filePath, hasReadStyle, generatedDirs });
}
const frameworkFile = "/repo/packages/framework/src/02_SpreadsheetRaw/SheetRaw.ts";

describe("editDecision", () => {
  it("denies a TypeScript edit in either package's src/ before config/docs/code-style.md was read", () => {
    expect(edit(frameworkFile, false)).toEqual({ denyReason: styleGateReason });
    expect(edit("/repo/packages/real-estate/src/index.ts", false)).toEqual({ denyReason: styleGateReason });
  });

  it("denies a TypeScript edit in the framework's dev/, which ESLint lints too", () => {
    expect(edit("/repo/packages/framework/dev/devConfigs.ts", false)).toEqual({ denyReason: styleGateReason });
  });

  it("denies a relative path resolved from the working directory", () => {
    expect(edit("SheetRaw.ts", false, "/repo/packages/framework/src/02_SpreadsheetRaw")).toEqual({
      denyReason: styleGateReason,
    });
  });

  it("allows a gated TypeScript edit after config/docs/code-style.md was read", () => {
    expect(edit(frameworkFile, true)).toEqual({ denyReason: undefined });
  });

  it("denies an edit to tooling, which ESLint lints too", () => {
    expect(edit("/repo/.claude/hooks/lib/bashReads.ts", false)).toEqual({ denyReason: styleGateReason });
    expect(edit("/repo/scripts/docLint.ts", false)).toEqual({ denyReason: styleGateReason });
    expect(edit("/repo/packages/framework/scripts/rollupPreset.js", false)).toEqual({ denyReason: styleGateReason });
    expect(edit("/repo/eslint.config.mjs", false)).toEqual({ denyReason: styleGateReason });
  });

  it("allows edits outside the ESLint set", () => {
    expect(edit("/repo/packages/framework/dist/bundle.js", false)).toEqual({ denyReason: undefined });
    expect(edit("/repo/coverage/prettify.js", false)).toEqual({ denyReason: undefined });
    expect(edit("/repo/node_modules/x/index.js", false)).toEqual({ denyReason: undefined });
    expect(edit("/repo/.claude/worktrees/agent-1/scripts/docLint.ts", false)).toEqual({ denyReason: undefined });
    expect(edit("/elsewhere/packages/framework/src/x.ts", false)).toEqual({ denyReason: undefined });
  });

  it("allows non-code edits", () => {
    expect(edit("/repo/packages/framework/src/AGENTS.md", false)).toEqual({ denyReason: undefined });
    expect(edit("/repo/packages/framework/sheets.config.json", false)).toEqual({ denyReason: undefined });
  });

  it("leaves every package's generated files to the generated-data warning", () => {
    expect(edit("/repo/packages/real-estate/src/generated/sheetConfigs.ts", false)).toEqual({ denyReason: undefined });
    expect(edit("/repo/packages/framework/dev/generated/sheetConfigs.ts", false)).toEqual({ denyReason: undefined });
  });

  it("does not say it only covers packages/", () => {
    expect(styleGateReason).not.toMatch(/under packages/);
  });

  it("names what to read and to retry", () => {
    expect(styleGateReason).toMatch(/docs\/code-style\.md/);
    expect(styleGateReason).toMatch(/retry/);
  });
});

describe("isStyleRead", () => {
  function read(
    filePath: string,
    bounds: { offset?: number; limit?: number; totalLines?: number } = {},
    cwd = projectDir,
  ): boolean {
    return isStyleRead({ projectDir, cwd, filePath, totalLines: 40, ...bounds });
  }

  it("is true for an unbounded Read of config/docs/code-style.md", () => {
    expect(read("/repo/config/docs/code-style.md")).toBe(true);
    expect(read("../config/docs/code-style.md", {}, "/repo/src")).toBe(true);
  });

  it("is false for a Read whose limit stops short of the end", () => {
    expect(read("/repo/config/docs/code-style.md", { limit: 5 })).toBe(false);
    expect(read("/repo/config/docs/code-style.md", { offset: 1, limit: 39 })).toBe(false);
  });

  it("is false for a Read that starts past the top", () => {
    expect(read("/repo/config/docs/code-style.md", { offset: 2 })).toBe(false);
    expect(read("/repo/config/docs/code-style.md", { offset: 10, limit: 100 })).toBe(false);
  });

  it("is true for a bounded Read that covers the whole file", () => {
    expect(read("/repo/config/docs/code-style.md", { limit: 40 })).toBe(true);
    expect(read("/repo/config/docs/code-style.md", { offset: 1, limit: 2000 })).toBe(true);
  });

  it("is false for a bounded Read when the file's length is unknown", () => {
    expect(read("/repo/config/docs/code-style.md", { limit: 2000, totalLines: undefined })).toBe(false);
  });

  it("is false for any other file", () => {
    expect(read("/repo/config/docs/code-style/naming.md")).toBe(false);
    expect(read("/other/config/docs/code-style.md")).toBe(false);
  });

  it("is false for a full Read of the framework's rules or the old root path", () => {
    expect(read("/repo/packages/framework/docs/code-style.md")).toBe(false);
    expect(read("/repo/docs/code-style.md")).toBe(false);
  });

  it("is false for a full Read of a stale root STYLE.md", () => {
    expect(read("/repo/STYLE.md")).toBe(false);
  });
});

describe("the refusal reason", () => {
  it("says a partial Read doesn't count", () => {
    expect(styleGateReason).toMatch(/full Read/);
    expect(styleGateReason).toMatch(/partial/);
  });
});

describe("isPostToolUse", () => {
  it("accepts Claude's spelling and Cursor's", () => {
    expect(isPostToolUse("PostToolUse")).toBe(true);
    expect(isPostToolUse("postToolUse")).toBe(true);
    expect(isPostToolUse("preToolUse")).toBe(false);
  });
});

describe("cursorEditDecision", () => {
  const unread = { hasReadGeneral: false, hasReadFramework: false };

  function decide(filePath: string, reads = unread): EditDecision {
    return cursorEditDecision({ projectDir, cwd: projectDir, filePath, generatedDirs, reads });
  }

  it("denies a framework TypeScript edit until both style docs were read in full", () => {
    const denied = decide(frameworkFile);
    expect(denied.denyReason).toMatch(/config\/docs\/code-style\.md/);
    expect(denied.denyReason).toMatch(/packages\/framework\/docs\/code-style\.md/);
    expect(denied.denyReason).toMatch(/retry/);
    expect(decide(frameworkFile, { hasReadGeneral: true, hasReadFramework: false }).denyReason).toMatch(
      /packages\/framework\/docs\/code-style\.md/,
    );
    expect(decide(frameworkFile, { hasReadGeneral: true, hasReadFramework: false }).denyReason).not.toMatch(
      /config\/docs\/code-style\.md/,
    );
  });

  it("denies app code the same way, and root tooling only until the general doc was read", () => {
    expect(decide("/repo/packages/real-estate/src/index.ts").denyReason).toMatch(/packages\/framework\/docs\/code-style\.md/);
    expect(decide("/repo/scripts/docLint.ts").denyReason).toMatch(/config\/docs\/code-style\.md/);
    expect(decide("/repo/scripts/docLint.ts").denyReason).not.toMatch(/packages\/framework\/docs\/code-style\.md/);
    expect(decide("/repo/scripts/docLint.ts", { hasReadGeneral: true, hasReadFramework: false })).toEqual({
      denyReason: undefined,
    });
  });

  it("allows a framework edit after both docs were read, and still skips generated files", () => {
    expect(decide(frameworkFile, { hasReadGeneral: true, hasReadFramework: true })).toEqual({ denyReason: undefined });
    expect(decide("/repo/packages/framework/dev/generated/sheetConfigs.ts")).toEqual({ denyReason: undefined });
  });
});

describe("isFullDocRead", () => {
  it("counts a full Read of the framework style doc and rejects a short one", () => {
    const where = { projectDir, cwd: projectDir, filePath: "/repo/packages/framework/docs/code-style.md" };
    expect(isFullDocRead({ ...where, totalLines: 80 }, frameworkStylePath)).toBe(true);
    expect(isFullDocRead({ ...where, limit: 5, totalLines: 80 }, frameworkStylePath)).toBe(false);
  });
});

describe("cursor tool input", () => {
  it("reads Cursor's path field, and Claude's file_path", () => {
    expect(cursorFilePath({ path: "/repo/src/a.ts" })).toBe("/repo/src/a.ts");
    expect(cursorFilePath({ file_path: "/repo/src/b.ts" })).toBe("/repo/src/b.ts");
    expect(cursorFilePath(undefined)).toBeUndefined();
  });

  it("reads offset and limit only when they are whole numbers", () => {
    expect(cursorReadBounds({ offset: 1, limit: 40 })).toEqual({ offset: 1, limit: 40 });
    expect(cursorReadBounds({ offset: "1" })).toBeUndefined();
    expect(cursorReadBounds(undefined)).toEqual({});
  });
});
