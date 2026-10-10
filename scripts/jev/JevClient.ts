import type { EntryType, Questions, SystemOneResult } from "@typesafe-ai/sdk";

// Changing it follows the upgrade procedure in docs/agents/jev.md.
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
