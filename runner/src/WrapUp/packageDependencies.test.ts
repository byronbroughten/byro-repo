import { describe, expect, it } from "vitest";

import { dependencyRangesOf } from "./packageDependencies.ts";

describe("dependencyRangesOf", () => {
  it("reads all four dependency fields", () => {
    const text = JSON.stringify({
      dependencies: { a: "^1.0.0" },
      devDependencies: { b: "~2.0.0" },
      optionalDependencies: { c: "3.0.0" },
      peerDependencies: { d: ">=4" },
    });

    expect(dependencyRangesOf(text)).toEqual(
      new Map([
        ["a", "^1.0.0"],
        ["b", "~2.0.0"],
        ["c", "3.0.0"],
        ["d", ">=4"],
      ]),
    );
  });

  it("counts missing fields as empty and ignores every other field", () => {
    const text = JSON.stringify({ scripts: { test: "vitest" } });

    expect(dependencyRangesOf(text)).toEqual(new Map());
  });
});
