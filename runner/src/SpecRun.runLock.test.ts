import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { FakeAgentStep } from "./FakeAgentStep.ts";
import { deadPid, seedHolder } from "./lockFixture.ts";
import { runKnobsOf } from "./runKnobs.ts";
import { RunLock } from "./RunLock.ts";
import type { RunResult } from "./SpecRun.ts";
import {
  addSpec,
  bodyWith,
  clonePaths,
  github,
  greenUnlessRed,
  implemented,
  refOf,
  reviewed,
  runLockPath,
  spec,
  specRun,
  stateFolder,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

beforeEach(() => {
  mkdirSync(stateFolder(), { recursive: true });
});

describe("run's run lock", () => {
  it("refuses a run whose spec's lock a running pid holds, naming that pid and its start time, and leaves the lock and a stop request alone", async () => {
    addSpec([1]);
    seedHolder(runLockPath(), {
      pid: process.pid,
      host: hostname(),
      startedAt: "2026-10-12T08:00:00Z",
    });
    const stopRequest = join(stateFolder(), "byro-repo-213.stop");
    writeFileSync(stopRequest, "");
    const agentStep = FakeAgentStep.init();

    const result = await specRun(agentStep).run(spec);

    expect(result).toEqual<RunResult>({
      kind: "refused",
      landed: [],
      message: `byro-repo #213 already has a run going: pid ${process.pid}, started 2026-10-12T08:00:00Z.`,
    });
    expect(agentStep.requests).toEqual([]);
    expect(github.comments).toEqual([]);
    expect(existsSync(runLockPath())).toBe(true);
    expect(existsSync(stopRequest)).toBe(true);
  });

  it("counts an unreadable lock as held", async () => {
    addSpec([1]);
    writeFileSync(runLockPath(), "{ half-written");

    const result = await specRun(FakeAgentStep.init()).run(spec);

    expect(result.kind).toBe("refused");
    expect(result.message).toContain("unreadable");
  });

  it("takes over a lock whose pid has died, and the run proceeds", async () => {
    addSpec([1]);
    seedHolder(runLockPath(), {
      pid: deadPid(),
      host: hostname(),
      startedAt: "2026-01-01",
    });
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
  });

  it("is held while the run goes", async () => {
    addSpec([1]);
    let isHeldMidRun = false;
    const agentStep = FakeAgentStep.init(
      implemented("one.ts", {
        act: () => {
          isHeldMidRun = RunLock.isHeld(stateFolder(), spec);
        },
      }),
      reviewed(),
    );

    await specRun(agentStep).run(spec);

    expect(isHeldMidRun).toBe(true);
  });

  it("leaves no lock after a finished run", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    const result = await specRun(agentStep).run(spec);

    expect(result.kind).toBe("finished");
    expect(existsSync(runLockPath())).toBe(false);
  });

  it("leaves no lock after a stopped run", async () => {
    addSpec([1]);

    const result = await specRun(FakeAgentStep.init(), {
      knobs: runKnobsOf({
        clonePaths,
        checks: [greenUnlessRed],
        authChecks: [["false"]],
      }),
    }).run(spec);

    expect(result.kind).toBe("stopped");
    expect(existsSync(runLockPath())).toBe(false);
  });

  it("leaves no lock after a run refused for another reason", async () => {
    addSpec([1]);
    github.edit(1, { body: bodyWith("Haiku low") });

    const result = await specRun(FakeAgentStep.init()).run(spec);

    expect(result.kind).toBe("refused");
    expect(existsSync(runLockPath())).toBe(false);
  });

  it("leaves no lock after a run that throws", async () => {
    addSpec([1]);

    const run = specRun(FakeAgentStep.init(), {
      clock: {
        now: () => {
          throw new Error("The clock broke.");
        },
      },
    }).run(spec);

    await expect(run).rejects.toThrow("The clock broke.");
    expect(existsSync(runLockPath())).toBe(false);
  });
});
