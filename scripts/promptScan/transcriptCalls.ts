// The tool calls a session transcript records a permission answer for: who let each through, a hook, a settings rule, auto mode or the developer.
// Claude Code writes the answer as `permissionDecision` on the tool result's entry, and the call itself is the assistant entry's tool_use with the same id.

export interface PermissionAnswer {
  source: string;
  decision: string;
  reasonType?: string;
  reasonCode?: string;
}

export interface RecordedCall {
  tool: string;
  // A Bash call's command; absent for every other tool.
  command?: string;
  // What another tool acted on: its file, URL, query or command.
  target?: string;
  cwd?: string;
  permission: PermissionAnswer;
}

interface TranscriptEntry {
  type?: unknown;
  cwd?: unknown;
  message?: { content?: unknown };
  permissionDecision?: unknown;
}

// One block of an entry's message, in Claude Code's wire spelling.
interface ContentBlock {
  type?: unknown;
  id?: unknown;
  name?: unknown;
  input?: unknown;
  tool_use_id?: unknown;
}

interface ToolUse {
  id: string;
  tool: string;
  command?: string;
  target?: string;
}

// The first of these a tool's input holds names what it acted on.
const targetFields = ["file_path", "url", "query", "command", "description"];

export function recordedCallsOf(jsonl: string): RecordedCall[] {
  const entries = jsonl.split("\n").flatMap((line) => entryOf(line) ?? []);
  const toolUses = entries.reduce((uses, entry) => {
    toolUsesOf(entry).forEach((use) => uses.set(use.id, use));
    return uses;
  }, new Map<string, ToolUse>());
  return entries.flatMap((entry) => recordedCallOf(entry, toolUses) ?? []);
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

function recordedCallOf(
  entry: TranscriptEntry,
  toolUses: Map<string, ToolUse>,
): RecordedCall | undefined {
  const permission = permissionAnswerOf(entry.permissionDecision);
  if (!permission) return undefined;
  const result = contentBlocksOf(entry).find(
    ({ type }) => type === "tool_result",
  );
  const useId = result?.tool_use_id;
  const use = typeof useId === "string" ? toolUses.get(useId) : undefined;
  if (!use) return undefined;
  const { tool, command, target } = use;
  const cwd = typeof entry.cwd === "string" ? entry.cwd : undefined;
  return { tool, command, target, cwd, permission };
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
