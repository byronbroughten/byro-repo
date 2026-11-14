import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FakeAgentStep } from "./FakeAgentStep.ts";
import { git } from "./GitFixture.ts";
import {
  addSpec,
  handoffResultOf,
  implemented,
  refOf,
  reviewed,
  spec,
  specRun,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

const heading = "## The implementer's points worth checking";
const point = "one.ts: the relaunch branch still computes warnings";

describe("run's review brief from the implement record", () => {
  it("hands the implement record's points worth checking to the review step's prompt", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      implemented("one.ts", { change: { pointsWorthChecking: [point] } }),
      reviewed(),
    );

    const result = await specRun(agentStep).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
    expect(agentStep.requests[1]?.prompt).toContain(`${heading}\n\n- ${point}`);
  });

  it("leaves the review step's prompt as it was when the record names none", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    await specRun(agentStep).run(spec);

    expect(agentStep.requests[1]?.prompt).not.toContain(heading);
  });

  it("hands the review the list of the record that ends the implement step, after a handoff", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(
      async (request) => {
        writeFileSync(join(request.cwd, "half.ts"), "half a ticket\n");
        return handoffResultOf({
          conclusion: "Half done.",
          filesToOpen: [],
          ruledOut: [],
          filesChanged: ["half.ts"],
          stillFailing: [],
        });
      },
      async (request) => {
        git(request.cwd, "add", "half.ts");
        return implemented("one.ts", {
          change: { pointsWorthChecking: [point] },
        })(request);
      },
      reviewed(),
    );

    await specRun(agentStep).run(spec);

    expect(agentStep.requests[2]?.prompt).toContain(`${heading}\n\n- ${point}`);
  });
});
