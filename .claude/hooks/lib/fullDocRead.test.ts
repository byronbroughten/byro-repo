import { describe, expect, it } from "vitest";

import { isFullDocBashRead, isFullDocRead } from "./fullDocRead.ts";
import { BashReads } from "./tiers/bashReads.ts";

const projectDir = "/repo";
const docPath = "docs/prose-style.md";

describe("isFullDocRead", () => {
  function read(
    filePath: string,
    bounds: { offset?: number; limit?: number; totalLines?: number } = {},
    cwd = projectDir,
  ): boolean {
    return isFullDocRead(
      { projectDir, cwd, filePath, totalLines: 40, ...bounds },
      docPath,
    );
  }

  it("is true for an unbounded Read of the doc", () => {
    expect(read("/repo/docs/prose-style.md")).toBe(true);
    expect(read("../docs/prose-style.md", {}, "/repo/src")).toBe(true);
  });

  it("is false for a Read whose limit stops short of the end", () => {
    expect(read("/repo/docs/prose-style.md", { limit: 5 })).toBe(false);
    expect(read("/repo/docs/prose-style.md", { offset: 1, limit: 39 })).toBe(
      false,
    );
  });

  it("is false for a Read that starts past the top", () => {
    expect(read("/repo/docs/prose-style.md", { offset: 2 })).toBe(false);
    expect(read("/repo/docs/prose-style.md", { offset: 10, limit: 100 })).toBe(
      false,
    );
  });

  it("is true for a bounded Read that covers the whole file", () => {
    expect(read("/repo/docs/prose-style.md", { limit: 40 })).toBe(true);
    expect(read("/repo/docs/prose-style.md", { offset: 1, limit: 2000 })).toBe(
      true,
    );
  });

  it("is false for a bounded Read when the file's length is unknown", () => {
    expect(
      read("/repo/docs/prose-style.md", { limit: 2000, totalLines: undefined }),
    ).toBe(false);
  });

  it("is false for any other file", () => {
    expect(read("/repo/docs/prose-style/smells.md")).toBe(false);
    expect(read("/other/docs/prose-style.md")).toBe(false);
    expect(read("/repo/config/docs/code-style.md")).toBe(false);
  });
});

describe("isFullDocBashRead", () => {
  function bashRead(command: string): boolean {
    const wholeFilePaths = BashReads.init({
      command,
      cwd: projectDir,
      projectDir,
    }).wholeFilePaths();
    return isFullDocBashRead(projectDir, wholeFilePaths, docPath);
  }

  it("counts a whole-file cat, beside other files", () => {
    expect(bashRead("cat docs/prose-style.md")).toBe(true);
    expect(bashRead("cat AGENTS.md docs/prose-style.md")).toBe(true);
  });

  it("doesn't count a cat a pipe trims", () => {
    expect(bashRead("cat docs/prose-style.md | head -20")).toBe(false);
  });

  it("ignores a read of any other doc", () => {
    expect(bashRead("cat docs/prose-style/smells.md")).toBe(false);
  });
});
