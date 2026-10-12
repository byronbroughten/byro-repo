import { dirname, join } from "node:path";

import { Ajv } from "ajv";

import type {
  LimitHit,
  StepOutput,
  StepResult,
  UsageReading,
  UsageWindow,
} from "./AgentStep.ts";
import { ContextMeter } from "./contextMeter.ts";

// Only the fields the stream reader uses, each from an observed `claude -p` stream.
interface InitEvent {
  type: "system";
  subtype: "init";
  session_id?: unknown;
  memory_paths?: { auto?: unknown };
}

interface RateLimitEvent {
  type: "rate_limit_event";
  rate_limit_info?: RateLimitInfo;
}

interface RateLimitInfo {
  status?: unknown;
  resetsAt?: unknown;
  rateLimitType?: unknown;
  unifiedWindows?: { five_hour?: RawWindow; seven_day?: RawWindow };
}

interface RawWindow {
  utilization?: unknown;
  resetsAt?: unknown;
}

interface ResultEvent {
  type: "result";
  subtype?: unknown;
  session_id?: unknown;
  is_error?: unknown;
  api_error_status?: unknown;
  result?: unknown;
  structured_output?: unknown;
}

const tooManyRequests = 429;

export class StepStream {
  private readonly meter = ContextMeter.init();
  private init: InitEvent | undefined;
  private rateLimit: RateLimitInfo | undefined;
  private result: ResultEvent | undefined;

  static init(): StepStream {
    return new StepStream();
  }

  // cswap and claude can print plain lines too; only JSON events count.
  observeLine(line: string): this {
    const event = parseLine(line);
    if (typeof event !== "object" || event === null) return this;
    this.meter.observe(event);
    const typed = event as { type?: unknown; subtype?: unknown };
    if (typed.type === "system" && typed.subtype === "init") {
      this.init = event as InitEvent;
    } else if (typed.type === "rate_limit_event") {
      this.rateLimit = (event as RateLimitEvent).rate_limit_info;
    } else if (typed.type === "result") {
      this.result = event as ResultEvent;
    }
    return this;
  }

  toResult(account: number, jsonSchema: object): StepResult {
    const sessionId = this._sessionId;
    const projectFolder = this._projectFolder;
    return {
      output: outputOf(this.result, jsonSchema),
      sessionId,
      account,
      configFolder: projectFolder && dirname(dirname(projectFolder)),
      transcriptPath:
        projectFolder && sessionId && join(projectFolder, `${sessionId}.jsonl`),
      peakContext: this.meter.peak,
      exitSubtype: stringOrUndefined(this.result?.subtype),
      usage: this.rateLimit && usageOf(this.rateLimit),
      limitHit: this._limitHit,
    };
  }

  private get _sessionId(): string | undefined {
    return (
      stringOrUndefined(this.result?.session_id) ??
      stringOrUndefined(this.init?.session_id)
    );
  }

  // The init event names the account's auto-memory folder, `<config>/projects/<cwd>/memory/`.
  private get _projectFolder(): string | undefined {
    const memoryPath = stringOrUndefined(this.init?.memory_paths?.auto);
    return memoryPath && dirname(memoryPath);
  }

  private get _limitHit(): LimitHit | undefined {
    const isRejected =
      this.rateLimit !== undefined && this.rateLimit.status !== "allowed";
    const isLimitError =
      this.result?.is_error === true &&
      this.result.api_error_status === tooManyRequests;
    if (!isRejected && !isLimitError) return undefined;
    return {
      window: stringOrUndefined(this.rateLimit?.rateLimitType),
      resetsAt: dateOf(this.rateLimit?.resetsAt),
    };
  }
}

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// The stream gives resetsAt in epoch seconds.
function dateOf(epochSeconds: unknown): Date | undefined {
  if (typeof epochSeconds !== "number") return undefined;
  return new Date(epochSeconds * 1000);
}

function usageOf(info: RateLimitInfo): UsageReading {
  return {
    fiveHour: windowOf(info.unifiedWindows?.five_hour),
    sevenDay: windowOf(info.unifiedWindows?.seven_day),
  };
}

function windowOf(raw: RawWindow | undefined): UsageWindow | undefined {
  const resetsAt = dateOf(raw?.resetsAt);
  if (typeof raw?.utilization !== "number" || !resetsAt) return undefined;
  return { utilization: raw.utilization, resetsAt };
}

function outputOf(
  result: ResultEvent | undefined,
  jsonSchema: object,
): StepOutput {
  if (result?.subtype === "error_max_structured_output_retries") {
    return schemaFailure(result, ["structured output retries ran out"]);
  }
  if (result?.subtype !== "success" || result.is_error === true) {
    return { status: "none" };
  }
  const record = result.structured_output;
  if (record === undefined || record === null) {
    return schemaFailure(result, ["no structured output"]);
  }
  const validate = new Ajv({ allErrors: true, strict: false }).compile(
    jsonSchema,
  );
  if (validate(record)) return { status: "valid", record };
  const problems = (validate.errors ?? []).map(
    (error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
  );
  return schemaFailure(result, problems);
}

function schemaFailure(result: ResultEvent, problems: string[]): StepOutput {
  const structured = result.structured_output;
  const rawOutput =
    structured === undefined || structured === null
      ? (stringOrUndefined(result.result) ?? "")
      : JSON.stringify(structured);
  return { status: "schemaFailure", rawOutput, problems };
}
