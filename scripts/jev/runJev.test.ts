import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { JevClient, JevResult } from "./JevClient.ts";
import { runJev } from "./runJev.ts";

const cannedResult: JevResult = {
  model: "jev-1.13.0",
  answers: { isAboutWeather: { type: "noul", noul: 0.92 } },
  usage: { input_tokens: 41, output_tokens: 1 },
};

describe("runJev", () => {
  it("prints the answers and usage as JSON", async () => {
    const printed = await runJev({
      requestPath: writeRequestFile(),
      apiKey: "test-key",
      connect: () => fakeClient("jev-1.13.0"),
    });
    expect(JSON.parse(printed.stdout)).toEqual({
      answers: { isAboutWeather: { type: "noul", noul: 0.92 } },
      usage: { input_tokens: 41, output_tokens: 1 },
    });
  });

  it("prints nothing to stderr while jev-latest is the pin", async () => {
    const printed = await runJev({
      requestPath: writeRequestFile(),
      apiKey: "test-key",
      connect: () => fakeClient("jev-1.13.0"),
    });
    expect(printed.stderr).toEqual([]);
  });

  it("prints one stderr line when jev-latest has moved past the pin", async () => {
    const printed = await runJev({
      requestPath: writeRequestFile(),
      apiKey: "test-key",
      connect: () => fakeClient("jev-1.14.0"),
    });
    expect(printed.stderr).toEqual([
      "jev-1.14.0 is out; pinned to jev-1.13.0, see the Jev agent doc",
    ]);
  });

  it("stops with the shell-profile message when TYPESAFE_API_KEY is missing", async () => {
    const run = runJev({
      requestPath: writeRequestFile(),
      apiKey: undefined,
      connect: () => fakeClient("jev-1.13.0"),
    });
    await expect(run).rejects.toThrow(
      "TYPESAFE_API_KEY is not set. Set it in your shell profile; a session started before the key was added won't see it, so restart the session after adding it.",
    );
  });
});

describe("runJev when jev-latest can't be read", () => {
  it("still prints the answers, with one stderr line saying the check failed", async () => {
    const printed = await runJev({
      requestPath: writeRequestFile(),
      apiKey: "test-key",
      connect: () => ({
        send: () => Promise.resolve(cannedResult),
        latestVersion: () => Promise.reject(new Error("rate limited")),
      }),
    });
    expect(JSON.parse(printed.stdout)).toEqual({
      answers: { isAboutWeather: { type: "noul", noul: 0.92 } },
      usage: { input_tokens: 41, output_tokens: 1 },
    });
    expect(printed.stderr).toEqual([
      "Couldn't check jev-latest's version: rate limited",
    ]);
  });
});

function fakeClient(latest: string): JevClient {
  return {
    send: () => Promise.resolve(cannedResult),
    latestVersion: () => Promise.resolve(latest),
  };
}

function writeRequestFile(): string {
  const path = join(mkdtempSync(join(tmpdir(), "jev-")), "request.json");
  const request = {
    state: "The kettle whistled while rain tapped on the shed roof.",
    questions: {
      isAboutWeather: {
        type: "noul",
        instructions: "Does the text mention the weather?",
      },
    },
    model: "jev-0.1.0",
  };
  writeFileSync(path, JSON.stringify(request));
  return path;
}
