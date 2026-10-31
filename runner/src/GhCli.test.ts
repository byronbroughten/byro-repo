import { describe, expect, it } from "vitest";

import { GhCli } from "./GhCli.ts";

const issue = { repo: "sheets-framework", number: 165 };
const blockers = `{"number":7,"repository_url":"https://api.github.com/repos/o/sheets-framework","state":"open"}\n`;

function ghError(stderr: string): Error {
  return Object.assign(new Error("Command failed: gh"), { stderr });
}

function scriptedGh(answers: (string | Error)[]) {
  const calls: string[][] = [];
  const run = async (...args: string[]): Promise<string> => {
    calls.push(args);
    const answer = answers.shift();
    if (answer === undefined) throw new Error("No scripted answer");
    if (answer instanceof Error) throw answer;
    return answer;
  };
  const waits: number[] = [];
  const wait = async (ms: number): Promise<void> => {
    waits.push(ms);
  };
  return { calls, waits, cli: new GhCli("o", run, wait) };
}

describe("GhCli reads", () => {
  it("retries a 5xx and returns the data", async () => {
    const { cli, waits } = scriptedGh([
      ghError("gh: HTTP 504: Gateway Timeout"),
      blockers,
    ]);
    expect(await cli.openBlockersOf(issue)).toEqual([
      { repo: "sheets-framework", number: 7 },
    ]);
    expect(waits).toEqual([2000]);
  });

  it("retries a network error and returns the data", async () => {
    const { cli } = scriptedGh([
      ghError(
        "error connecting to api.github.com\ncheck your internet connection",
      ),
      blockers,
    ]);
    expect(await cli.subIssuesOf(issue)).toHaveLength(1);
  });

  it("throws the last error after three tries", async () => {
    const { cli, calls, waits } = scriptedGh([
      ghError("HTTP 502"),
      ghError("HTTP 503"),
      ghError("HTTP 504"),
    ]);
    await expect(cli.openBlockersOf(issue)).rejects.toMatchObject({
      stderr: "HTTP 504",
    });
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([2000, 8000]);
  });

  it("throws a non-transient error without retrying", async () => {
    const { cli, calls } = scriptedGh([ghError("HTTP 401: Bad credentials")]);
    await expect(cli.openBlockersOf(issue)).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
});

describe("GhCli writes", () => {
  it("calls a write that gets a 504 once and throws", async () => {
    const { cli, calls } = scriptedGh([ghError("HTTP 504"), "url"]);
    await expect(cli.comment(issue, "hi")).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
});
