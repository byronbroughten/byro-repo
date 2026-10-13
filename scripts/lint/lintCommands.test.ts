import { describe, expect, it } from "vitest";

import { type Command, failedCommandsOf } from "./lintCommands.ts";

const passes: Command = ["node", "-e", "process.exit(0)"];
const fails: Command = ["node", "-e", "process.exit(1)"];
const failsToo: Command = ["node", "-e", "process.exit(2)"];

describe("failedCommandsOf", () => {
  it("runs every command after a failure and returns each one that failed", () => {
    expect(failedCommandsOf([fails, passes, failsToo])).toEqual([
      fails,
      failsToo,
    ]);
  });

  it("returns none when every command passes", () => {
    expect(failedCommandsOf([passes, passes])).toEqual([]);
  });
});
