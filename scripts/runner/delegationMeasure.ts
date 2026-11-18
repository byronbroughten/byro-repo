// `npm run delegation:measure`: the median main-loop turns after a large Read, by session kind, over the local
// transcripts of sessions started in a date range, across the live config folder and each cswap account's backup.
// The core is runner/src/largeReadTurns.ts; this gathers the config folders and prints its table.
import { homedir } from "node:os";

import {
  type DateRange,
  type KindTurns,
  largeReadChars,
  largeReadTurnsOf,
  localTranscriptsOf,
} from "@byronbroughten/spec-runner/largeReadTurns";
import { accountConfigFoldersOf } from "@byronbroughten/spec-runner/transcriptFacts";

const usage =
  "Usage: npm run delegation:measure -- --since <date> [--until <date>]; --until defaults to now";

const range = rangeOf(process.argv.slice(2));
if (range === undefined) {
  console.error(usage);
  process.exitCode = 1;
} else {
  const transcripts = localTranscriptsOf(
    accountConfigFoldersOf(process.env, homedir()),
    range,
  );
  process.stdout.write(reportOf(largeReadTurnsOf(transcripts), range));
}

// Undefined for an argument the usage line doesn't allow, a flag given twice, an unreadable date or an empty range.
function rangeOf(args: string[]): DateRange | undefined {
  if (args.length % 2 !== 0) return undefined;
  const dates = new Map<string, Date>();
  for (let index = 0; index < args.length; index += 2) {
    const [flag, value] = [args[index], args[index + 1]];
    if (flag !== "--since" && flag !== "--until") return undefined;
    const date = new Date(value ?? "");
    if (dates.has(flag) || Number.isNaN(date.getTime())) return undefined;
    dates.set(flag, date);
  }
  const from = dates.get("--since");
  const to = dates.get("--until") ?? new Date();
  if (from === undefined || from >= to) return undefined;
  return { from, to };
}

function reportOf(kinds: KindTurns[], { from, to }: DateRange): string {
  const heading = `Turns after a large read (a Read result of ${largeReadChars}+ characters), by session kind, in sessions started ${from.toISOString()} to ${to.toISOString()}:`;
  if (kinds.length === 0) return `${heading}\nnone\n`;
  const rows = [
    ["kind", "large reads", "sessions", "median turns after"],
    ...kinds.map(({ kind, turnsAfter, sessionCount, median }) => [
      kind,
      String(turnsAfter.length),
      String(sessionCount),
      String(median),
    ]),
  ];
  const widths = rows[0]?.map((_, column) =>
    Math.max(...rows.map((row) => row[column]?.length ?? 0)),
  );
  const lines = rows.map((row) =>
    row.map((cell, column) => cell.padEnd(widths?.[column] ?? 0)).join("  "),
  );
  return `${heading}\n${lines.join("\n")}\n`;
}
