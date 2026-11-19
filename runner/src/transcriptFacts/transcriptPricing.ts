// What a transcript's replies cost at API prices. Refresh the price table when a new model version ships (docs/agents/model-fit.md).

import type {
  SessionEntries,
  TranscriptEntry,
  Usage,
} from "./transcriptLocation.ts";

export interface ModelPrice {
  // Dollars per million tokens; a 5-minute cache write is 1.25× input and a 1-hour write 2×.
  input: number;
  output: number;
  cacheRead: number;
}

interface CacheWrites {
  fiveMinute: number;
  oneHour: number;
}

// From the claude-api skill, cached 2026-10-06; keyed by model id without the `claude-` prefix or a date suffix.
export const modelPrices: Record<string, ModelPrice> = {
  "fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "fable-5": { input: 10, output: 50, cacheRead: 1 },
  "opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
  "opus-4-7": { input: 5, output: 25, cacheRead: 0.5 },
  "opus-4-6": { input: 5, output: 25, cacheRead: 0.5 },
  "sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3 },
  "haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 }, // Prompts up to 100K tokens.
  "haiku-4-5": { input: 1, output: 5, cacheRead: 0.1 },
};

// Undefined when a model missing from the price table used any tokens.
export function costUsdOf(transcripts: SessionEntries[]): number | undefined {
  const costs = transcripts
    .flatMap(({ entries, subagents }) => [entries, ...subagents])
    .flatMap((entries) => [...repliesOf(entries).values()])
    .map(replyCostOf);
  if (costs.some((cost) => cost === undefined)) return undefined;
  return costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0);
}

// A reply split across entries repeats its message id; the last entry wins.
function repliesOf(entries: TranscriptEntry[]): Map<unknown, TranscriptEntry> {
  return entries.reduce((replies, entry, index) => {
    if (entry.type !== "assistant") return replies;
    replies.set(entry.message?.id ?? index, entry);
    return replies;
  }, new Map<unknown, TranscriptEntry>());
}

function replyCostOf({ message }: TranscriptEntry): number | undefined {
  const usage = message?.usage ?? {};
  const input = tokensOf(usage.input_tokens);
  const output = tokensOf(usage.output_tokens);
  const cacheRead = tokensOf(usage.cache_read_input_tokens);
  const { fiveMinute, oneHour } = cacheWritesOf(usage);
  const price =
    typeof message?.model === "string"
      ? modelPrices[priceKeyOf(message.model)]
      : undefined;
  if (price === undefined) {
    return input + output + cacheRead + fiveMinute + oneHour === 0
      ? 0
      : undefined;
  }
  const dollarsPerMTok =
    input * price.input +
    output * price.output +
    cacheRead * price.cacheRead +
    fiveMinute * price.input * 1.25 +
    oneHour * price.input * 2;
  return dollarsPerMTok / 1_000_000;
}

// Without a per-duration split, all cache creation is priced as 5-minute writes.
function cacheWritesOf(usage: Usage): CacheWrites {
  if (usage.cache_creation === undefined) {
    return {
      fiveMinute: tokensOf(usage.cache_creation_input_tokens),
      oneHour: 0,
    };
  }
  return {
    fiveMinute: tokensOf(usage.cache_creation.ephemeral_5m_input_tokens),
    oneHour: tokensOf(usage.cache_creation.ephemeral_1h_input_tokens),
  };
}

function tokensOf(tokens: unknown): number {
  return typeof tokens === "number" ? tokens : 0;
}

export function priceKeyOf(model: string): string {
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}
