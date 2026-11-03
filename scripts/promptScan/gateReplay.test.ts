import { describe, expect, it } from "vitest";

import { gateReplayOf } from "./gateReplay.ts";

function replayOf(command: string) {
  return gateReplayOf({ command, mode: "interactive", dryRuns: [] });
}

describe("gateReplayOf", () => {
  it("names a free call as free", () => {
    expect(replayOf("git log --oneline").outcome).toBe("free");
  });

  it("names the part of a call no tier row matches", () => {
    expect(replayOf("git status && gh issue view 3")).toEqual({
      outcome: "unclassified",
      words: ["gh", "issue", "view", "3"],
      why: "no tier row matches it",
    });
  });

  it("names the part that asks, with the gate's own reason", () => {
    const replay = replayOf("ls && git push");
    expect(replay.outcome).toBe("asks");
    expect(replay.words).toEqual(["git", "push"]);
  });

  it("names the part that's refused", () => {
    const replay = replayOf("ls && npm run app:chore fixRows -- --send");
    expect(replay.outcome).toBe("refuses");
    expect(replay.words?.[0]).toBe("npm");
  });

  it("says when every part is free but a heredoc leaves the call to Claude Code", () => {
    const replay = replayOf("cat <<EOF\nhi\nEOF");
    expect(replay.outcome).toBe("unclassified");
    expect(replay.why).toMatch(/heredoc/);
  });

  describe("a call the sandbox runs", () => {
    const command = 'node -e "console.log(1)"';

    it("replays as free under an on state", () => {
      const replay = gateReplayOf({
        command,
        mode: "interactive",
        dryRuns: [],
        sandbox: { isOn: true, excludedCommands: [] },
      });
      expect(replay.outcome).toBe("free");
    });

    it("replays as asking under an off state", () => {
      const replay = gateReplayOf({
        command,
        mode: "interactive",
        dryRuns: [],
        sandbox: {
          isOn: false,
          excludedCommands: [],
          off: {
            cause: "`sandbox.enabled` isn't true",
            fix: 'set `"enabled": true` in the `sandbox` block',
            excludedCommands: [],
          },
        },
      });
      expect(replay.outcome).toBe("asks");
    });
  });

  it("says when the gate can't parse a call", () => {
    expect(replayOf("echo $(ls")).toEqual({
      outcome: "unclassified",
      why: "the gate can't parse it",
    });
  });
});
