// A session's peak context: the most input + cache-read + cache-creation tokens any main-loop assistant message carried.

// A stream-json event or a transcript line; only the fields the meter reads.
interface AssistantEntry {
  type?: unknown;
  isSidechain?: unknown;
  parent_tool_use_id?: unknown;
  message?: AssistantMessage;
}

interface AssistantMessage {
  id?: unknown;
  usage?: Usage;
}

interface Usage {
  input_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
}

export class ContextMeter {
  // A message split across events repeats its usage, and a max counts it once without tracking ids.
  private _peak: number | undefined;

  static init(): ContextMeter {
    return new ContextMeter();
  }

  static ofTranscript(transcript: string): number | undefined {
    const meter = ContextMeter.init();
    transcript.split("\n").forEach((line) => meter.observe(parseLine(line)));
    return meter.peak;
  }

  get peak(): number | undefined {
    return this._peak;
  }

  observe(event: unknown): this {
    const usage = mainLoopMessage(event)?.usage;
    if (!usage) return this;
    const size = sumUsage(usage);
    if (this._peak === undefined || size > this._peak) this._peak = size;
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
function mainLoopMessage(event: unknown): AssistantMessage | undefined {
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
