import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FactsFile } from "@byronbroughten/spec-runner/FactsFile";
import type { LeaseHolder } from "@byronbroughten/spec-runner/IssueWorkspaces";
import { SupervisionRecords } from "@byronbroughten/spec-runner/SupervisionRecords";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { recordStartedSession, startedSessionOf } from "./startedSession.ts";

const issue = { repo: "byro-repo", number: 353 };
const spec = { repo: "byro-repo", number: 459 };
const started = {
  key: issue,
  env: { CLAUDE_CODE_SESSION_ID: "session-1" },
  account: 1,
  homeFolder: "/Users/dev",
  isSupervisor: false,
};
const me: LeaseHolder = { kind: "session", pid: process.pid };

describe("startedSessionOf", () => {
  it("records the Claude Code session that leased an issue workspace as its implement session", () => {
    expect(startedSessionOf(started)).toEqual({
      issue,
      session: {
        agent: "implement",
        sessionId: "session-1",
        account: 1,
        configFolder: "/Users/dev/.claude",
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

  // The #453 cause: a Supervisor answering a Halt starts the ticket's workspace, and was listed as its implementer.
  it("records nothing for a Supervisor, whose session worked other tickets too", () => {
    expect(
      startedSessionOf({ ...started, isSupervisor: true }),
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

describe("recordStartedSession", () => {
  let stateFolder = "";

  beforeEach(() => {
    stateFolder = mkdtempSync(join(tmpdir(), "started-session-"));
  });

  afterEach(() => {
    rmSync(stateFolder, { recursive: true, force: true });
  });

  async function record(): Promise<void> {
    const { key, env, account, homeFolder } = started;
    await recordStartedSession({
      key,
      env,
      account,
      homeFolder,
      holder: me,
      stateFolder,
    });
  }

  function supervisionRecords(): SupervisionRecords {
    return SupervisionRecords.init(stateFolder);
  }

  async function supervise(): Promise<void> {
    await supervisionRecords().supervise(me, "byronbroughten", spec);
  }

  // The #475 and #479 cause: a claude that supervised a run and then /cleared still read as its Supervisor, so its implement session went unrecorded.
  it("records the implement session of a claude whose supervision ended with a /clear", async () => {
    await supervise();
    await supervisionRecords().end(me, "clear");

    await record();

    expect(FactsFile.init(stateFolder).sessionsOf(issue)?.steps).toEqual([
      {
        agent: "implement",
        sessionId: "session-1",
        account: 1,
        configFolder: "/Users/dev/.claude",
      },
    ]);
  });

  it("records nothing for a claude still supervising a run", async () => {
    await supervise();

    await record();

    expect(FactsFile.init(stateFolder).sessionsOf(issue)).toBeUndefined();
  });
});
