import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  docContentGateReason,
  docWriteDecision,
  gatedDocWrites,
  isWritingStyleRead,
} from "./docContentGate.ts";
import type { ToolInput } from "./hookIo.ts";
import type { EditDecision } from "./styleGate.ts";

// Real tool inputs carry more fields than the gate reads.
type DocArgs = ToolInput & Record<string, unknown>;

function write(toolName: string, toolInput: DocArgs, hasReadWritingStyle = false): EditDecision {
  return docWriteDecision({ toolName: `mcp__gworkspace__${toolName}`, toolInput, hasReadWritingStyle });
}
const denied = { denyReason: docContentGateReason };
const allowed = { denyReason: undefined };

const contentWrites: [string, DocArgs][] = [
  ["create_doc", { content: "Hello, reader." }],
  ["modify_doc_text", { text: "A new sentence.", bold: true }],
  ["find_and_replace_doc", { find_text: "{{TITLE}}", replace_text: "Q3 report" }],
  ["insert_doc_elements", { element_type: "list", text: "First item" }],
  ["batch_update_doc", { operations: [{ type: "insert_text", end_of_segment: true, text: "Title\n" }] }],
  ["batch_update_doc", { operations: [{ type: "replace_text", start_index: 1, end_index: 4, text: "New" }] }],
  ["batch_update_doc", { operations: [{ type: "format_text", bold: true }, { type: "find_replace" }] }],
  ["batch_update_doc", { operations: [{ type: "replace_named_range_content", text: "x" }] }],
];

const formattingWrites: [string, DocArgs][] = [
  ["update_paragraph_style", { heading_level: 1 }],
  ["modify_doc_text", { bold: true, font_size: 12 }],
  ["batch_update_doc", { operations: [{ type: "format_text", italic: true }, { type: "update_paragraph_style" }] }],
  ["create_doc", { title: "Empty" }],
];

describe("docWriteDecision", () => {
  it("denies each text write before docs/writing-style.md was read", () => {
    contentWrites.forEach(([toolName, toolInput]) => {
      expect(write(toolName, toolInput), toolName).toEqual(denied);
    });
  });

  it("allows each formatting-only write before the read", () => {
    formattingWrites.forEach(([toolName, toolInput]) => {
      expect(write(toolName, toolInput), toolName).toEqual(allowed);
    });
  });

  it("allows every write after the read", () => {
    [...contentWrites, ...formattingWrites].forEach(([toolName, toolInput]) => {
      expect(write(toolName, toolInput, true), toolName).toEqual(allowed);
    });
  });

  it("leaves other tools alone", () => {
    expect(docWriteDecision({ toolName: "Edit", toolInput: { text: "x" }, hasReadWritingStyle: false })).toEqual(allowed);
    expect(write("modify_sheet_values", { text: "x" })).toEqual(allowed);
  });
});

describe("the refusal reason", () => {
  it("names the sheet, asks for a full Read, and points academic work to its sheet", () => {
    expect(docContentGateReason).toMatch(/docs\/writing-style\.md/);
    expect(docContentGateReason).toMatch(/full Read with no offset or limit/);
    expect(docContentGateReason).toMatch(/docs\/academic-writing-style\.md/);
    expect(docContentGateReason).toMatch(/reader-facing prose/);
    expect(docContentGateReason).toMatch(/retry/);
  });
});

describe("isWritingStyleRead", () => {
  const projectDir = "/repo";
  function read(filePath: string, bounds: { offset?: number; limit?: number } = {}): boolean {
    return isWritingStyleRead({ projectDir, cwd: projectDir, filePath, totalLines: 30, ...bounds });
  }

  it("is true for a full Read of docs/writing-style.md", () => {
    expect(read("/repo/docs/writing-style.md")).toBe(true);
    expect(read("/repo/docs/writing-style.md", { offset: 1, limit: 2000 })).toBe(true);
  });

  it("is false for a partial Read of the sheet", () => {
    expect(read("/repo/docs/writing-style.md", { limit: 10 })).toBe(false);
    expect(read("/repo/docs/writing-style.md", { offset: 5 })).toBe(false);
  });

  it("is false for a Read of another file", () => {
    expect(read("/repo/docs/academic-writing-style.md")).toBe(false);
    expect(read("/repo/docs/writing-style/register.md")).toBe(false);
  });
});

describe("gatedDocWrites", () => {
  it("is exactly what the doc content gate's PreToolUse matcher names", () => {
    const settings = JSON.parse(readFileSync(new URL("../../settings.json", import.meta.url), "utf8"));
    const matchers: string[] = settings.hooks.PreToolUse.filter(({ hooks }: { hooks: { command: string }[] }) =>
      hooks.some(({ command }) => command.includes("docContentGate.ts")),
    ).map(({ matcher }: { matcher: string }) => matcher);
    expect(matchers).toHaveLength(1);
    expect(new Set(matchers[0]?.split("|"))).toEqual(new Set(Object.keys(gatedDocWrites)));
  });
});
