import type { EntryType, Questions, SystemOneResult } from "@typesafe-ai/sdk";

// Bump it only with the developer's yes: docs/agents/jev.md.
export const jevPin = "jev-1.13.0";

export interface JevRequest {
  state: EntryType;
  questions: Questions;
}

export type JevResult = SystemOneResult<Questions>;

export interface JevClient {
  send(request: JevRequest): Promise<JevResult>;
  latestVersion(): Promise<string>;
}
