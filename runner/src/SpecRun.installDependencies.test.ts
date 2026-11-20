import { describe, expect, it } from "vitest";

import { FakeAgentStep } from "./FakeAgentStep.ts";
import {
  addIssue,
  addSpec,
  implemented,
  primaryRoot,
  refOf,
  reviewed,
  rootCloneOnly,
  spec,
  specRun,
  useSpecRunHarness,
} from "./specRunHarness.ts";
import type { WrapUpCommands } from "./WrapUp.ts";

useSpecRunHarness(rootCloneOnly);

const withDependency = JSON.stringify({ dependencies: { "sh-syntax": "^1" } });

interface RecordedCommands {
  installs: string[];
  afterFastForwards: string[];
  wrapUpCommands: WrapUpCommands;
}

function recordingCommands(): RecordedCommands {
  const installs: string[] = [];
  const afterFastForwards: string[] = [];
  return {
    installs,
    afterFastForwards,
    wrapUpCommands: {
      async afterFastForward(root) {
        afterFastForwards.push(root);
      },
      async installDependencies(root) {
        installs.push(root);
      },
    },
  };
}

describe("run's landing installs", () => {
  it("installs wrap-up's dependencies in the primary root and runs the after-fast-forward hook when the branch adds a dependency", async () => {
    addSpec([1]);
    addIssue(1, {
      body: "## What to build\n\nA thing.\n\n## New dependencies\n\n- sh-syntax\n\n## Model fit\n\nOpus high\nA reason.\n",
    });
    const { installs, afterFastForwards, wrapUpCommands } = recordingCommands();
    const agentStep = FakeAgentStep.init(
      implemented("package.json", { content: withDependency }),
      reviewed(),
    );

    const result = await specRun(agentStep, { wrapUpCommands }).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(installs).toEqual([primaryRoot]);
    expect(afterFastForwards).toEqual([primaryRoot]);
  });

  it("installs nothing when the branch changes no dependency", async () => {
    addSpec([1]);
    const { installs, wrapUpCommands } = recordingCommands();
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    const result = await specRun(agentStep, { wrapUpCommands }).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(installs).toEqual([]);
  });
});
