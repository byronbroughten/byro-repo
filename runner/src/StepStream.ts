import { dirname, join } from "node:path";

import type {
  LimitHit,
  StepOutput,
  StepRequest,
  StepResult,
  UsageReading,
  UsageWindow,
} from "./AgentStep.ts";
import { ContextMeter } from "./contextMeter.ts";
import { schemaProblemsOf } from "./recordSchema.ts";

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
  permission_denials?: unknown;
}

const tooManyRequests = 429;

export class StepStream {
  private readonly meter = ContextMeter.init();
  private readonly liveCeiling: number | undefined;
  private init: InitEvent | undefined;
  private rateLimit: RateLimitInfo | undefined;
  private result: ResultEvent | undefined;

  constructor(liveCeiling: number | undefined) {
    this.liveCeiling = liveCeiling;
  }

  static init(liveCeiling?: number): StepStream {
    return new StepStream(liveCeiling);
  }

  get hasCrossedCeiling(): boolean {
    const peak = this.meter.peak;
    if (this.liveCeiling === undefined || peak === undefined) return false;
    return peak > this.liveCeiling;
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

  toResult({ account, jsonSchema }: StepRequest): StepResult {
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
      hasCrossedCeiling: this.hasCrossedCeiling,
      hang: undefined,
      exitSubtype: stringOrUndefined(this.result?.subtype),
      errorText: this._errorText,
      usage: this.rateLimit && usageOf(this.rateLimit),
      limitHit: this._limitHit,
      deniedTools: deniedToolsOf(this.result?.permission_denials),
    };
  }

  private get _errorText(): string | undefined {
    if (this.result?.is_error !== true) return undefined;
    return stringOrUndefined(this.result.result);
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
    const rejection =
      this.rateLimit?.status === "allowed" ? undefined : this.rateLimit;
    const isLimitError =
      this.result?.is_error === true &&
      this.result.api_error_status === tooManyRequests;
    if (!rejection && !isLimitError) return undefined;
    // An allowed reading's window isn't the one that was hit, so a bare 429 names none.
    return {
      window: stringOrUndefined(rejection?.rateLimitType),
      resetsAt: dateOf(rejection?.resetsAt),
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

function deniedToolsOf(denials: unknown): string[] {
  if (!Array.isArray(denials)) return [];
  return denials.flatMap((denial) => {
    const toolName = stringOrUndefined(denial?.tool_name);
    return toolName === undefined ? [] : [toolName];
  });
}

function outputOf(
  result: ResultEvent | undefined,
  jsonSchema: object,
): StepOutput {
  if (!result) return { status: "none" };
  const resultText = stringOrUndefined(result.result) ?? "";
  if (result.subtype === "error_max_structured_output_retries") {
    const problems = ["structured output retries ran out"];
    return { status: "schemaFailure", rawOutput: resultText, problems };
  }
  if (result.subtype !== "success" || result.is_error === true) {
    return { status: "none" };
  }
  const record = result.structured_output;
  if (record === undefined || record === null) {
    const problems = ["no structured output"];
    return { status: "schemaFailure", rawOutput: resultText, problems };
  }
  const problems = schemaProblemsOf(jsonSchema, record);
  if (problems.length === 0) return { status: "valid", record };
  return {
    status: "schemaFailure",
    rawOutput: JSON.stringify(record),
    problems,
  };
}
