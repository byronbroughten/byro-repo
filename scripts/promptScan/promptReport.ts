// Words the prompt scan: every stop in the scanned sessions, one table per kind, each grouped by the command that met it and ranked by count, beside what the tier gate says about it now.
// The kinds: calls the developer or auto mode's classifier answered, the gate's refusals, sandbox denials, Hand-backs and Claude Code's removal check.
import type { GateReplay } from "./gateReplay.ts";
import type {
  PermissionAnswer,
  RecordedCall,
  Stop,
} from "./transcriptCalls.ts";

export type Answerer = "developer" | "classifier";

export interface ScannedCall {
  call: RecordedCall;
  // A Bash call's replay through the gate; absent for every other tool.
  replay?: GateReplay;
}

interface PromptReportInput {
  calls: ScannedCall[];
  sessionCount: number;
  top: number;
}

interface PromptRow {
  count: number;
  command: string;
  askedBy: string;
  why: string;
  denied: string;
  gateNow: string;
  example: string;
}

type RowField = Exclude<keyof PromptRow, "count">;

interface TableKind {
  heading(calls: string): string;
  note?: string;
  // The cells between the command and the gate's word now.
  fields: RowField[];
  isMember(call: RecordedCall): boolean;
  // What splits one command's calls into rows of their own.
  groupOf?(call: RecordedCall): string;
}

// How many leading words name a command: `npm run runner watch`, `gh issue view`, `git log`.
const keyLengths: Record<string, number> = { npm: 4, gh: 3 };
const defaultKeyLength = 2;
const cellLengths = { why: 90, example: 100 } as const;
const headers: Record<RowField, string> = {
  command: "Command",
  askedBy: "Asked by",
  why: "Why",
  denied: "Denied",
  gateNow: "The gate now",
  example: "Example",
};

const tableKinds: TableKind[] = [
  {
    heading: (calls) => `The developer answered ${calls}`,
    fields: ["askedBy"],
    isMember: (call) => answererOf(call.permission) === "developer",
  },
  {
    heading: (calls) => `Auto mode's classifier answered ${calls}`,
    note: "Each is a prompt outside auto mode.",
    fields: [],
    isMember: (call) => answererOf(call.permission) === "classifier",
  },
  {
    heading: (calls) => `The gate refused ${calls}`,
    note: "Each is a call a hook stopped, its why the refusal's own.",
    fields: ["why"],
    isMember: (call) => call.stop?.kind === "refusal",
  },
  {
    heading: (calls) => `The sandbox denied ${calls}`,
    fields: ["denied"],
    isMember: (call) => call.stop?.kind === "sandboxDenial",
    groupOf: (call) => deniedOf(call.stop),
  },
  {
    heading: (calls) => `Hand-backs: ${calls}`,
    note: "Each is a command an agent asked the developer to run.",
    fields: [],
    isMember: (call) => call.stop?.kind === "handBack",
  },
  {
    heading: (calls) => `Claude Code's removal check stopped ${calls}`,
    fields: [],
    isMember: (call) => call.stop?.kind === "removalCheck",
  },
];

// The developer answered a prompt; auto mode's classifier answered one the developer would see outside auto mode.
export function answererOf(
  permission: PermissionAnswer | undefined,
): Answerer | undefined {
  if (!permission) return undefined;
  if (permission.source.startsWith("user")) return "developer";
  if (permission.reasonType === "classifier") return "classifier";
  return undefined;
}

// A call to report: one someone answered, or one a stop met.
export function isReported(call: RecordedCall): boolean {
  return answererOf(call.permission) !== undefined || call.stop !== undefined;
}

export function promptReportOf({
  calls,
  sessionCount,
  top,
}: PromptReportInput): string {
  return [
    `Prompt scan of the last ${sessionCount} sessions, each Bash call replayed through this checkout's tier gate.`,
    ...tableKinds.flatMap((kind) => sectionOf(kind, calls, top)),
  ].join("\n");
}

function sectionOf(
  kind: TableKind,
  calls: ScannedCall[],
  top: number,
): string[] {
  const rows = rowsOf(
    calls.filter(({ call }) => kind.isMember(call)),
    kind,
  );
  return [
    "",
    `## ${kind.heading(callCountOf(rows))}`,
    "",
    ...(kind.note ? [kind.note, ""] : []),
    ...tableOf(rows, kind.fields, top),
  ];
}

function rowsOf(calls: ScannedCall[], kind: TableKind): PromptRow[] {
  const groups = calls.reduce((grouped, scanned) => {
    const key = [commandKeyOf(scanned), kind.groupOf?.(scanned.call) ?? ""];
    const id = JSON.stringify(key);
    grouped.set(id, [...(grouped.get(id) ?? []), scanned]);
    return grouped;
  }, new Map<string, ScannedCall[]>());
  return [...groups.values()]
    .map((members) => rowOf(members, kind))
    .sort((left, right) => right.count - left.count);
}

function rowOf(members: ScannedCall[], kind: TableKind): PromptRow {
  const [scanned] = members as [ScannedCall, ...ScannedCall[]];
  const { call, replay } = scanned;
  return {
    count: members.length,
    command: commandKeyOf(scanned),
    askedBy:
      call.permission?.reasonCode === "hook:PreToolUse"
        ? "a hook"
        : "Claude Code",
    why:
      call.stop?.kind === "refusal"
        ? clipped(call.stop.why, cellLengths.why)
        : "",
    denied: kind.groupOf?.(call) ?? "",
    gateNow: replay
      ? `${replay.outcome}: ${clipped(replay.why, cellLengths.why)}`
      : "not a Bash call",
    example: clipped(
      call.command ?? call.target ?? call.tool,
      cellLengths.example,
    ),
  };
}

function commandKeyOf({ call, replay }: ScannedCall): string {
  if (call.tool !== "Bash") return call.tool;
  if (!replay?.words) return "(unparsed)";
  const [program = ""] = replay.words;
  return withoutFolderFlag(replay.words)
    .filter((word) => word !== "" && !word.startsWith("-"))
    .slice(0, keyLengths[program] ?? defaultKeyLength)
    .map(placeholderOf)
    .join(" ");
}

// `git -C <dir> add` is a `git add`, whichever checkout it names.
function withoutFolderFlag(words: string[]): string[] {
  const at = words.indexOf("-C");
  if (words[0] !== "git" || at < 0) return words;
  return [...words.slice(0, at), ...words.slice(at + 2)];
}

// A path, a number or a quoted text differs call to call, so it would split one command into many rows.
function placeholderOf(word: string): string {
  if (/\s/.test(word)) return "<text>";
  if (word.includes("/")) return "<path>";
  if (/^\d+$/.test(word)) return "<n>";
  return word;
}

// A home folder and a workspace's name differ call to call, so they would split one denial into many rows.
function deniedOf(stop: Stop | undefined): string {
  if (stop?.kind !== "sandboxDenial") return "";
  return stop.denied
    .replace(/^\/Users\/[^/]+/, "~")
    .replace(/\/worktrees\/[^/]+/g, "/worktrees/<name>");
}

function tableOf(rows: PromptRow[], fields: RowField[], top: number): string[] {
  if (rows.length === 0) return ["None."];
  const columns: RowField[] = ["command", ...fields, "gateNow", "example"];
  const header = ["Calls", ...columns.map((field) => headers[field])];
  const lines = rows
    .slice(0, top)
    .map((row) =>
      tableLineOf([String(row.count), ...columns.map((field) => row[field])]),
    );
  const more =
    rows.length > top ? [``, `${rows.length - top} more commands.`] : [];
  return [
    tableLineOf(header),
    tableLineOf(header.map(() => "---")),
    ...lines,
    ...more,
  ];
}

function tableLineOf(cells: string[]): string {
  return `| ${cells.map((cell) => cell.replaceAll("|", "\\|")).join(" | ")} |`;
}

function callCountOf(rows: PromptRow[]): string {
  const count = rows.reduce((total, { count }) => total + count, 0);
  return count === 1 ? "1 call" : `${count} calls`;
}

function clipped(text: string, length: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > length ? `${line.slice(0, length - 1)}…` : line;
}
