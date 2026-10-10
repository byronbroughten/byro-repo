import { type JevClient, jevPin } from "./JevClient.ts";

export interface JevPrinted {
  stdout: string;
  stderr: string[];
}

export function requireApiKey(apiKey: string | undefined): string {
  if (!apiKey) {
    throw new Error(
      "TYPESAFE_API_KEY is not set. Set it in your shell profile; a session started before the key was added won't see it, so restart the session after adding it.",
    );
  }
  return apiKey;
}

// Best-effort: a failed version check never discards the answers.
export async function newVersionLines(client: JevClient): Promise<string[]> {
  try {
    const latest = await client.latestVersion();
    if (latest === jevPin) return [];
    return [`${latest} is out; pinned to ${jevPin}, see the Jev agent doc`];
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return [`Couldn't check jev-latest's version: ${reason}`];
  }
}
