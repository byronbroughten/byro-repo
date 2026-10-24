// Decides the read-first gate: a call a row covers waits for a full read of each of that row's docs this session. Pure; readFirstGate.ts does the I/O.
import { join, sep } from "node:path";

import { type EditDecision, fullReadHowTo } from "./fullDocRead.ts";
import type { ToolInput } from "./hookIo.ts";
import {
  isLintedSource,
  isUnignoredProjectFile,
  projectRelative,
} from "./lintSet.ts";

// marker names the session's record of a full read of path.
export interface ReadFirstDoc {
  path: string;
  name: string;
  marker: string;
}

// tools are the PreToolUse tool names the row checks; covers sees only those.
export interface ReadFirstRow {
  docs: ReadFirstDoc[];
  rules: string[];
  tools: string[];
  covers: (call: CoveredCall) => boolean;
}

// generatedDirs are project-relative, one per package's sheets.config.json.
export interface ReadFirstCall {
  projectDir: string;
  cwd: string | undefined;
  toolName: string | undefined;
  toolInput: ToolInput | undefined;
  generatedDirs: string[];
}

// target is the project-relative file_path, when the call has one.
interface CoveredCall {
  toolName: string;
  toolInput: ToolInput;
  target: string | undefined;
  generatedDirs: string[];
}

export const tierTablePath = join("docs", "targets-and-gates.md");
export const codeStylePath = join("config", "docs", "code-style.md");
export const proseStylePath = join("docs", "prose-style.md");
export const writingDocPaths = {
  voice: join("docs", "writing-voice.md"),
  craft: join("docs", "writing-craft.md"),
} as const;
const workspacesRoot = join(".claude", "worktrees") + sep;
const tierCode = {
  folder: join(".claude", "hooks", "lib", "tiers") + sep,
  files: new Set([
    join(".claude", "hooks", "tierGate.ts"),
    join(".claude", "hooks", "gmailGate.ts"),
    join("runner", "src", "claudeWriteDecision.ts"),
  ]),
} as const;
const proseSkippedRoots = [
  join("packages", "writing"),
  join("docs", "agents", "outcomes"),
].map((root) => root + sep);
const textOperationTypes = new Set([
  "insert_text",
  "replace_text",
  "find_replace",
  "replace_named_range_content",
]);

// Each gated Doc tool, and whether a call to it writes text rather than only formatting.
const gatedDocWrites: Record<string, (toolInput: ToolInput) => boolean> = {
  mcp__gworkspace__create_doc: ({ content }) => hasText(content),
  mcp__gworkspace__modify_doc_text: ({ text }) => hasText(text),
  mcp__gworkspace__find_and_replace_doc: () => true,
  mcp__gworkspace__insert_doc_elements: () => true,
  mcp__gworkspace__batch_update_doc: ({ operations }) =>
    Array.isArray(operations) && operations.some(isTextOperation),
};

export const readFirstRows: ReadFirstRow[] = [
  {
    docs: [
      { path: tierTablePath, name: "the tier table", marker: "tiers-read" },
    ],
    rules: [
      "Change a tier rule only when your ticket or the developer's request calls for it; then no extra yes is needed. When neither does, leave the rule alone and don't ask.",
      "The tier table and the tier code change in the same commit.",
    ],
    ...fileEdits(
      (target) => isTierCode(rootRelative(target)) || isSettingsFile(target),
    ),
  },
  {
    docs: [
      { path: codeStylePath, name: "the code rules", marker: "style-read" },
    ],
    rules: [
      skipReasoningRule(join("config", "docs", "code-style") + sep),
      "Framework or app code also follows packages/framework/docs/code-style.md.",
    ],
    ...fileEdits(isLintedSource),
  },
  {
    docs: [
      { path: proseStylePath, name: "the prose rules", marker: "prose-read" },
    ],
    rules: [skipReasoningRule(join("docs", "prose-style") + sep)],
    ...fileEdits(isGatedProse),
  },
  {
    docs: [
      {
        path: writingDocPaths.voice,
        name: "the voice sheet",
        marker: "writing-voice-read",
      },
      {
        path: writingDocPaths.craft,
        name: "the craft sheet",
        marker: "writing-craft-read",
      },
    ],
    rules: [
      "Doc text is reader-facing prose; for academic work, read docs/academic-writing-style.md as well.",
      "Formatting-only Doc writes pass without them.",
    ],
    tools: Object.keys(gatedDocWrites),
    covers: ({ toolName, toolInput }) =>
      gatedDocWrites[toolName]?.(toolInput) ?? false,
  },
];

// docsRead are project-relative; a row whose rule throws fails open alone.
export function readFirstDecision(
  { projectDir, cwd, toolName, toolInput = {}, generatedDirs }: ReadFirstCall,
  docsRead: string[],
  rows: ReadFirstRow[] = readFirstRows,
): EditDecision {
  if (toolName === undefined) return { denyReason: undefined };
  const filePath = toolInput.file_path;
  const call: CoveredCall = {
    toolName,
    toolInput,
    target:
      typeof filePath === "string"
        ? projectRelative({ projectDir, cwd, filePath })
        : undefined,
    generatedDirs,
  };
  const missing = rows.filter(
    (row) =>
      row.docs.some((doc) => !docsRead.includes(doc.path)) &&
      row.tools.includes(toolName) &&
      isCovered(row, call),
  );
  return {
    denyReason:
      missing.length > 0 ? readFirstReason(missing, docsRead) : undefined,
  };
}

function fileEdits(
  isCovered: (target: string, generatedDirs: string[]) => boolean,
): Pick<ReadFirstRow, "tools" | "covers"> {
  return {
    tools: ["Edit", "Write"],
    covers: ({ target, generatedDirs }) =>
      target !== undefined && isCovered(target, generatedDirs),
  };
}

function isCovered(row: ReadFirstRow, call: CoveredCall): boolean {
  try {
    return row.covers(call);
  } catch {
    return false;
  }
}

function readFirstReason(missing: ReadFirstRow[], docsRead: string[]): string {
  const docs = missing
    .flatMap((row) => row.docs)
    .filter((doc) => !docsRead.includes(doc.path))
    .map((doc) => `${doc.path} (${doc.name})`);
  const rules = missing.flatMap((row) => row.rules).join(" ");
  return (
    `Read ${docs.join(" and ")} in full before this write, then retry. ` +
    `${fullReadHowTo}. ${rules}`
  );
}

function skipReasoningRule(reasoningDir: string): string {
  return `Skip ${reasoningDir} unless a rule's line doesn't decide your case.`;
}

function isTierCode(target: string): boolean {
  return target.startsWith(tierCode.folder) || tierCode.files.has(target);
}

// Relative to the workspace root for a path inside a workspace, else unchanged.
function rootRelative(target: string): string {
  if (!target.startsWith(workspacesRoot)) return target;
  return target.split(sep).slice(3).join(sep);
}

// A settings file at any root: the primary root, a package or a workspace.
function isSettingsFile(target: string): boolean {
  if (target.startsWith("..")) return false;
  const parts = target.split(sep);
  const fileName = parts.at(-1) ?? "";
  return (
    parts.at(-2) === ".claude" &&
    fileName.startsWith("settings") &&
    fileName.endsWith(".json")
  );
}

function isGatedProse(target: string): boolean {
  if (!target.endsWith(".md") || !isUnignoredProjectFile(target)) return false;
  return !proseSkippedRoots.some((root) => target.startsWith(root));
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value !== "";
}

function isTextOperation(operation: unknown): boolean {
  if (typeof operation !== "object" || operation === null) return false;
  const operationType = (operation as { type?: unknown }).type;
  return (
    typeof operationType === "string" && textOperationTypes.has(operationType)
  );
}
