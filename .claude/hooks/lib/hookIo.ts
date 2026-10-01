// Hook stdin/stdout plumbing shared by the guardrail hooks. See docs/claude-code-guardrails.md.
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The fields of Claude Code's hook payload these hooks read; every one may be absent.
export interface HookInput {
  session_id?: string;
  conversation_id?: string;
  transcript_path?: string;
  cwd?: string;
  workspace_roots?: string[];
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: ToolInput;
  agent_id?: string;
  agent_type?: string;
}

export interface ToolInput {
  command?: string;
  file_path?: string;
  path?: string;
  offset?: number;
  limit?: number;
  spreadsheet_id?: string;
  content?: unknown;
  text?: unknown;
  operations?: unknown;
}

// Every guardrail fails open: an unreadable input allows the call.
export function readHookInput(): HookInput | undefined {
  try {
    const input = JSON.parse(readFileSync(0, "utf8"));
    return input && typeof input === "object" ? input : undefined;
  } catch {
    return undefined;
  }
}

export function writeHookOutput(output: object): void {
  process.stdout.write(JSON.stringify(output));
}

export function writeDenyOutput(reason: string): void {
  writeHookOutput({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
  });
}

export function sessionStatePath(sessionId: string | undefined, suffix: string): string {
  const dir = join(tmpdir(), "claude-guardrails");
  mkdirSync(dir, { recursive: true });
  const safeId = String(sessionId ?? "unknown").replace(/[^\w-]/g, "_");
  return join(dir, `${safeId}.${suffix}`);
}

export function lineCount(path: string): number {
  return readFileSync(path, "utf8").replace(/\n$/, "").split("\n").length;
}

export async function runFailOpen(main: () => void | Promise<void>): Promise<void> {
  try {
    await main();
  } catch {
    // A hook bug must never block unrelated work.
  }
  process.exit(0);
}
