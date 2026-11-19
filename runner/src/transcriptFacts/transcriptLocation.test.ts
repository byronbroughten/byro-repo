import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { localTranscriptsOf } from "./transcriptLocation.ts";

describe("localTranscriptsOf", () => {
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "large-reads-")));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  function writeSession(
    folder: string,
    sessionId: string,
    timestamps: string[],
  ): void {
    const project = join(home, folder, "projects", "-workspace");
    mkdirSync(project, { recursive: true });
    const lines = timestamps.map((timestamp) =>
      JSON.stringify({ type: "user", timestamp, message: { content: "hi" } }),
    );
    writeFileSync(join(project, `${sessionId}.jsonl`), `${lines.join("\n")}\n`);
  }

  it("reads each session that started in the range, once across the config folders, leaving out subagents", () => {
    writeSession("live", "inside", ["2026-11-02T10:00:00Z"]);
    writeSession("account-1", "inside", ["2026-11-02T10:00:00Z"]);
    writeSession("account-1", "also-inside", [
      "2026-11-09T10:00:00Z",
      "2026-11-12T10:00:00Z",
    ]);
    writeSession("account-1", "before", ["2026-10-30T10:00:00Z"]);
    writeSession("account-1", "after", ["2026-11-10T00:00:00Z"]);
    const subagents = join(
      home,
      "account-1",
      "projects",
      "-workspace",
      "inside",
      "subagents",
    );
    mkdirSync(subagents, { recursive: true });
    writeFileSync(join(subagents, "agent-1.jsonl"), "{}\n");
    const found = localTranscriptsOf(
      [join(home, "live"), join(home, "account-1"), join(home, "missing")],
      {
        from: new Date("2026-11-01T00:00:00Z"),
        to: new Date("2026-11-10T00:00:00Z"),
      },
    );
    expect(found.map(({ sessionId }) => sessionId).sort()).toEqual([
      "also-inside",
      "inside",
    ]);
  });

  it("skips a transcript last written before the range without reading it", () => {
    writeSession("live", "stale", ["2026-11-02T10:00:00Z"]);
    const path = join(home, "live", "projects", "-workspace", "stale.jsonl");
    const longAgo = new Date("2026-01-01T00:00:00Z");
    utimesSync(path, longAgo, longAgo);
    const found = localTranscriptsOf([join(home, "live")], {
      from: new Date("2026-11-01T00:00:00Z"),
      to: new Date("2026-11-10T00:00:00Z"),
    });
    expect(found).toEqual([]);
  });
});
