// The context meter: a session's peak context, the most input + cache-read + cache-creation tokens any one
// main-loop assistant message carried. Feed it `claude -p --output-format stream-json --verbose` events one at
// a time with observe(), or a whole transcript with ofTranscript(). The runner reads it for the fixer pick,
// the live kill and the log's Peak context; the root's context-nudge hook reads it too.

// A stream-json event or a transcript line; only the fields the meter reads.
interface AssistantEntry {
  type?: unknown;
  isSidechain?: unknown;
  parent_tool_use_id?: unknown;
  message?: { id?: unknown; usage?: Usage };
}

interface Usage {
  input_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
}

export class ContextMeter {
  // Keyed by message id, so a message split across events counts once; a message with no id gets its own key.
  private readonly sizeByMessage = new Map<unknown, number>();

  static init(): ContextMeter {
    return new ContextMeter();
  }

  static ofTranscript(transcript: string): number | undefined {
    const meter = ContextMeter.init();
    transcript.split("\n").forEach((line) => meter.observe(parseLine(line)));
    return meter.peak;
  }

  get peak(): number | undefined {
    if (this.sizeByMessage.size === 0) return undefined;
    return Math.max(...this.sizeByMessage.values());
  }

  observe(event: unknown): this {
    const message = mainLoopMessage(event);
    if (!message?.usage) return this;
    const key = typeof message.id === "string" ? message.id : Symbol();
    this.sizeByMessage.set(key, sumUsage(message.usage));
    return this;
  }
}

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

// A subagent's message carries a parent_tool_use_id in the stream and isSidechain in a transcript.
function mainLoopMessage(event: unknown): AssistantEntry["message"] {
  if (typeof event !== "object" || event === null) return undefined;
  const entry = event as AssistantEntry;
  if (entry.type !== "assistant" || entry.isSidechain === true) {
    return undefined;
  }
  if (
    entry.parent_tool_use_id !== undefined &&
    entry.parent_tool_use_id !== null
  ) {
    return undefined;
  }
  return entry.message;
}

const contextTokenFields = [
  "input_tokens",
  "cache_read_input_tokens",
  "cache_creation_input_tokens",
] as const;

function sumUsage(usage: Usage): number {
  return contextTokenFields.reduce((sum, field) => {
    const tokens = usage[field];
    return typeof tokens === "number" ? sum + tokens : sum;
  }, 0);
}
