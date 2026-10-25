import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { StepResult } from "./AgentStep.ts";
import { FakeAgentStep } from "./FakeAgentStep.ts";
import { git } from "./GitFixture.ts";
import type { Lease, LeaseHolder } from "./IssueWorkspaces.ts";
import { reviewRecordSchema } from "./reviewStep.ts";
import type { RunResult } from "./SpecRun.ts";
import {
  addSpec,
  applied,
  findingOf,
  freeHungRunLock,
  github,
  implemented,
  masterSubjects,
  notices,
  primaryOf,
  refOf,
  resultOf,
  reviewed,
  runStatePath,
  spec,
  specRun,
  ticketFacts,
  ticketState,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

describe("run's resume", () => {
  it("resumes a killed run at the step it reached, re-detaching the workspace's detached repos", async () => {
    addSpec([1]);
    let reachReview = () => {};
    const reachedReview = new Promise<void>((resolve) => {
      reachReview = resolve;
    });
    void specRun(
      FakeAgentStep.init(implemented("one.ts"), async () => {
        reachReview();
        return new Promise<StepResult>(() => {});
      }),
    ).run(spec);
    await reachedReview;
    freeHungRunLock();
    const framework = primaryOf("sheets-framework");
    writeFileSync(join(framework, "later.ts"), "export {};\n");
    git(framework, "add", "later.ts");
    git(framework, "commit", "-m", "Add later.ts");
    let detachedHead = "";
    const rerunStep = FakeAgentStep.init(async (request) => {
      detachedHead = git(
        join(request.cwd, "packages/framework"),
        "rev-parse",
        "HEAD",
      );
      return reviewed();
    });

    const result = await specRun(rerunStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(rerunStep.requests.map(({ jsonSchema }) => jsonSchema)).toEqual([
      reviewRecordSchema,
    ]);
    expect(detachedHead).toBe(git(framework, "rev-parse", "master"));
    expect(masterSubjects()).toContain(
      "Merge issue-1-ticket-1 into master (#1)",
    );
  });

  it("resumes a run state saved with prose findings at resolve, keeping resolve's own axis", async () => {
    addSpec([1]);
    let reachResolve = () => {};
    const reachedResolve = new Promise<void>((resolve) => {
      reachResolve = resolve;
    });
    void specRun(
      FakeAgentStep.init(
        implemented("one.ts"),
        reviewed([findingOf(1)]),
        async () => {
          reachResolve();
          return new Promise<StepResult>(() => {});
        },
      ),
    ).run(spec);
    await reachedResolve;
    freeHungRunLock();
    const saved = JSON.parse(readFileSync(runStatePath(), "utf8")) as {
      tickets: Record<string, { findings?: unknown[] }>;
    };
    const ticket = saved.tickets["byro-repo #1"] ?? {};
    ticket.findings = ["one.ts:1 is wrong."];
    writeFileSync(runStatePath(), JSON.stringify(saved));

    const result = await specRun(
      FakeAgentStep.init(
        resultOf({
          records: [
            {
              finding: 1,
              axis: "spec",
              where: "one.ts:1",
              claim: "Line 1 is wrong.",
              verdict: "dismiss",
              reason: "false-positive",
              evidence: "Checked it.",
            },
          ],
        }),
      ),
    ).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(ticketState()["byro-repo #1"]?.resolveRecords).toMatchObject([
      { finding: 1, axis: "spec", verdict: "dismiss" },
    ]);
  });

  it("resumes a run state saved under the resolve step's old names", async () => {
    await killAtResolveSavedAs({
      fixer: "triage",
      triageSession: "triage-session",
      triage: [],
    });

    const result = await specRun(dismissingResolver()).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    const state = ticketState()["byro-repo #1"];
    expect(state?.sessions).toEqual([
      { agent: "implement", sessionId: "implement-session" },
      { agent: "resolve", sessionId: "triage-session" },
      expect.objectContaining({ agent: "resolve" }),
    ]);
    expect(state).toMatchObject({
      resolver: "fresh",
      resolveRecords: [{ finding: 1, verdict: "dismiss" }],
    });
    ["fixer", "triageSession", "triage", "fixBase"].forEach((oldName) => {
      expect(state).not.toHaveProperty(oldName);
    });
    expect(ticketFacts().reviewFixes).toBe("fresh");
  });

  it("records a resumed state's sessions each under its own saved account and folder, leaving out an older one with no account", async () => {
    await killAtResolveSavedAs({
      configFolder: "/config/account-1",
      sessions: [
        {
          agent: "implement",
          sessionId: "implement-session",
          account: 2,
          configFolder: "/config/account-2",
        },
        { agent: "triage", sessionId: "triage-session" },
      ],
    });

    await specRun(dismissingResolver()).run(spec);

    const steps = ticketFacts().sessions?.steps ?? [];
    expect(steps[0]).toEqual({
      agent: "implement",
      sessionId: "implement-session",
      account: 2,
      configFolder: "/config/account-2",
    });
    expect(steps.map(({ sessionId }) => sessionId)).not.toContain(
      "triage-session",
    );
  });

  it("counts a crash saved under the resolve step's old name against resolve", async () => {
    await killAtResolveSavedAs({ crashes: { triage: 1 } });

    const result = await specRun(dismissingResolver()).run(spec);

    expect(result.landed).toEqual([]);
    const state = ticketState()["byro-repo #1"];
    expect(state).toMatchObject({ crashes: { resolve: 1 } });
    expect(state).not.toHaveProperty("crashes.triage");
    expect(notices.sent).toContainEqual(
      expect.objectContaining({ kind: "failure-halt" }),
    );
  });

  it("resumes an applied ticket killed at its wrap-up and lands it with no agent request", async () => {
    addSpec([1]);
    let reachWrapUp = () => {};
    const reachedWrapUp = new Promise<void>((resolve) => {
      reachWrapUp = resolve;
    });
    // The wrap-up hangs closing the issue.
    const hangingGitHub = new Proxy(github, {
      get(target, key) {
        if (key === "closeIssue") {
          return () => {
            reachWrapUp();
            return new Promise<void>(() => {});
          };
        }
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    void specRun(FakeAgentStep.init(applied()), {
      github: hangingGitHub,
    }).run(spec);
    await reachedWrapUp;
    freeHungRunLock();
    expect(ticketState()["byro-repo #1"]?.step).toBe("wrap-up");
    const rerunStep = FakeAgentStep.init();

    const result = await specRun(rerunStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(rerunStep.requests).toEqual([]);
    expect(github.issues.get(1)?.isOpen).toBe(false);
  });

  it("lets GitHub win: a ticket closed outside the run is skipped whatever its saved step", async () => {
    addSpec([1, 2]);
    let reachReview = () => {};
    const reachedReview = new Promise<void>((resolve) => {
      reachReview = resolve;
    });
    void specRun(
      FakeAgentStep.init(implemented("one.ts"), async () => {
        reachReview();
        return new Promise<StepResult>(() => {});
      }),
    ).run(spec);
    await reachedReview;
    freeHungRunLock();
    github.edit(1, { isOpen: false });

    const result = await specRun(
      FakeAgentStep.init(implemented("two.ts"), reviewed()),
    ).run(spec);

    expect(result.landed).toEqual([refOf(2)]);
  });
});

describe("run's leases", () => {
  // The test runner's parent outlives every test, so it stands in for an interactive session's claude.
  const session: LeaseHolder = { kind: "session", pid: process.ppid };

  it("skips a ticket another holder has leased while the others run, naming the holder, and runs it once the lease is gone", async () => {
    addSpec([1, 2]);
    const { workspaces } = specRun(FakeAgentStep.init());
    const leased = await workspaces.create(refOf(1));
    await workspaces.takeLease(leased, session);

    const result = await specRun(
      FakeAgentStep.init(
        implemented("two.ts"),
        reviewed(),
        implemented("one.ts"),
        reviewed(),
      ),
      { sleep: () => workspaces.releaseLease(leased) },
    ).run(spec);

    expect(result.landed).toEqual([refOf(2), refOf(1)]);
    expect(notices.sent.map(({ summary }) => summary)).toContain(
      `Idle: nothing runnable. byro-repo #1 is leased by a session (pid ${process.ppid}).`,
    );
  });

  it("waits on a ticket another holder leases between the pick and the take, rather than stopping it", async () => {
    addSpec([1, 2]);
    const run = specRun(FakeAgentStep.init(implemented("two.ts"), reviewed()));
    const leased = await run.workspaces.create(refOf(1));
    const openBlockersOf = github.openBlockersOf.bind(github);
    github.openBlockersOf = async (ref) => {
      if (ref.number === 1) await run.workspaces.takeLease(leased, session);
      return openBlockersOf(ref);
    };

    const result = await run.run(spec);

    expect(result).toEqual<RunResult>({
      kind: "stopped",
      landed: [refOf(2)],
      message: `Stopped on request: landed byro-repo #2. byro-repo #1 is leased by a session (pid ${process.ppid}).`,
    });
    expect(github.comments.filter(({ issue }) => issue.number === 1)).toEqual(
      [],
    );
  });

  it("leaves a ticket the session landed while holding the lease alone once it lets go", async () => {
    addSpec([1]);
    const { workspaces } = specRun(FakeAgentStep.init());
    const leased = await workspaces.create(refOf(1));
    await workspaces.takeLease(leased, session);
    await specRun(FakeAgentStep.init()).run(spec);
    github.edit(1, { isOpen: false });
    await workspaces.releaseLease(leased);

    const rerunStep = FakeAgentStep.init();
    const result = await specRun(rerunStep).run(spec);

    expect(result.message).toBe(
      "Run ended: landed nothing. Every ticket is closed.",
    );
    expect(rerunStep.requests).toEqual([]);
  });

  it("holds the lease on the ticket it works and releases it when it moves off, here on a Stop", async () => {
    addSpec([1]);
    let heldDuringStep: Lease | undefined;
    const run = specRun(
      FakeAgentStep.init(
        async (request) => {
          const workspace = await run.workspaces.find(refOf(1));
          heldDuringStep = workspace?.lease;
          return implemented("one.ts")(request);
        },
        reviewed([findingOf(1)]),
      ),
    );

    await run.run(spec);

    expect(heldDuringStep).toEqual({
      kind: "run",
      pid: process.pid,
      isLive: true,
    });
    const workspace = await run.workspaces.find(refOf(1));
    expect(workspace?.lease).toBeUndefined();
    await run.workspaces.start(refOf(1), session);
  });
});

// Kills a run at ticket 1's resolve and rewrites its saved state the way a run before #364 wrote it.
async function killAtResolveSavedAs(
  oldFields: Record<string, unknown>,
): Promise<void> {
  addSpec([1]);
  let reachResolve = () => {};
  const reachedResolve = new Promise<void>((resolve) => {
    reachResolve = resolve;
  });
  void specRun(
    FakeAgentStep.init(
      implemented("one.ts"),
      reviewed([findingOf(1)]),
      async () => {
        reachResolve();
        return new Promise<StepResult>(() => {});
      },
    ),
  ).run(spec);
  await reachedResolve;
  freeHungRunLock();
  const saved = JSON.parse(readFileSync(runStatePath(), "utf8")) as {
    tickets: Record<string, Record<string, unknown>>;
  };
  const { resolveBase, ...ticket } = saved.tickets["byro-repo #1"] ?? {};
  saved.tickets["byro-repo #1"] = {
    ...ticket,
    step: "fix",
    fixBase: resolveBase,
    sessions: [
      { agent: "implement", sessionId: "implement-session" },
      { agent: "triage", sessionId: "triage-session" },
    ],
    ...oldFields,
  };
  writeFileSync(runStatePath(), JSON.stringify(saved));
}

function dismissingResolver(): FakeAgentStep {
  return FakeAgentStep.init(
    resultOf({
      records: [
        {
          finding: 1,
          axis: "spec",
          where: "one.ts:1",
          claim: "Line 1 is wrong.",
          verdict: "dismiss",
          reason: "false-positive",
          evidence: "Checked it.",
        },
      ],
    }),
  );
}
