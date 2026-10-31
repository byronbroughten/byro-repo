import { describe, expect, it } from "vitest";

import {
  commitIn,
  github,
  subjectsOf,
  ticket,
  useWrapUpHarness,
  workspaceWith,
  wrapUp,
  writeFacts,
  writeSavedFacts,
} from "./wrapUpHarness.ts";

useWrapUpHarness();

describe("run's close step", () => {
  it("lands a Standalone ticket with undecided review items and leaves it open, saying so", async () => {
    github.parents.clear();
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts({ hasUndecidedReviewItems: true });

    const result = await wrapUp().run(ticket);

    expect(subjectsOf("byro-repo")).toContain(
      "Merge issue-218-wrap-up-script into master (#218)",
    );
    expect(github.closed).toEqual([]);
    expect(result.isLeftOpen).toBe(true);
  });

  it("still leaves it open, saying so, on a rerun", async () => {
    github.parents.clear();
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts({ hasUndecidedReviewItems: true });
    await wrapUp().run(ticket);

    const result = await wrapUp().run(ticket);

    expect(github.closed).toEqual([]);
    expect(result.isLeftOpen).toBe(true);
  });

  it("closes a Standalone ticket whose facts record no undecided items", async () => {
    github.parents.clear();
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts();

    const result = await wrapUp().run(ticket);

    expect(github.closed.map(({ issue }) => issue)).toEqual([ticket]);
    expect(result.isLeftOpen).toBeUndefined();
  });

  it("closes a ticket with a parent spec whatever its facts say", async () => {
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts({ hasUndecidedReviewItems: true });

    const result = await wrapUp().run(ticket);

    expect(github.closed.map(({ issue }) => issue)).toEqual([ticket]);
    expect(result.isLeftOpen).toBeUndefined();
  });

  it("closes a Standalone ticket from an older facts file with Proposals but no such fact", async () => {
    github.parents.clear();
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeSavedFacts({ proposals: 2 });

    await wrapUp().run(ticket);

    expect(github.closed.map(({ issue }) => issue)).toEqual([ticket]);
  });
});
