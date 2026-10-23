import { describe, expect, it } from "vitest";

import { isFullDocRead, isPostToolUse } from "./fullDocRead.ts";
import { frameworkStylePath } from "./styleGate.ts";

const projectDir = "/repo";

describe("isPostToolUse", () => {
  it("accepts Claude's spelling and Cursor's", () => {
    expect(isPostToolUse("PostToolUse")).toBe(true);
    expect(isPostToolUse("postToolUse")).toBe(true);
    expect(isPostToolUse("preToolUse")).toBe(false);
  });
});

describe("isFullDocRead", () => {
  it("counts a full Read of the framework style doc and rejects a short one", () => {
    const where = {
      projectDir,
      cwd: projectDir,
      filePath: "/repo/packages/framework/docs/code-style.md",
    };
    expect(
      isFullDocRead({ ...where, totalLines: 80 }, frameworkStylePath),
    ).toBe(true);
    expect(
      isFullDocRead({ ...where, limit: 5, totalLines: 80 }, frameworkStylePath),
    ).toBe(false);
  });
});
