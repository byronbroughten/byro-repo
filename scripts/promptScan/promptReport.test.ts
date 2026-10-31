import { describe, expect, it } from "vitest";

import type { GateReplay } from "./gateReplay.ts";
import {
  answererOf,
  promptReportOf,
  type ScannedCall,
} from "./promptReport.ts";
import type { PermissionAnswer } from "./transcriptCalls.ts";

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
