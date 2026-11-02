// Hook stdin/stdout plumbing shared by the guardrail hooks. See docs/claude-code-guardrails.md.
import { mkdirSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import type { SettingsLayers } from "./sandboxState.ts";

// The fields of Claude Code's hook payload these hooks read; every one may be absent.
export interface HookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  reason?: string;
  source?: "startup" | "resume" | "clear" | "compact";
  prompt?: string;
  tool_name?: string;
  tool_input?: ToolInput;
  error?: string;
  agent_id?: string;
  agent_type?: string;
}

export interface ToolInput {
  command?: string;
  file_path?: string;
  notebook_path?: string;
  offset?: number;
  limit?: number;
  content?: unknown;
  text?: unknown;
  operations?: unknown;
}

// Undefined when the file is missing or isn't JSON.
export function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
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

export function projectDirOf(input: HookInput | undefined): string {
  return process.env.CLAUDE_PROJECT_DIR ?? input?.cwd ?? process.cwd();
}

// A runner step runs under the gate root's settings, passed in `--settings`; an Interactive session, which leaves it unset, under its project's.
export function gateRootOf(input: HookInput | undefined): string {
  return process.env.BYRO_GATE_ROOT ?? projectDirOf(input);
}

export function settingsLayersOf(input: HookInput | undefined): SettingsLayers {
  return {
    home: homedir(),
    sessionRoot: projectDirOf(input),
    gateRoot: process.env.BYRO_GATE_ROOT,
  };
}

export function writeHookOutput(output: object): void {
  process.stdout.write(JSON.stringify(output));
}

export function writeDenyOutput(reason: string): void {
  writeHookOutput({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
}

export function sessionStatePath(
  sessionId: string | undefined,
  suffix: string,
): string {
  const dir = join(tmpdir(), "claude-guardrails");
  mkdirSync(dir, { recursive: true });
  const safeId = String(sessionId ?? "unknown").replace(/[^\w-]/g, "_");
  return join(dir, `${safeId}.${suffix}`);
}

export function sharedStatePath(suffix: string): string {
  const dir = join(tmpdir(), "claude-guardrails");
  mkdirSync(dir, { recursive: true });
  return join(dir, suffix);
}

export function lineCount(path: string): number {
  return readFileSync(path, "utf8").replace(/\n$/, "").split("\n").length;
}

export async function runFailOpen(
  main: () => void | Promise<void>,
): Promise<void> {
  try {
    await main();
  } catch {
    // A hook bug must never block unrelated work.
  }
  process.exit(0);
}
