import { readFileSync } from "node:fs";

import type { JevClient, JevRequest } from "./JevClient.ts";
import {
  type JevPrinted,
  newVersionLines,
  requireApiKey,
} from "./jevRunSteps.ts";

export interface JevRun {
  requestPath: string | undefined;
  apiKey: string | undefined;
  connect(apiKey: string): JevClient;
}

export async function runJev({
  requestPath,
  apiKey,
  connect,
}: JevRun): Promise<JevPrinted> {
  if (!requestPath) throw new Error("usage: npm run jev -- <request.json>");
  const client = connect(requireApiKey(apiKey));
  const request = readRequest(requestPath);
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
