import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { sandboxOffWords } from "../../sandboxState.ts";
import { gateDecision } from "../tiers.ts";
import { excludedCommands } from "./excludedCommands.ts";

const entries = [
  "npm run issue:list",
  "npm run issue:list *",
  "npm run issue:start *",
  "npm run issue:promote *",
  "npm run issue:release *",
  "npm run issue:remove *",
  "npm run app*",
  "npm run dev*",
  "npm run runner*",
  "npm run session:probe *",
  "npm run check",
  "npm run check *",
  "npm test",
  "npm test *",
  "npm run ws:rm",
  "npm run ws:rm *",
  "npm run research:push",
  "npm run wrap-up *",
  "npm run google:script *",
  "npm run doc:print *",
  "npm run piece:pull *",
  "npm run logs *",
];

function decisionOf(command: string) {
  return gateDecision({
    command,
    mode: "interactive",
    dryRuns: [],
    sandbox: { isOn: false, excludedCommands: entries },
  });
}

const settingsPath = fileURLToPath(
  new URL("../../../../settings.json", import.meta.url),
);

// A command the entry matches: its `*` filled in, as `npm run app*` takes `app:probe` and `npm run wrap-up *` takes `wrap-up x`.
function commandMatching(entry: string): string {
  return entry.replace(/ \*$/, " x").replace(/\*$/, ":x");
}

describe("the project settings' `npm run` entries", () => {
  const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
    sandbox: { excludedCommands: string[] };
  };
  const npmRunEntries = settings.sandbox.excludedCommands.filter((entry) =>
    entry.startsWith("npm run "),
  );

  it("has `npm run` entries to check", () => {
    expect(npmRunEntries.length).toBeGreaterThan(0);
  });

  it.each(npmRunEntries)(
    "gives `%s` a specific reason, never the generic one",
    (entry) => {
      const refusal = excludedCommands.refusalOf(
        `cd . && ${commandMatching(entry)}`,
        [entry],
      );
      expect(refusal).toContain("in the sandbox");
      expect(refusal).not.toContain("the sandbox can't run it");
    },
  );
});

describe("an excluded command the call keeps in the box", () => {
  it.each([
    ["npm run app:probe -- x | head -50", "npm run app:probe -- x"],
    ["cd . && npm test", "npm test"],
    ["npm run -s app:probe -- x", "npm run app:probe -- x"],
    ["echo $(npm run dev:configs:diff)", "npm run dev:configs:diff"],
    ["timeout 60 npm test", "npm test"],
    ["timeout -k 5 60 npm run app:probe -- x", "npm run app:probe -- x"],
    ["for i in 1; do npm test; done", "npm test"],
    ["{ npm test; }", "npm test"],
  ])("refuses `%s`, naming `%s`", (command, form) => {
    const decision = decisionOf(command);
    expect(decision?.permissionDecision).toBe("deny");
    expect(decision?.reason).toContain(`Run \`${form}\` in a call of its own`);
  });

  it.each([
    ["npm run app:probe -- x | head -50", "can't reach Google"],
    ["npm --prefix packages/framework run dev:probe", "can't reach Google"],
    ["cd . && npm run runner -- status", "can't launch `claude`"],
    ["cd . && npm run issue:list", "can't run `ps`"],
    ["cd . && npm run issue:start -- byro-repo 5", "can't run `ps`"],
    ["cd . && npm run issue:promote -- byro-repo 5 utils", "can't run `ps`"],
    ["cd . && npm run issue:release -- byro-repo 5", "can't run `ps`"],
    ["cd . && npm run issue:remove -- byro-repo 5", "can't run `ps`"],
    ["cd . && npm run wrap-up -- byro-repo 5", "can't run `ps`"],
    [
      "cd . && npm run ws:rm -- .claude/hooks/old.ts",
      "can't delete a worktree's protected `.claude` files",
    ],
    [
      "npm run google:script -- probe.ts | head",
      "can't read the gworkspace server's credentials or reach Google",
    ],
    [
      "npm run doc:print -- 1AbCdEf | head",
      "can't read the gworkspace server's credentials or reach Google",
    ],
    [
      "npm run piece:pull -- personal 42 | head",
      "can't read the gworkspace server's credentials or reach Google",
    ],
    [
      "npm run logs -- sync --sheet 1AbCdEf | head",
      "can't read the gworkspace server's credentials or reach Google",
    ],
  ])("refuses `%s` because the sandbox %s", (command, reason) => {
    const decision = decisionOf(command);
    expect(decision?.permissionDecision).toBe("deny");
    expect(decision?.reason).toContain(`the sandbox ${reason}`);
  });

  it.each([
    "env X=1 npm test",
    "npm run check > out.txt",
    "npm test <<'EOF'\nx\nEOF",
    "npm t",
    "npx vitest run runner/src/Checks.test.ts",
  ])(
    "refuses `%s` because `ps` can't see the test's own process",
    (command) => {
      const decision = decisionOf(command);
      expect(decision?.permissionDecision).toBe("deny");
      expect(decision?.reason).toContain(
        "`ps` can't see the test's own process, so lease and process-liveness tests fail",
      );
    },
  );

  it("refuses a boxed research push because the box would free its push", () => {
    const decision = decisionOf("cd . && npm run research:push");
    expect(decision?.permissionDecision).toBe("deny");
    expect(decision?.reason).toContain(
      "keeps `npm run research:push` in the sandbox, where the tier gate can't see its push",
    );
  });

  it("names the command in the refusal", () => {
    expect(decisionOf("cd . && npm test")?.reason).toContain(
      "`cd . && npm test` keeps `npm test` in the sandbox",
    );
  });

  // #594's probe: Claude Code keeps a call holding `$(` or a backtick in the box, quoted or escaped.
  it.each([
    'npm run wrap-up -- byro-repo 5 --closing "a \\$(cd x) b"',
    "npm run wrap-up -- byro-repo 5 --closing 'a $(cd x) b'",
    'npm run wrap-up -- byro-repo 5 --closing "a \\`x\\` b"',
  ])("refuses `%s`, naming --closing-file", (command) => {
    const decision = decisionOf(command);
    expect(decision?.permissionDecision).toBe("deny");
    expect(decision?.reason).toContain("`--closing-file <path>`");
  });

  it("names no --closing-file for a call holding no substitution", () => {
    expect(
      decisionOf('cd . && npm run wrap-up -- byro-repo 5 --closing "x"')
        ?.reason,
    ).not.toContain("--closing-file");
  });
});

describe("a vitest test run, read as `npm test`", () => {
  const file = "runner/src/Checks.test.ts";

  it.each([
    `npx vitest run ${file}`,
    `npx vitest ${file}`,
    `npm exec vitest run ${file}`,
    `npx --yes vitest run ${file}`,
    `npx --package vitest vitest run ${file}`,
    `npx -p vitest@3 vitest run ${file}`,
    `node_modules/.bin/vitest run ${file}`,
    `vitest run ${file}`,
    `timeout 60 npx vitest run ${file}`,
    `cd . && npx vitest run ${file}`,
  ])("refuses `%s`, naming `npm test -- <file>`", (command) => {
    const decision = decisionOf(command);
    expect(decision?.permissionDecision).toBe("deny");
    expect(decision?.reason).toContain(
      `Run \`npm test -- ${file}\` in a call of its own`,
    );
  });

  it.each([
    [`npx vitest run -u ${file}`, `npm test -- -u ${file}`],
    [`npx vitest run --project runner -u`, `npm test -- --project runner -u`],
    ["npx vitest run", "npm test"],
    ["npx vitest", "npm test"],
  ])("refuses `%s`, naming `%s`", (command, form) => {
    expect(decisionOf(command)?.reason).toContain(
      `Run \`${form}\` in a call of its own`,
    );
  });

  it.each(["npx vitest bench", "npx vitest list", "npx vitest related x.ts"])(
    "keeps today's verdict on `%s`",
    (command) => {
      expect(decisionOf(command)).toEqual(
        gateDecision({ command, mode: "interactive", dryRuns: [] }),
      );
    },
  );

  // The off ask's reading of a call made only of entries keeps vitest unread, so it asks as any other call does.
  it("asks for a vitest call with the sandbox off, refusing nothing", () => {
    const command = `npx vitest run ${file}`;
    const off = { cause: "x", fix: "y", excludedCommands: entries };
    const decision = gateDecision({
      command,
      mode: "interactive",
      dryRuns: [],
      sandbox: { isOn: false, excludedCommands: [], off },
    });
    expect(decision?.permissionDecision).toBe("ask");
    expect(decision?.reason).toContain(
      `\`${command}\` isn't ${sandboxOffWords.madeOfEntries}`,
    );
  });
});

describe("a call the box lets out, or holding no excluded command", () => {
  it.each([
    "npm run app:probe -- x",
    "npm test && npm run check",
    "npm run tsc | head",
    "npm test -- runner/src/Checks.test.ts 2>&1",
    "npm test -- runner/src/Checks.test.ts",
    "npm run issue:read -- byro-repo 535 --body --hide-others",
    "npm run map:next -- byro-repo 804 | head",
    "npm run doc:sections -- docs/prose-style.md 'File shapes' | head",
    "cd . && npm run issue:read -- byro-repo 535 --body --hide-others",
    "npm run issue:read -- byro-repo 535 --comments --hide-others | head -50",
    "npm run lint",
  ])("keeps today's verdict on `%s`", (command) => {
    expect(decisionOf(command)).toEqual(
      gateDecision({ command, mode: "interactive", dryRuns: [] }),
    );
  });

  // #594's probe saw a quoted `<<` leave the box: Claude Code reads it as text.
  it.each(['npm run check -- "a<<b"', "npm run check -- 'a<<b'"])(
    "lets `%s` out, as its `<<` is quoted",
    (command) => {
      const decision = decisionOf(command);
      expect(decision).toEqual(
        gateDecision({ command, mode: "interactive", dryRuns: [] }),
      );
      expect(decision?.permissionDecision).toBe("allow");
    },
  );

  it("matches an entry with a space before its `*` only past that space", () => {
    expect(
      decisionOf("npm run session:probe:x | head")?.permissionDecision,
    ).not.toBe("deny");
  });
});
