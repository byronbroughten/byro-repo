// The tool calls a session transcript records a permission answer for: who let each through, a hook, a settings rule, auto mode or the developer; and every stop, answered or not.
// Claude Code writes the answer as `permissionDecision` on the tool result's entry, and the call itself is the assistant entry's tool_use with the same id.
// A stop is a refusal, Claude Code's removal check or a sandbox denial on that result, or a Hand-back: a `! <command>` line in an assistant message, which has no tool call.

export interface PermissionAnswer {
  source: string;
  decision: string;
  reasonType?: string;
  reasonCode?: string;
}

export type Stop =
  // A PreToolUse hook's refusal, `why` its reason.
  | { kind: "refusal"; why: string }
  | { kind: "removalCheck" }
  // `denied` is the host or path the sandbox kept the call from.
  | { kind: "sandboxDenial"; denied: string }
  | { kind: "handBack" };

export interface RecordedCall {
  tool: string;
  // A Bash call's command; absent for every other tool.
  command?: string;
  // What another tool acted on: its file, URL, query or command.
  target?: string;
  // Absent only on a Hand-back, which no tool call made.
  permission?: PermissionAnswer;
  stop?: Stop;
}

interface TranscriptEntry {
  type?: unknown;
  message?: { content?: unknown };
  permissionDecision?: unknown;
  toolUseResult?: unknown;
  sandboxViolations?: unknown;
  sandboxed?: unknown;
}

// One block of an entry's message, in Claude Code's wire spelling.
interface ContentBlock {
  type?: unknown;
  id?: unknown;
  name?: unknown;
  input?: unknown;
  tool_use_id?: unknown;
  content?: unknown;
  text?: unknown;
}

interface ToolUse {
  id: string;
  tool: string;
  command?: string;
  target?: string;
}

// The first of these a tool's input holds names what it acted on.
const targetFields = ["file_path", "url", "query", "command", "description"];
// What marks a stop in a result's text.
const stopTexts = {
  hookErrorPrefix: /^PreToolUse:\w+ hook error: /,
  removalCheck: "could not be checked for dangerous rm operations",
  notPermitted: "Operation not permitted",
} as const;
// A longer line is output the call printed, such as a transcript it searched, not the error it hit.
const errorLineLength = 400;

export function recordedCallsOf(jsonl: string): RecordedCall[] {
  const entries = jsonl.split("\n").flatMap((line) => entryOf(line) ?? []);
  const toolUses = entries.reduce((uses, entry) => {
    toolUsesOf(entry).forEach((use) => uses.set(use.id, use));
    return uses;
  }, new Map<string, ToolUse>());
  return entries.flatMap((entry) => {
    const answered = answeredCallOf(entry, toolUses);
    return [...handBacksOf(entry), ...(answered ? [answered] : [])];
  });
}

function entryOf(line: string): TranscriptEntry | undefined {
  if (!line.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(line);
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function toolUsesOf(entry: TranscriptEntry): ToolUse[] {
  if (entry.type !== "assistant") return [];
  return contentBlocksOf(entry).flatMap(
    ({ type, id, name, input }): ToolUse[] => {
      if (type !== "tool_use" || typeof id !== "string") return [];
      if (typeof name !== "string") return [];
      if (name === "Bash") {
        return [{ id, tool: name, command: stringFieldOf(input, "command") }];
      }
      const target = targetFields
        .map((field) => stringFieldOf(input, field))
        .find((value) => value !== undefined);
      return [{ id, tool: name, target }];
    },
  );
}

function handBacksOf(entry: TranscriptEntry): RecordedCall[] {
  if (entry.type !== "assistant") return [];
  return contentBlocksOf(entry).flatMap(({ type, text }) => {
    if (type !== "text" || typeof text !== "string") return [];
    return text.split("\n").flatMap((line): RecordedCall[] => {
      if (!line.startsWith("! ")) return [];
      const command = line.slice(2).trim();
      if (!command) return [];
      return [{ tool: "Bash", command, stop: { kind: "handBack" } }];
    });
  });
}

function answeredCallOf(
  entry: TranscriptEntry,
  toolUses: Map<string, ToolUse>,
): RecordedCall | undefined {
  // Claude Code also logs each request it sends as an `api-request-blob` entry, repeating every tool result.
  if (entry.type !== "user") return undefined;
  const permission = permissionAnswerOf(entry.permissionDecision);
  if (!permission) return undefined;
  const result = contentBlocksOf(entry).find(
    ({ type }) => type === "tool_result",
  );
  const useId = result?.tool_use_id;
  const use = typeof useId === "string" ? toolUses.get(useId) : undefined;
  if (!use) return undefined;
  const { tool, command, target } = use;
  const resultText = textOf(result?.content);
  const stop = stopOf({ entry, permission, use, resultText });
  return { tool, command, target, permission, stop };
}

interface AnsweredResult {
  entry: TranscriptEntry;
  permission: PermissionAnswer;
  use: ToolUse;
  resultText: string;
}

function stopOf({
  entry,
  permission,
  use,
  resultText,
}: AnsweredResult): Stop | undefined {
  if (permission.decision === "reject") {
    if (resultText.includes(stopTexts.removalCheck)) {
      return { kind: "removalCheck" };
    }
    if (permission.source === "hook") {
      const why = resultText.replace(stopTexts.hookErrorPrefix, "");
      return { kind: "refusal", why };
    }
    return undefined;
  }
  if (use.tool !== "Bash" || entry.sandboxed === false) return undefined;
  const denied =
    deniedHostOf(entry.sandboxViolations) ??
    deniedInErrorOf(errorTextOf(entry.toolUseResult));
  return denied === undefined ? undefined : { kind: "sandboxDenial", denied };
}

// Claude Code records a denied host as `{ kind: "network", host }`, and a file denial only in the error text.
function deniedHostOf(raw: unknown): string | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .map((violation: unknown) => stringFieldOf(violation, "host"))
    .find((host) => host !== undefined);
}

// What the call wrote to stderr, or the error it failed with; never its stdout, which may quote a denial it read.
function errorTextOf(toolUseResult: unknown): string {
  if (typeof toolUseResult === "string") return toolUseResult;
  return stringFieldOf(toolUseResult, "stderr") ?? "";
}

function deniedInErrorOf(text: string): string | undefined {
  const lines = text
    .split("\n")
    .filter((line) => line.length <= errorLineLength);
  const blockDenial = lines
    .map((line) => /^deny \S+ (\S+)/.exec(line)?.[1])
    .find((denied) => denied !== undefined);
  if (blockDenial) return blockDenial.replace(/:\d+$/, "");
  const notPermitted = lines.find((line) =>
    line.includes(stopTexts.notPermitted),
  );
  if (notPermitted === undefined) return undefined;
  return pathInErrorOf(notPermitted);
}

// `fatal: Unable to create '<path>': …`, `touch: <path>: …`, `error: unable to create file <path>: …` or `error connecting to <path> (…)`.
function pathInErrorOf(line: string): string {
  const quoted = /'([^']+)'/.exec(line)?.[1];
  if (quoted) return quoted;
  const fields = line.split(": ");
  const pathField = fields.length >= 3 ? fields[fields.length - 2] : undefined;
  const lastWord = pathField?.trim().split(/\s+/).pop();
  if (lastWord) return lastWord;
  const pathLike = line.split(/\s+/).find((word) => word.includes("/"));
  return pathLike ?? "(no path named)";
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block: unknown) => stringFieldOf(block, "text") ?? "")
    .join("\n");
}

function contentBlocksOf(entry: TranscriptEntry): ContentBlock[] {
  const content = entry.message?.content;
  return Array.isArray(content) ? content.filter(isObject) : [];
}

function stringFieldOf(input: unknown, field: string): string | undefined {
  if (!isObject(input)) return undefined;
  const value: unknown = (input as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

function permissionAnswerOf(raw: unknown): PermissionAnswer | undefined {
  if (!isObject(raw)) return undefined;
  const { source, decision, reasonType, reasonCode } = raw as Record<
    string,
    unknown
  >;
  if (typeof source !== "string" || typeof decision !== "string") {
    return undefined;
  }
  return {
    source,
    decision,
    reasonType: typeof reasonType === "string" ? reasonType : undefined,
    reasonCode: typeof reasonCode === "string" ? reasonCode : undefined,
  };
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}
