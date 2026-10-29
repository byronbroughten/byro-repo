import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eventLinesOf } from "@byronbroughten/spec-runner/EventFileNotices";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { sendCrashPush } from "./crashPush.ts";

const spec = { repo: "byro-repo", number: 331 };
const crash = { owner: "byronbroughten", spec, code: "2" };

let stateFolder: string;

beforeEach(() => {
  stateFolder = mkdtempSync(join(tmpdir(), "crash-push-"));
});

afterEach(() => {
  rmSync(stateFolder, { recursive: true, force: true });
});

describe("sendCrashPush", () => {
  it("writes a run-ended crash line", async () => {
    await sendCrashPush(crash, { stateFolder });

    expect(eventLinesOf(stateFolder, spec)).toEqual([
      expect.objectContaining({
        spec: "byro-repo#331",
        kind: "run-ended",
        ending: "crashed",
        commentUrl: "https://github.com/byronbroughten/byro-repo/issues/331",
      }),
    ]);
  });
});
