import { describe, expect, it } from "vitest";

import { activeAccountOf } from "./cswapAccount.ts";

describe("activeAccountOf", () => {
  it("reads the active account's number from `cswap status --json`", () => {
    expect(
      activeAccountOf('{"schemaVersion": 1, "active": {"number": 2}}'),
    ).toBe(2);
  });

  it("is undefined when cswap gives no active account, or no JSON", () => {
    expect(activeAccountOf('{"schemaVersion": 1}')).toBeUndefined();
    expect(activeAccountOf("cswap: command not found")).toBeUndefined();
  });
});
