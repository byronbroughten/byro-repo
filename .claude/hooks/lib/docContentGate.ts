// Decides the doc content gate: a Google Doc write that adds text waits for a full Read of docs/writing-style.md this session. Pure; docContentGate.ts does the I/O.
import { sep } from "node:path";

import type { ToolInput } from "./hookIo.ts";
import { type EditDecision, isFullDocRead, type StyleRead } from "./styleGate.ts";

export const docContentGateReason =
  "Read docs/writing-style.md before your first Google Doc text write this session, then retry. " +
  "Doc text is reader-facing prose. Use a full Read with no offset or limit (a partial Read or a Bash read isn't recorded); for academic work, read docs/academic-writing-style.md as well. Formatting-only writes pass without it.";
export const writingStylePath = ["docs", "writing-style.md"].join(sep);

const textOperationTypes = new Set(["insert_text", "replace_text", "find_replace", "replace_named_range_content"]);

// Each gated tool, and whether a call to it writes text rather than only formatting.
export const gatedDocWrites = {
  mcp__gworkspace__create_doc: ({ content }: ToolInput) => hasText(content),
  mcp__gworkspace__modify_doc_text: ({ text }: ToolInput) => hasText(text),
  mcp__gworkspace__find_and_replace_doc: () => true,
  mcp__gworkspace__insert_doc_elements: () => true,
  mcp__gworkspace__batch_update_doc: ({ operations }: ToolInput) =>
    Array.isArray(operations) && operations.some(isTextOperation),
} as const;

interface DocWrite {
  toolName: string | undefined;
  toolInput: ToolInput | undefined;
  hasReadWritingStyle: boolean;
}

export function docWriteDecision({ toolName, toolInput, hasReadWritingStyle }: DocWrite): EditDecision {
  if (hasReadWritingStyle || !isGatedDocWrite(toolName)) return { denyReason: undefined };
  return { denyReason: gatedDocWrites[toolName](toolInput ?? {}) ? docContentGateReason : undefined };
}

export function isWritingStyleRead(read: StyleRead): boolean {
  return isFullDocRead(read, writingStylePath);
}

function isGatedDocWrite(toolName: string | undefined): toolName is keyof typeof gatedDocWrites {
  return toolName !== undefined && Object.hasOwn(gatedDocWrites, toolName);
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value !== "";
}

function isTextOperation(operation: unknown): boolean {
  if (typeof operation !== "object" || operation === null) return false;
  const operationType = (operation as { type?: unknown }).type;
  return typeof operationType === "string" && textOperationTypes.has(operationType);
}
