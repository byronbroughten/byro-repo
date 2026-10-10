import { readFileSync } from "node:fs";

import { type JevClient, jevPin, type JevRequest } from "./JevClient.ts";

export interface JevRun {
  requestPath: string | undefined;
  apiKey: string | undefined;
  connect(apiKey: string): JevClient;
}

export interface JevPrinted {
  stdout: string;
  stderr: string[];
}

export async function runJev({
  requestPath,
  apiKey,
  connect,
}: JevRun): Promise<JevPrinted> {
  if (!requestPath) throw new Error("usage: npm run jev -- <request.json>");
  if (!apiKey) {
    throw new Error(
      "TYPESAFE_API_KEY is not set. Set it in your shell profile; a session started before the key was added won't see it, so restart the session after adding it.",
    );
  }
  const request = readRequest(requestPath);
  const client = connect(apiKey);
  const [{ answers, usage }, stderr] = await Promise.all([
    client.send(request),
    newVersionLines(client),
  ]);
  return { stdout: JSON.stringify({ answers, usage }, null, 2), stderr };
}

// The request file's model field is dropped: the client sends every request to the pin.
function readRequest(path: string): JevRequest {
  const { state, questions } = JSON.parse(
    readFileSync(path, "utf8"),
  ) as JevRequest;
  return { state, questions };
}

// Best-effort: a failed version check never discards the answers.
async function newVersionLines(client: JevClient): Promise<string[]> {
  try {
    const latest = await client.latestVersion();
    if (latest === jevPin) return [];
    return [`${latest} is out; pinned to ${jevPin}, see the Jev agent doc`];
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return [`Couldn't check jev-latest's version: ${reason}`];
  }
}
