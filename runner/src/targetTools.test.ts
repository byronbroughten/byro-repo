import { describe, expect, it } from "vitest";

import { toolsOf } from "./targetTools.ts";

describe("toolsOf", () => {
  it("gives an app target the Sheets reads and its live aliases, but no Sheets write", () => {
    const tools = toolsOf([{ kind: "spreadsheet", name: "app" }]);
    expect(tools).toContain("Bash(npm run app:sync*)");
    expect(tools).toContain("mcp__gworkspace__read_sheet_values");
    expect(tools).not.toContain("mcp__gworkspace__modify_sheet_values");
    expect(tools).not.toContain("mcp__gworkspace__append_table_rows");
  });

  it("gives a dev target the Sheets reads and writes", () => {
    const tools = toolsOf([{ kind: "spreadsheet", name: "dev" }]);
    expect(tools).toContain("Bash(npm run dev:push*)");
    expect(tools).toContain("mcp__gworkspace__read_sheet_values");
    expect(tools).toContain("mcp__gworkspace__modify_sheet_values");
  });

  it("names each tool once across targets", () => {
    const tools = toolsOf([
      { kind: "spreadsheet", name: "app" },
      { kind: "spreadsheet", name: "dev" },
    ]);
    expect(tools).toContain("mcp__gworkspace__modify_sheet_values");
    expect(new Set(tools).size).toBe(tools.length);
  });
});
