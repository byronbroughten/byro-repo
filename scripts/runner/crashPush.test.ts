import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eventFilePathOf } from "@byronbroughten/spec-runner/EventFileNotices";
import { FakeNotices } from "@byronbroughten/spec-runner/FakeNotices";
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

function eventLines(): unknown[] {
  return readFileSync(eventFilePathOf(stateFolder, spec), "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as unknown);
}

describe("sendCrashPush", () => {
  it("pushes the crash and writes a run-ended crash line", async () => {
    const ntfy = FakeNotices.init();

    await sendCrashPush(crash, { ntfy, stateFolder });

    expect(ntfy.sent.map(({ summary }) => summary)).toEqual([
      "The runner exited unexpectedly with code 2; read its tmux pane, then rerun `npm run runner -- byronbroughten/byro-repo 331`.",
    ]);
    expect(eventLines()).toEqual([
      expect.objectContaining({
        spec: "byro-repo#331",
        kind: "run-ended",
        ending: "crashed",
        commentUrl: "https://github.com/byronbroughten/byro-repo/issues/331",
      }),
    ]);
  });

  it("writes the line with no topic to push to", async () => {
    await sendCrashPush(crash, { ntfy: undefined, stateFolder });

    expect(eventLines()).toEqual([
      expect.objectContaining({ kind: "run-ended", ending: "crashed" }),
    ]);
  });
});
