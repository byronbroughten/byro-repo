import { describe, expect, it } from "vitest";

import { startedSessionOf } from "./startedSession.ts";

const issue = { repo: "byro-repo", number: 353 };
const started = {
  key: issue,
  env: { CLAUDE_CODE_SESSION_ID: "session-1" },
  account: 1,
  homeFolder: "/Users/dev",
};

describe("startedSessionOf", () => {
  it("records the Claude Code session that leased an issue workspace as its implement session", () => {
    expect(startedSessionOf(started)).toEqual({
      issue,
      session: {
        account: 1,
        configFolder: "/Users/dev/.claude",
        step: { agent: "implement", sessionId: "session-1" },
      },
    });
  });

  it("takes the config folder from CLAUDE_CONFIG_DIR when it is set", () => {
    expect(
      startedSessionOf({
        ...started,
        env: { ...started.env, CLAUDE_CONFIG_DIR: "/Users/dev/.claude-2" },
      })?.session.configFolder,
    ).toBe("/Users/dev/.claude-2");
  });

  it("records nothing without a Claude Code session, or for a runner step", () => {
    expect(startedSessionOf({ ...started, env: {} })).toBeUndefined();
    expect(
      startedSessionOf({
        ...started,
        env: { ...started.env, BYRO_RUNNER_STEP: "1" },
      }),
    ).toBeUndefined();
  });

  it("records nothing for a session workspace", () => {
    expect(
      startedSessionOf({ ...started, key: { session: "glossary-term" } }),
    ).toBeUndefined();
  });

  it("records nothing when cswap gives no active account", () => {
    expect(
      startedSessionOf({ ...started, account: undefined }),
    ).toBeUndefined();
  });
});
