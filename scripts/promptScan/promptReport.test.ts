import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { type GateReplay, scannedCallsOf } from "./gateReplay.ts";
import {
  answererOf,
  promptReportOf,
  type ScannedCall,
} from "./promptReport.ts";
import type { PermissionAnswer, Stop } from "./transcriptCalls.ts";

const developerYes: PermissionAnswer = {
  source: "user_temporary",
  decision: "accept",
  reasonCode: "hook:PreToolUse",
};
const classifierYes: PermissionAnswer = {
  source: "config",
  decision: "accept",
  reasonType: "classifier",
};
const hookYes: PermissionAnswer = {
  source: "hook",
  decision: "accept",
  reasonType: "hook",
};
const unclassified: GateReplay = {
  outcome: "unclassified",
  words: ["npm", "run", "-s", "runner", "--", "status", "owner/repo", "480"],
  why: "no tier row matches it",
};

function bashCall(
  command: string,
  permission: PermissionAnswer,
  replay: GateReplay,
): ScannedCall {
  return { call: { tool: "Bash", command, permission }, replay };
}

function reportOf(calls: ScannedCall[], top = 20): string {
  return promptReportOf({ calls, sessionCount: 3, top });
}

describe("answererOf", () => {
  it("names the developer and auto mode's classifier, and no one else", () => {
    expect(answererOf(developerYes)).toBe("developer");
    expect(answererOf(classifierYes)).toBe("classifier");
    expect(answererOf(hookYes)).toBeUndefined();
  });
});

describe("promptReportOf", () => {
  it("groups calls by the command that decided them, paths and numbers set aside", () => {
    const report = reportOf([
      bashCall(
        "npm run -s runner -- status owner/repo 480",
        classifierYes,
        unclassified,
      ),
      bashCall("npm run runner -- status owner/repo 481", classifierYes, {
        ...unclassified,
        words: ["npm", "run", "runner", "--", "status", "owner/repo", "481"],
      }),
    ]);
    expect(report).toContain(
      "| 2 | npm run runner status | unclassified: no tier row matches it | npm run -s runner -- status owner/repo 480 |",
    );
    expect(report).toContain("## Auto mode's classifier answered 2 calls");
    expect(report).toContain("## The developer answered 0 calls\n\nNone.");
  });

  it("says who asked the developer, and escapes a pipe in a cell", () => {
    const report = reportOf([
      bashCall("ls | git push", developerYes, {
        outcome: "asks",
        words: ["git", "push"],
        why: "a push can't be undone",
      }),
    ]);
    expect(report).toContain(
      "| 1 | git push | a hook | asks: a push can't be undone | ls \\| git push |",
    );
  });

  it("keys another tool by its name and shows what it acted on", () => {
    const report = reportOf([
      {
        call: { tool: "Write", target: "/tmp/a.md", permission: classifierYes },
      },
    ]);
    expect(report).toContain("| 1 | Write | not a Bash call | /tmp/a.md |");
  });

  it("leaves out calls a hook, a rule or auto mode itself let through", () => {
    const report = reportOf([
      bashCall("gh issue view 3", hookYes, unclassified),
    ]);
    expect(report).not.toContain("gh issue view");
  });

  it("lists the top rows by count and says how many more there are", () => {
    const report = reportOf(
      [
        bashCall("a", classifierYes, { ...unclassified, words: ["alpha"] }),
        bashCall("a", classifierYes, { ...unclassified, words: ["alpha"] }),
        bashCall("b", classifierYes, { ...unclassified, words: ["beta"] }),
      ],
      1,
    );
    expect(report).toContain("| 2 | alpha |");
    expect(report).not.toContain("| beta |");
    expect(report).toContain("1 more commands.");
  });
});

describe("promptReportOf, on the stops no one answered", () => {
  const hookNo: PermissionAnswer = {
    source: "hook",
    decision: "reject",
    reasonType: "hook",
    reasonCode: "hook:PreToolUse",
  };
  const refuses: GateReplay = {
    outcome: "refuses",
    words: ["npm", "run", "wrap-up", "--", "byro-repo", "554"],
    why: "keeps it in the sandbox",
  };

  function stopped(
    command: string,
    stop: Stop,
    replay: GateReplay,
    permission: PermissionAnswer = hookYes,
  ): ScannedCall {
    return { call: { tool: "Bash", command, permission, stop }, replay };
  }

  it("ranks refusals by command, with the refusal's why beside what the gate does now", () => {
    const refusal: Stop = { kind: "refusal", why: "Tier gate: keeps it" };
    const report = reportOf([
      stopped("npm run wrap-up -- byro-repo 1", refusal, refuses, hookNo),
      stopped("npm run wrap-up -- byro-repo 2", refusal, refuses, hookNo),
      stopped(
        "rm -r a",
        { kind: "refusal", why: "Branch guard: no" },
        {
          outcome: "asks",
          words: ["rm", "-r", "a"],
          why: "a delete",
        },
        hookNo,
      ),
    ]);
    expect(report).toContain("## A hook refused 3 calls");
    expect(report).toMatch(
      /\| 2 \| npm run wrap-up byro-repo \| Tier gate: keeps it \| refuses: keeps it in the sandbox \| npm run wrap-up -- byro-repo 1 \|\n\| 1 \| rm a \|/,
    );
    expect(report).not.toContain("## The developer answered 1");
  });

  it("groups sandbox denials by command and what was denied, a workspace's name set aside", () => {
    const free: GateReplay = {
      outcome: "free",
      words: ["git", "-C", "packages/framework", "add", "-A"],
      why: "a git add",
    };
    const lockOf = (workspace: string): Stop => ({
      kind: "sandboxDenial",
      denied: `/Users/someone/Code/repo/packages/framework/.git/worktrees/${workspace}/index.lock`,
    });
    const report = reportOf([
      stopped("git -C packages/framework add -A", lockOf("framework1"), free),
      stopped("git -C packages/framework add -A", lockOf("framework4"), free),
      stopped(
        "gh issue view 3",
        { kind: "sandboxDenial", denied: "cafe.github.com" },
        { outcome: "free", words: ["gh", "issue", "view", "3"], why: "a read" },
      ),
    ]);
    expect(report).toContain("## The sandbox denied 3 calls");
    expect(report).toContain(
      "| 2 | git add | ~/Code/repo/packages/framework/.git/worktrees/<name>/index.lock | free: a git add | git -C packages/framework add -A |",
    );
    expect(report).toContain("| 1 | gh issue view | cafe.github.com |");
  });

  it("counts Hand-backs and Claude Code's removal check, each Bash row with the gate's word now", () => {
    const report = reportOf([
      {
        call: {
          tool: "Bash",
          command: "rm ~/.workspace-mcp/attachments/a.pdf",
          stop: { kind: "handBack" },
        },
        replay: {
          outcome: "asks",
          words: ["rm", "~/.workspace-mcp/attachments/a.pdf"],
          why: "a delete outside the workspace",
        },
      },
      stopped(
        "rm -rf $DIR",
        { kind: "removalCheck" },
        { outcome: "asks", words: ["rm", "-rf", "$DIR"], why: "a delete" },
        {
          source: "config",
          decision: "reject",
          reasonType: "safetyCheck",
        },
      ),
    ]);
    expect(report).toContain(
      "## Hand-backs: 1 call\n\nEach is a command an agent asked the developer to run.\n\n| Calls | Command | The gate now | Example |",
    );
    expect(report).toContain(
      "| 1 | rm <path> | asks: a delete outside the workspace | rm ~/.workspace-mcp/attachments/a.pdf |",
    );
    expect(report).toContain("## Claude Code's removal check stopped 1 call");
    expect(report).toContain("| 1 | rm $DIR | asks: a delete | rm -rf $DIR |");
  });
});

describe("promptReportOf, fixture transcripts in, rows out", () => {
  const fixtures = join(import.meta.dirname, "fixtures");
  const calls = readdirSync(fixtures).flatMap((file) =>
    scannedCallsOf(readFileSync(join(fixtures, file), "utf8"), {
      isOn: true,
      excludedCommands: [],
    }),
  );
  const report = reportOf(calls);

  it("puts each real transcript's stop in its own table", () => {
    expect(report).toContain("## A hook refused 1 call");
    expect(report).toContain(
      "| 1 | touch <path> | .claude/hooks/.probe-r538 | free:",
    );
    expect(report).toContain("| 1 | (unparsed) | cafe.github.com |");
    expect(report).toMatch(/## Hand-backs: 1 call[^#]*\| 1 \| rm <path> \|/);
    expect(report).toContain("## Claude Code's removal check stopped 1 call");
  });

  it("rows the #588 misreads by their command, each with what the gate does with it now", () => {
    expect(report).toContain(
      "| 1 | npm run wrap-up byro-repo | Tier gate: `npm run wrap-up -- byro-repo 554 --closing",
    );
    expect(report).toContain(
      "| free: `npm run wrap-up` is the standing yes to push |",
    );
    expect(report).toMatch(
      /## The developer answered 1 call[^#]*\| 1 \| gh issue create \| a hook \| free: `gh issue close` undoes it \| cd "\$TMPDIR\/ct529"/,
    );
  });
});
