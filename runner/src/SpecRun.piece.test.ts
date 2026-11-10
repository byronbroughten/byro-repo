import { describe, expect, it } from "vitest";

import { FakeAgentStep } from "./FakeAgentStep.ts";
import type { RunResult } from "./SpecRun.ts";
import {
  addSpec,
  github,
  implemented,
  refOf,
  reviewed,
  spec,
  specRun,
  useSpecRunHarness,
} from "./specRunHarness.ts";

useSpecRunHarness();

function addPieceSpec(tickets: number[]): void {
  addSpec(tickets);
  github.edit(spec.number, { labels: ["piece"] });
  tickets.forEach((ticket) => {
    github.edit(ticket, { labels: ["ready-for-agent", "research"] });
  });
}

describe("run on a piece spec", () => {
  it("refuses a ticket that isn't research at preflight, naming the drafting sequence", async () => {
    addPieceSpec([1, 2]);
    github.edit(2, { labels: ["ready-for-agent"] });
    const agentStep = FakeAgentStep.init();

    const result = await specRun(agentStep).run(spec);

    expect(result).toEqual<RunResult>({
      kind: "refused",
      landed: [],
      message:
        "A piece spec's drafting sequence isn't built yet, so the runner runs only its research tickets; not research: byro-repo #2.",
    });
    expect(agentStep.requests).toEqual([]);
  });

  it("refuses a research ticket at preflight, naming the research step", async () => {
    addPieceSpec([1]);
    const agentStep = FakeAgentStep.init();

    const result = await specRun(agentStep).run(spec);

    expect(result).toEqual<RunResult>({
      kind: "refused",
      landed: [],
      message:
        "A piece spec's research step isn't built yet, so the runner refuses its research tickets too: byro-repo #1.",
    });
    expect(agentStep.requests).toEqual([]);
  });
});

describe("run on a spec with no label", () => {
  it("runs a research-labelled ticket as code", async () => {
    addSpec([1]);
    github.edit(1, { labels: ["ready-for-agent", "research"] });

    const result = await specRun(
      FakeAgentStep.init(implemented("one.ts"), reviewed()),
    ).run(spec);

    expect(result.landed).toEqual([refOf(1)]);
  });
});
