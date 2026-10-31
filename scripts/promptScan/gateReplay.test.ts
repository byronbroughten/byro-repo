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
    const replay = replayOf("python3 -c 'print(1)'");
    expect(replay.outcome).toBe("refuses");
    expect(replay.words?.[0]).toBe("python3");
  });

  it("says when every part is free but a heredoc leaves the call to Claude Code", () => {
    const replay = replayOf("cat <<EOF\nhi\nEOF");
    expect(replay.outcome).toBe("unclassified");
    expect(replay.why).toMatch(/heredoc/);
  });

  it("says when the gate can't parse a call", () => {
    expect(replayOf("echo $(ls")).toEqual({
      outcome: "unclassified",
      why: "the gate can't parse it",
    });
  });
});
