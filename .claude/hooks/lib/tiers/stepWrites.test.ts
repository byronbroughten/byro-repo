import { describe, expect, it } from "vitest";

import { fakePlaces } from "./fakePlaces.ts";
import { isStepWritable } from "./stepWrites.ts";

describe("isStepWritable", () => {
  const places = fakePlaces();

  it("passes a path strictly inside the workspace or $TMPDIR, new or existing", () => {
    [
      "/ws/AGENTS.md",
      "/ws/new/file.ts",
      "/ws/packages/framework/src/x.ts",
      "/tmp/helper.mjs",
      "/tmp/new.txt",
    ].forEach((path) => expect(isStepWritable(path, places)).toBe(true));
  });

  it("refuses a root itself, a path outside, and one that leaves through `..` or a link", () => {
    [
      "/ws",
      "/tmp",
      "/outside/x",
      "/ws/../outside/x",
      "/ws/escape/x",
      "/ws/linkdir/../x",
      "ws/AGENTS.md",
    ].forEach((path) => expect(isStepWritable(path, places)).toBe(false));
  });

  it("refuses a dangling link, `.git` at any depth, and the hooks' own state", () => {
    [
      "/ws/dangling",
      "/ws/.git",
      "/ws/.git/hooks/pre-commit",
      "/ws/packages/framework/.git",
      "/tmp/repo/.git/config",
      "/tmp/claude-guardrails/chore-dry-runs.json",
    ].forEach((path) => expect(isStepWritable(path, places)).toBe(false));
  });
});
