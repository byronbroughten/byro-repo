import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  bashDecision,
  type Decision,
  devWriteOf,
  guardedSheetsWrites,
  pinnedDevSpreadsheetId,
  pinsOff,
  type SheetsWrite,
  sheetsWriteDecision,
} from "./pinnedTargets.ts";

describe("devWriteOf", () => {
  it("names a dev gen:configs, build, push or run", () => {
    expect(devWriteOf("npm run dev:gen:configs")).toBe("dev:gen:configs");
    expect(devWriteOf("npm run dev:build")).toBe("dev:build");
    expect(devWriteOf("npm run dev:push")).toBe("dev:push");
    expect(devWriteOf("npm run dev:run triggerOnEdit")).toBe("dev:run");
  });

  it("names a dev chore only when it sends", () => {
    expect(devWriteOf("npm run dev:chore buildFixtures -- --send")).toBe("dev:chore");
    expect(devWriteOf("npm run dev:chore buildFixtures")).toBeUndefined();
    expect(devWriteOf("npm run dev:chore buildFixtures -- --json")).toBeUndefined();
  });

  it("ignores dev reads and app commands", () => {
    expect(devWriteOf("npm run dev:probe -- --fields sheets")).toBeUndefined();
    expect(devWriteOf("npm run -s dev:probe -- --fields sheets")).toBeUndefined();
    expect(devWriteOf("npm run dev:configs:diff")).toBeUndefined();
    expect(devWriteOf("npm run app:gen:configs")).toBeUndefined();
    expect(devWriteOf("npm test")).toBeUndefined();
  });

  it("finds the write in any part of a compound command", () => {
    expect(devWriteOf("npm run tsc && npm run dev:gen:configs")).toBe("dev:gen:configs");
    expect(devWriteOf("cd /repo; npm run -s dev:build | tail")).toBe("dev:build");
  });

  it("treats an unparseable command that names a dev script as a write", () => {
    expect(devWriteOf("npm run dev:probe 'unbalanced")).toBe("dev:*");
    expect(devWriteOf("echo 'unbalanced")).toBeUndefined();
  });
});

describe("bashDecision", () => {
  const command = "npm run dev:gen:configs";

  it("leaves a dev write alone while every pinning file is clean", () => {
    expect(bashDecision({ command, dirtyPinningFiles: [] })).toBeUndefined();
  });

  it("asks for a dev write while a pinning file has uncommitted changes, naming it", () => {
    const decision = bashDecision({ command, dirtyPinningFiles: ["packages/framework/sheets.config.json"] });
    expect(decision?.permissionDecision).toBe("ask");
    expect(decision?.reason).toMatch(/dev:gen:configs/);
    expect(decision?.reason).toMatch(/packages\/framework\/sheets\.config\.json/);
  });

  it("asks when the pinning files' state is unknown", () => {
    expect(pinsOff(undefined, pinnedDevSpreadsheetId)).toBeUndefined();
    expect(bashDecision({ command, dirtyPinningFiles: undefined })?.permissionDecision).toBe("ask");
  });

  it("leaves anything but a dev write alone, however dirty", () => {
    const dirty = ["packages/framework/sheets.config.json"];
    expect(bashDecision({ command: "npm run dev:probe", dirtyPinningFiles: dirty })).toBeUndefined();
    expect(bashDecision({ command: "npm run app:build", dirtyPinningFiles: dirty })).toBeUndefined();
  });
});

describe("pinsOff", () => {
  it("is empty for clean files and the pinned dev ID in config", () => {
    expect(pinsOff([], pinnedDevSpreadsheetId)).toEqual([]);
  });

  it("names a dirty file and a config pointing anywhere but the pinned dev ID", () => {
    const reasons = pinsOff([".claude/hooks/pinnedTargetGuard.ts"], "app-id");
    expect(reasons).toEqual([
      ".claude/hooks/pinnedTargetGuard.ts has uncommitted changes",
      "packages/framework/sheets.config.json does not name the pinned dev spreadsheet",
    ]);
    expect(pinsOff([], undefined)).toHaveLength(1);
  });
});

describe("sheetsWriteDecision", () => {
  const devSpreadsheetId = "dev-id";
  function decide(overrides: Partial<SheetsWrite>): Decision | undefined {
    return sheetsWriteDecision({
      toolName: "mcp__gworkspace__modify_sheet_values",
      spreadsheetId: "dev-id",
      devSpreadsheetId,
      dirtyPinningFiles: [],
      ...overrides,
    });
  }

  it("allows every guarded gworkspace Sheets write on the dev spreadsheet", () => {
    guardedSheetsWrites.forEach((toolName) => {
      expect(decide({ toolName })).toEqual({ permissionDecision: "allow", reason: expect.any(String) });
    });
  });

  it("asks for any other spreadsheet, with the exact sheet, range and values", () => {
    const decision = decide({ spreadsheetId: "app-id" });
    expect(decision?.permissionDecision).toBe("ask");
    expect(decision?.reason).toMatch(/not the pinned dev spreadsheet/);
    expect(decision?.reason).toMatch(/sheet, range and values/);
  });

  it("asks on the dev spreadsheet while a pinning file has uncommitted changes", () => {
    const decision = decide({ dirtyPinningFiles: [".claude/hooks/pinnedTargetGuard.ts"] });
    expect(decision?.permissionDecision).toBe("ask");
    expect(decision?.reason).toMatch(/pinnedTargetGuard\.ts/);
  });

  it("asks when the dev ID or the pinning files' state is unknown", () => {
    expect(decide({ devSpreadsheetId: undefined })?.permissionDecision).toBe("ask");
    expect(decide({ spreadsheetId: undefined, devSpreadsheetId: undefined })?.permissionDecision).toBe("ask");
    expect(decide({ dirtyPinningFiles: undefined })?.permissionDecision).toBe("ask");
  });

  it("has no opinion on a tool it does not guard", () => {
    expect(decide({ toolName: "mcp__gworkspace__manage_drive_access" })).toBeUndefined();
    expect(decide({ toolName: "mcp__gworkspace__create_spreadsheet" })).toBeUndefined();
    expect(decide({ toolName: "mcp__gworkspace__read_sheet_values" })).toBeUndefined();
    expect(decide({ toolName: "mcp__gworkspace__modify_doc_text" })).toBeUndefined();
    expect(decide({ toolName: "mcp__gsheets__update_cells" })).toBeUndefined();
  });
});

describe("guardedSheetsWrites", () => {
  it("covers the gworkspace value and tab writes", () => {
    expect(guardedSheetsWrites).toContain("mcp__gworkspace__modify_sheet_values");
    expect(guardedSheetsWrites).toContain("mcp__gworkspace__create_sheet");
  });

  it("is exactly what the pinned-target hook's matcher names, besides Bash", () => {
    const settings = JSON.parse(readFileSync(new URL("../../settings.json", import.meta.url), "utf8"));
    const matchers: string[] = settings.hooks.PreToolUse.filter(({ hooks }: { hooks: { command: string }[] }) =>
      hooks.some(({ command }) => command.includes("pinnedTargetGuard.ts")),
    ).map(({ matcher }: { matcher: string }) => matcher);
    expect(matchers).toHaveLength(1);
    expect(new Set(matchers[0]?.split("|"))).toEqual(new Set(["Bash", ...guardedSheetsWrites]));
  });
});
