import { describe, expect, it } from "vitest";

import { notRunningPid } from "./lockFixture.ts";
import { identityOf, isStillRunning } from "./processIdentity.ts";

describe("a process identity", () => {
  it("names a running process by its pid and start time", async () => {
    const identity = await identityOf(process.pid);

    expect(identity.pid).toBe(process.pid);
    expect(identity.startedAt).toEqual(expect.any(String));
    expect(await isStillRunning(identity)).toBe(true);
  });

  it("is not running once its pid is reused by a later process", async () => {
    const reused = { pid: process.pid, startedAt: "Thu Jan  1 00:00:00 1970" };

    expect(await isStillRunning(reused)).toBe(false);
  });

  it("is not running once its process has exited", async () => {
    const identity = await identityOf(notRunningPid);

    expect(identity.startedAt).toBeUndefined();
    expect(await isStillRunning(identity)).toBe(false);
  });
});
