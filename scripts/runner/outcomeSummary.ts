// `npm run outcome:summary`: the outcome log's rows a planning session asks for, by spec section, with their outliers.
// The core is runner/src/outcomeSummary.ts; this gathers the row files from the primary root's outcome folder, the transcripts on disk and each ticket's Model fit.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { messageOf } from "@byronbroughten/spec-runner/failureText";
import type { IssueRef } from "@byronbroughten/spec-runner/IssueWorkspaces";
import {
  defaultRowCount,
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

const filterKeyByFlag: Record<string, "workflow" | "pair" | "repo" | "spec"> = {
  "--workflow": "workflow",
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

// Undefined for arguments the usage line doesn't allow, a flag given twice or two scopes among them.
function selectionOf(args: string[]): SectionSelection | undefined {
  const selection: SectionSelection = {};
  const rest = [...args];
  for (let arg = rest.shift(); arg !== undefined; arg = rest.shift()) {
    const isSet = withArgument(selection, arg, rest);
    if (!isSet) return undefined;
  }
  return selection;
}

// Sets one argument, and the value a flag takes from `rest`, on the selection; false when it can't.
function withArgument(
  selection: SectionSelection,
  arg: string,
  rest: string[],
): boolean {
  if (arg === "--outliers") {
    if (selection.limitsToOutliers === true) return false;
    selection.limitsToOutliers = true;
    return true;
  }
  if (arg === "--all" || !arg.startsWith("-")) {
    if (selection.scope !== undefined) return false;
    selection.scope = arg === "--all" ? { all: true } : { section: arg };
    return true;
  }
  const value = rest.shift();
  if (value === undefined || value.startsWith("-")) return false;
  const filterKey = filterKeyByFlag[arg];
  if (filterKey !== undefined) {
    if (selection[filterKey] !== undefined) return false;
    selection[filterKey] = value;
    return true;
  }
  if (arg === "--recent") {
    const count = Number(value);
    if (selection.scope !== undefined) return false;
    if (!Number.isInteger(count) || count <= 0) return false;
    selection.scope = { recent: count };
    return true;
  }
  if (arg === "--since") {
    const since = new Date(value);
    if (selection.since !== undefined) return false;
    if (Number.isNaN(since.getTime())) return false;
    selection.since = since;
    return true;
  }
  return false;
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
