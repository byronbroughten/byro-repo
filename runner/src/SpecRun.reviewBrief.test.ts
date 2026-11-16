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

  it("launches the warm review in the implementer's session with the skill inlined and the fixed point pinned", async () => {
    addSpec([1]);
    const agentStep = FakeAgentStep.init(implemented("one.ts"), reviewed());

    await specRun(agentStep).run(spec);

    const review = agentStep.requests[1];
    expect(review?.resumeSessionId).toBeDefined();
    expect(review?.prompt).toContain(
      '<skill name="code-review">\nTwo-axis review. Read [the verdicts](docs/agents/verdicts.md).\n</skill>',
    );
    expect(review?.prompt).toMatch(
      /it resolves and the diff is non-empty, so the skill's step 1 is done\. .*commits since `master`:\n\n- `byro-repo`:\n {2}- [0-9a-f]+ Add one\.ts$/m,
    );
    expect(review?.prompt).not.toContain("Skill tool");
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
