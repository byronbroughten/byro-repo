import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { StepResult } from "./AgentStep.ts";
import { FakeAgentStep, type ScriptedStep } from "./FakeAgentStep.ts";
import { git } from "./GitFixture.ts";
import { type Command, runKnobsOf } from "./runKnobs.ts";
import type { RunResult, SpecRunConfig } from "./SpecRun.ts";
import {
  addSpec,
  clonePaths,
  commitRed,
  github,
  implemented,
  masterSetPath,
  notices,
  passes,
  primaryOf,
  primaryRoot,
  refOf,
  resultOf,
  reviewed,
  spec,
  specRun,
  stateFolder,
  ticketState,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

const fails: Command = ["node", "-e", "process.exit(1)"];

describe("run's preflight", () => {
  async function preflightOf(
    overrides: Partial<SpecRunConfig> = {},
  ): Promise<RunResult> {
    addSpec([1]);
    const agentStep = FakeAgentStep.init();
    const result = await specRun(agentStep, overrides).run(spec);
    expect(agentStep.requests).toEqual([]);
    expect(notices.sent.map(({ summary }) => summary)).toEqual([
      result.message,
    ]);
    return result;
  }

  it("Stops when an auth check fails", async () => {
    const result = await preflightOf({
      knobs: runKnobsOf({
        clonePaths,
        checks: [],
        authChecks: [passes, fails],
      }),
    });

    expect(result).toEqual<RunResult>({
      kind: "stopped",
      landed: [],
      message:
        "Preflight stopped the run: node -e process.exit(1) failed: GitHub auth or the claude login is missing",
    });
  });

  it("Stops when a primary clone is missing", async () => {
    rmSync(primaryOf("sheets-framework"), { recursive: true, force: true });

    const result = await preflightOf();

    expect(result.message).toBe(
      `Preflight stopped the run: sheets-framework's primary clone is missing at ${primaryOf("sheets-framework")}`,
    );
  });

  it("Stops when a primary checkout isn't on master", async () => {
    git(primaryOf("sheets-framework"), "switch", "-c", "elsewhere");

    const result = await preflightOf();

    expect(result.message).toBe(
      "Preflight stopped the run: sheets-framework's primary checkout is on elsewhere, not master",
    );
  });

  it("runs no checks and builds no master set, so an uncommitted edit that would fail a check neither Stops the run nor is touched", async () => {
    writeFileSync(join(primaryRoot, "RED"), "");
    addSpec([1]);
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(git(primaryRoot, "status", "--porcelain")).toBe("?? RED");
    expect(git(primaryRoot, "branch", "--show-current")).toBe("master");
    expect(existsSync(masterSetPath())).toBe(false);
  });
});

describe("run's master check", () => {
  const redMaster =
    "master red: node -e process.exit(require('fs').existsSync('RED') ? 1 : 0)";

  it("Stops the run naming master red when a ticket's checks go red on a red master, though an uncommitted edit would turn it green", async () => {
    commitRed(primaryRoot);
    rmSync(join(primaryRoot, "RED"));
    addSpec([1, 2]);

    const result = await specRun(
      FakeAgentStep.init(implemented("one.ts"), reviewed()),
    ).run(spec);

    expect(result).toEqual<RunResult>({
      kind: "stopped",
      landed: [],
      message: `Stopped the run at byro-repo #1's checks: ${redMaster}`,
    });
    expect(ticketState()["byro-repo #1"]?.step).toBe("checks");
    expect(github.issues.get(1)?.isOpen).toBe(true);
    expect(git(primaryRoot, "status", "--porcelain")).toBe("D RED");
  });

  it("checks master again on a rerun, rebuilding a master set the earlier run left half-removed", async () => {
    commitRed(primaryRoot);
    addSpec([1]);
    await specRun(FakeAgentStep.init(implemented("one.ts"), reviewed())).run(
      spec,
    );
    rmSync(join(masterSetPath(), ".git"));
    const rerunStep = FakeAgentStep.init();

    const result = await specRun(rerunStep).run(spec);

    expect(result.message).toBe(
      `Stopped the run at byro-repo #1's checks: ${redMaster}`,
    );
    expect(rerunStep.requests).toEqual([]);
  });

  it("Stops when the master set fails to build", async () => {
    addSpec([1]);
    let builds = 0;

    const result = await specRun(
      FakeAgentStep.init(implemented("RED"), reviewed()),
      {
        async installDependencies() {
          builds += 1;
          if (builds > 1) throw new Error("npm install failed");
        },
      },
    ).run(spec);

    expect(result.message).toBe(
      "Stopped the run at byro-repo #1's checks: the master set failed to build: npm install failed",
    );
    expect(ticketState()["byro-repo #1"]?.step).toBe("checks");
    expect(github.issues.get(1)?.isOpen).toBe(true);
  });

  it("Stops on a red master commit in a package clone", async () => {
    const redClone: Command = [
      "node",
      "-e",
      "process.exit(require('fs').existsSync('packages/framework/RED') ? 1 : 0)",
    ];
    commitRed(primaryOf("sheets-framework"));
    addSpec([1]);

    const result = await specRun(
      FakeAgentStep.init(implemented("one.ts"), reviewed()),
      {
        knobs: runKnobsOf({ clonePaths, checks: [redClone], authChecks: [] }),
      },
    ).run(spec);

    expect(result.message).toBe(
      `Stopped the run at byro-repo #1's checks: master red: ${redClone.join(" ")}`,
    );
  });
});

describe("run's unhandled Stops", () => {
  const stepError: StepResult = {
    ...reviewed(),
    output: { status: "none" },
    exitSubtype: "error_max_turns",
  };
  const schemaFailure: StepResult = {
    ...reviewed(),
    output: {
      status: "schemaFailure",
      rawOutput: "{}",
      problems: ["findings is required"],
    },
  };

  const outcomes: {
    outcome: string;
    steps: () => ScriptedStep[];
    logFile: string;
  }[] = [
    {
      outcome: "red checks",
      steps: () => [implemented("RED"), reviewed()],
      logFile: "byro-repo-213.log",
    },
    {
      outcome: "a step error",
      steps: () => [implemented("one.ts"), stepError],
      logFile: "byro-repo-213-steps/byro-repo-1-2-review.jsonl",
    },
    {
      outcome: "a schema failure",
      steps: () => [implemented("one.ts"), schemaFailure],
      logFile: "byro-repo-213-steps/byro-repo-1-2-review.jsonl",
    },
  ];

  it.each(outcomes)(
    "leaves the ticket unlanded in its workspace on $outcome, comments, sends one notice and ends the run",
    async ({ outcome, steps, logFile }) => {
      addSpec([1, 2]);

      const run = specRun(FakeAgentStep.init(...steps()));
      const result = await run.run(spec);

      expect(result).toEqual<RunResult>({
        kind: "stopped",
        landed: [],
        message: `Stopped on byro-repo #1: ${outcome}.`,
      });
      expect(github.issues.get(1)?.isOpen).toBe(true);
      expect(await run.workspaces.find(refOf(1))).toBeDefined();
      expect(github.comments).toHaveLength(1);
      expect(github.comments[0]?.issue).toEqual(spec);
      expect(github.comments[0]?.body).toContain(
        `The runner stopped on byro-repo #1, "Ticket 1": ${outcome}.`,
      );
      expect(github.comments[0]?.body).toContain(
        `Log: \`${join(stateFolder(), logFile)}\``,
      );
      expect(notices.sent.map(({ summary }) => summary)).toEqual([
        "Run started on 2 tickets as account 1: 5-hour 10%, weekly 20%.",
        result.message,
      ]);
    },
  );

  it("names an API error in the step-error comment, though its subtype says success", async () => {
    addSpec([1]);
    const apiError: StepResult = {
      ...resultOf(undefined),
      output: { status: "none" },
      errorText: "API Error: 400 input_schema does not support oneOf",
    };

    await specRun(FakeAgentStep.init(apiError)).run(spec);

    expect(github.comments[0]?.body).toContain(
      "The implement step ended on an error: API Error: 400 input_schema does not support oneOf",
    );
    expect(github.comments[0]?.body).not.toContain("ended success");
  });

  it("Stops again on a rerun while the stopped ticket is open, naming it", async () => {
    addSpec([1, 2]);
    await specRun(FakeAgentStep.init(implemented("RED"), reviewed())).run(spec);
    const rerunStep = FakeAgentStep.init();

    const result = await specRun(rerunStep).run(spec);

    expect(result).toEqual<RunResult>({
      kind: "stopped",
      landed: [],
      message:
        "byro-repo #1 is still open after its Stop (red checks); finish and land it, then rerun.",
    });
    expect(rerunStep.requests).toEqual([]);
  });

  it("skips the stopped ticket on a rerun once it is closed", async () => {
    addSpec([1, 2]);
    await specRun(FakeAgentStep.init(implemented("RED"), reviewed())).run(spec);
    github.edit(1, { isOpen: false });

    const result = await specRun(
      FakeAgentStep.init(implemented("two.ts"), reviewed()),
    ).run(spec);

    expect(result.landed).toEqual([refOf(2)]);
  });
});
