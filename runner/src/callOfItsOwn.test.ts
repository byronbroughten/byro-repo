import { describe, expect, it } from "vitest";

import { callOfItsOwn } from "./callOfItsOwn.ts";

describe("callOfItsOwn", () => {
  it("puts the instruction first and names what must stay out of the call", () => {
    expect(callOfItsOwn("Run `npm test`")).toBe(
      "Run `npm test` in a call of its own, with no pipe, `cd`, `$(…)`, redirect other than `2>&1`, heredoc, flag before the script name, env prefix or other command beside it",
    );
  });
});
