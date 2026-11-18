// `npm run outcome:summary`: the outcome log's rows a planning session asks for, by spec section, with their outliers.
// The core is runner/src/outcomeSummary.ts; this gathers the row files from the primary root's outcome folder, the transcripts on disk and each ticket's Model fit.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { messageOf } from "@byronbroughten/spec-runner/failureText";
import type { IssueRef } from "@byronbroughten/spec-runner/IssueWorkspaces";
import {
  defaultRowCount,
  isWorkflowName,
  type OutcomeRowFile,
  outcomeSummaryOf,
  type SectionSelection,
} from "@byronbroughten/spec-runner/outcomeSummary";
import {
  configFolderOf,
  hasTranscript,
} from "@byronbroughten/spec-runner/transcriptFacts";

import { issueReader } from "./issueReader.ts";
import { outcomeFolder, runKnobs } from "./runnerConfig.ts";

const usage = `Usage: npm run outcome:summary -- [<spec section, such as byro-repo-480> | --recent <N> | --all] [--workflow <code | piece>] [--pair <pair, such as "Opus medium">] [--repo <ticket repo>] [--spec <spec section>] [--since <date>] [--outliers]; with no section, --recent or --all, the last ${defaultRowCount} rows by landing date`;

const filterKeyByFlag: Record<string, "pair" | "repo" | "spec"> = {
  "--pair": "pair",
  "--repo": "repo",
  "--spec": "spec",
};

const selection = selectionOf(process.argv.slice(2));
if (selection === undefined) {
  console.error(usage);
  process.exitCode = 1;
} else {
  const folders = configFolders();
  process.stdout.write(
    await outcomeSummaryOf({
      rowFiles: rowFiles(),
      selection,
      outcomeFolder,
      ticketBudget: runKnobs.ticketBudget,
      modelFitOf,
      hasTranscript: (sessionId) =>
        folders.some((folder) => hasTranscript(folder, sessionId)),
    }),
  );
}

interface ParsedArgument {
  selection: SectionSelection;
  argCount: number;
}

// Undefined for arguments the usage line doesn't allow, a flag given twice or two scopes among them.
function selectionOf(args: string[]): SectionSelection | undefined {
  let selection: SectionSelection = {};
  let index = 0;
  while (index < args.length) {
    const parsed = parsedArgumentOf(selection, args.slice(index));
    if (parsed === undefined) return undefined;
    selection = parsed.selection;
    index += parsed.argCount;
  }
  return selection;
}

// The selection with the argument heading `args` added, and how many args it took.
function parsedArgumentOf(
  selection: SectionSelection,
  [arg, value]: string[],
): ParsedArgument | undefined {
  if (arg === undefined) return undefined;
  if (arg === "--outliers") {
    if (selection.limitsToOutliers === true) return undefined;
    return { selection: { ...selection, limitsToOutliers: true }, argCount: 1 };
  }
  if (arg === "--all" || !arg.startsWith("-")) {
    if (selection.scope !== undefined) return undefined;
    const scope = arg === "--all" ? { all: true as const } : { section: arg };
    return { selection: { ...selection, scope }, argCount: 1 };
  }
  if (value === undefined || value.startsWith("-")) return undefined;
  const flagged = flaggedSelectionOf(selection, arg, value);
  return flagged === undefined
    ? undefined
    : { selection: flagged, argCount: 2 };
}

function flaggedSelectionOf(
  selection: SectionSelection,
  flag: string,
  value: string,
): SectionSelection | undefined {
  const filterKey = filterKeyByFlag[flag];
  if (filterKey !== undefined) {
    if (selection[filterKey] !== undefined) return undefined;
    return { ...selection, [filterKey]: value };
  }
  if (flag === "--workflow") {
    if (selection.workflow !== undefined) return undefined;
    return isWorkflowName(value)
      ? { ...selection, workflow: value }
      : undefined;
  }
  if (flag === "--recent") {
    const count = Number(value);
    if (selection.scope !== undefined) return undefined;
    if (!Number.isInteger(count) || count <= 0) return undefined;
    return { ...selection, scope: { recent: count } };
  }
  if (flag === "--since") {
    const since = new Date(value);
    if (selection.since !== undefined) return undefined;
    if (Number.isNaN(since.getTime())) return undefined;
    return { ...selection, since };
  }
  return undefined;
}

// A primary root no landing has written a row in yet has no outcome folder.
function rowFiles(): OutcomeRowFile[] {
  if (!existsSync(outcomeFolder)) return [];
  return readdirSync(outcomeFolder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((section) =>
      readdirSync(join(outcomeFolder, section.name))
        .filter((name) => name.endsWith(".md"))
        .map((name) => {
          const path = `${section.name}/${name}`;
          return {
            path,
            text: readFileSync(join(outcomeFolder, path), "utf8"),
          };
        }),
    );
}

// The config folders a transcript may be under: the live one and each cswap account's backup.
function configFolders(): string[] {
  const home = homedir();
  const backups = join(home, ".claude-swap-backup", "sessions");
  const accounts = existsSync(backups)
    ? readdirSync(backups, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(backups, entry.name))
    : [];
  return [configFolderOf(process.env, home), ...accounts];
}

async function modelFitOf(issue: IssueRef): Promise<string> {
  try {
    return await issueReader.modelFitOf(issue);
  } catch (error) {
    return `not read: ${messageOf(error)}`;
  }
}
