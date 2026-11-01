import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { batchEventFilePathOf } from "@byronbroughten/spec-runner/BatchRecords";
import {
  eventLinesOf,
  rawLinesAt,
} from "@byronbroughten/spec-runner/EventFileNotices";
import type { MemberList } from "@byronbroughten/spec-runner/SpecRun";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type Crash, writeCrashLine } from "./crashLine.ts";

const spec = { repo: "byro-repo", number: 331 };
const crash: Crash = { owner: "byronbroughten", members: [spec], code: "2" };

let stateFolder: string;

beforeEach(() => {
  stateFolder = mkdtempSync(join(tmpdir(), "crash-line-"));
});

afterEach(() => {
  rmSync(stateFolder, { recursive: true, force: true });
});

describe("writeCrashLine", () => {
  it("writes a run-ended crash line", async () => {
    await writeCrashLine(crash, stateFolder);

    expect(eventLinesOf(stateFolder, spec)).toEqual([
      expect.objectContaining({
        spec: "byro-repo#331",
        kind: "run-ended",
        ending: "crashed",
        commentUrl: "https://github.com/byronbroughten/byro-repo/issues/331",
        summary: expect.stringContaining("tmux attach -t runner-byro-repo-331"),
      }),
    ]);
  });

  it("writes a Batch's crash line to its one event file, its record already closed", async () => {
    const members: MemberList = [spec, { repo: "byro-repo", number: 332 }];

    await writeCrashLine({ ...crash, members }, stateFolder);

    const lines = rawLinesAt(batchEventFilePathOf(stateFolder, members));
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({
        spec: "byro-repo#331",
        ending: "crashed",
        summary: expect.stringContaining(
          "tmux attach -t runner-byro-repo-331-332`, then rerun `npm run runner -- byronbroughten/byro-repo 331 332`",
        ),
      }),
    ]);
  });
});
