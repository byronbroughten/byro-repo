// Words the prompt scan: the calls the developer or auto mode's classifier answered, grouped by the command that needed the answer, beside what the tier gate says about it now.
import type { GateReplay } from "./gateReplay.ts";
import type { PermissionAnswer, RecordedCall } from "./transcriptCalls.ts";

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
  gateNow: string;
  example: string;
}

// How many leading words name a command: `npm run runner watch`, `gh issue view`, `git log`.
const keyLengths: Record<string, number> = { npm: 4, gh: 3 };
const defaultKeyLength = 2;
const cellLengths = { why: 90, example: 100 } as const;

// The developer answered a prompt; auto mode's classifier answered one the developer would see outside auto mode.
export function answererOf(permission: PermissionAnswer): Answerer | undefined {
  if (permission.source.startsWith("user")) return "developer";
  if (permission.reasonType === "classifier") return "classifier";
  return undefined;
}

export function promptReportOf({
  calls,
  sessionCount,
  top,
}: PromptReportInput): string {
  const developerRows = rowsOf(calls, "developer");
  const classifierRows = rowsOf(calls, "classifier");
  return [
    `Prompt scan of the last ${sessionCount} sessions, each Bash call replayed through this checkout's tier gate.`,
    "",
    `## The developer answered ${callCountOf(developerRows)}`,
    "",
    ...tableOf(developerRows, top, true),
    "",
    `## Auto mode's classifier answered ${callCountOf(classifierRows)}`,
    "",
    "Each is a prompt outside auto mode.",
    "",
    ...tableOf(classifierRows, top, false),
  ].join("\n");
}

function rowsOf(calls: ScannedCall[], answerer: Answerer): PromptRow[] {
  const groups = calls
    .filter(({ call }) => answererOf(call.permission) === answerer)
    .reduce((grouped, scanned) => {
      const key = commandKeyOf(scanned);
      grouped.set(key, [...(grouped.get(key) ?? []), scanned]);
      return grouped;
    }, new Map<string, ScannedCall[]>());
  return [...groups.entries()]
    .map(([command, members]) => rowOf(command, members))
    .sort((left, right) => right.count - left.count);
}

function rowOf(command: string, members: ScannedCall[]): PromptRow {
  const [{ call, replay }] = members as [ScannedCall, ...ScannedCall[]];
  return {
    count: members.length,
    command,
    askedBy:
      call.permission.reasonCode === "hook:PreToolUse"
        ? "a hook"
        : "Claude Code",
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
  return replay.words
    .filter((word) => word !== "" && !word.startsWith("-"))
    .slice(0, keyLengths[program] ?? defaultKeyLength)
    .map(placeholderOf)
    .join(" ");
}

// A path, a number or a quoted text differs call to call, so it would split one command into many rows.
function placeholderOf(word: string): string {
  if (/\s/.test(word)) return "<text>";
  if (word.includes("/")) return "<path>";
  if (/^\d+$/.test(word)) return "<n>";
  return word;
}

function tableOf(
  rows: PromptRow[],
  top: number,
  isAskerShown: boolean,
): string[] {
  if (rows.length === 0) return ["None."];
  const header = isAskerShown
    ? ["Calls", "Command", "Asked by", "The gate now", "Example"]
    : ["Calls", "Command", "The gate now", "Example"];
  const lines = rows.slice(0, top).map((row) => {
    const cells = isAskerShown
      ? [row.count, row.command, row.askedBy, row.gateNow, row.example]
      : [row.count, row.command, row.gateNow, row.example];
    return tableLineOf(cells.map(String));
  });
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
