// The clock SpecRun tests start a run at and move through its fakes, for the durations a run logs.
// ../specRunHarness.ts re-assembles this bundle, so tests import from there; it also reads the logged lines back.

import type { ScriptedStep } from "../FakeAgentStep.ts";
import type { SpecRunConfig } from "../SpecRun.ts";
import type { StepScript } from "./stepResults.ts";

let time: number;

export const timing = {
  startTime(): Date {
    return new Date("2026-10-12T09:00:00Z");
  },

  // A clock the fakes move on; each workspace build installs dependencies in 4s.
  timed(): Partial<SpecRunConfig> {
    time = timing.startTime().getTime();
    return {
      clock: { now: () => new Date(time) },
      async installDependencies() {
        advance(4);
      },
    };
  },

  after(seconds: number, step: ScriptedStep): StepScript {
    return async (request) => {
      advance(seconds);
      return typeof step === "function" ? step(request) : step;
    };
  },
};

function advance(seconds: number): void {
  time += seconds * 1000;
}
