import { describe, expect, it } from "vitest";

import { excludedCommands } from "./excludedCommands.ts";
import { gateDecision } from "./tiers.ts";

const entries = [
  "npm run issue*",
  "npm run app*",
  "npm run dev*",
  "npm run runner*",
  "npm run session:probe *",
  "npm run check",
  "npm run check *",
  "npm test",
  "npm test *",
];

function decisionOf(command: string) {
  return gateDecision({
    command,
    mode: "interactive",
    dryRuns: [],
    excludedCommands: entries,
  });
}

describe("an excluded command the call keeps in the box", () => {
  it.each([
    ["npm run app:probe -- x | head -50", "npm run app:probe -- x"],
    ["cd . && npm test", "npm test"],
    ["npm run -s app:probe -- x", "npm run app:probe -- x"],
    ["echo $(npm run dev:configs:diff)", "npm run dev:configs:diff"],
    ["timeout 60 npm test", "npm test"],
    ["timeout -k 5 60 npm run app:probe -- x", "npm run app:probe -- x"],
  ])("refuses `%s`, naming `%s`", (command, form) => {
    const decision = decisionOf(command);
    expect(decision?.permissionDecision).toBe("deny");
    expect(decision?.reason).toContain(`Run \`${form}\` in a call of its own`);
  });

  it.each([
    ["npm run app:probe -- x | head -50", "can't reach Google"],
    ["npm --prefix packages/framework run dev:probe", "can't reach Google"],
    ["cd . && npm run runner -- status", "can't launch `claude`"],
    ["env X=1 npm test", "can't run `ps`"],
    ["npm run check > out.txt", "can't run `ps`"],
    ["npm test <<'EOF'\nx\nEOF", "can't run `ps`"],
    ["npm t", "can't run `ps`"],
  ])("refuses `%s` because the sandbox %s", (command, reason) => {
    const decision = decisionOf(command);
    expect(decision?.permissionDecision).toBe("deny");
    expect(decision?.reason).toContain(`the sandbox ${reason}`);
  });

  it("names the command in the refusal", () => {
    expect(decisionOf("cd . && npm test")?.reason).toContain(
      "`cd . && npm test` keeps `npm test` in the sandbox",
    );
  });
});

describe("a call the box lets out, or holding no excluded command", () => {
  it.each([
    "npm run app:probe -- x",
    "npm test && npm run check",
    "npm run tsc | head",
    "npm test -- runner/src/Checks.test.ts 2>&1",
    "npm run issue:read -- byro-repo 535 --body --hide-others",
    "npm run lint",
  ])("keeps today's verdict on `%s`", (command) => {
    expect(decisionOf(command)).toEqual(
      gateDecision({ command, mode: "interactive", dryRuns: [] }),
    );
  });

  it("matches an entry with a space before its `*` only past that space", () => {
    expect(
      decisionOf("npm run session:probe:x | head")?.permissionDecision,
    ).not.toBe("deny");
  });
});

describe("excludedCommands.entriesOf", () => {
  it("reads the sandbox block's excluded commands", () => {
    expect(
      excludedCommands.entriesOf({
        sandbox: { enabled: true, excludedCommands: ["npm test", 3] },
      }),
    ).toEqual(["npm test"]);
  });

  it.each([
    ["a disabled sandbox", { sandbox: { excludedCommands: ["npm test"] } }],
    ["unreadable settings", undefined],
  ])("reads none from %s", (_case, settings) => {
    expect(excludedCommands.entriesOf(settings)).toEqual([]);
  });
});
