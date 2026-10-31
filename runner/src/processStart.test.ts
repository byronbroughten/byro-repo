import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { identityOf, isRunning } from "./processStart.ts";

function deadPid(): number {
  const { pid } = spawnSync("node", ["-e", ""]);
  if (pid === undefined) throw new Error("The throwaway process didn't start");
  return pid;
}

describe("a process identity", () => {
  it("names a running process by its pid and start time", async () => {
    const identity = await identityOf(process.pid);

    expect(identity.pid).toBe(process.pid);
    expect(identity.startedAt).toEqual(expect.any(String));
    expect(await isRunning(identity)).toBe(true);
  });

  it("is not running once its pid is reused by a later process", async () => {
    const reused = { pid: process.pid, startedAt: "Thu Jan  1 00:00:00 1970" };

    expect(await isRunning(reused)).toBe(false);
  });

  it("is not running once its process has exited", async () => {
    const identity = await identityOf(deadPid());

    expect(identity.startedAt).toBeUndefined();
    expect(await isRunning(identity)).toBe(false);
  });
});
