// `npm run outcome:summary -- <spec section | --recent <N> | --all>`: the report `/mine-outcomes` reads in place of the outcome rows.
// The core is runner/src/outcomeSummary.ts; this gathers the row files, the commit each landed in, the transcripts on disk and each ticket's Model fit.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { messageOf } from "@byronbroughten/spec-runner/failureText";
import type { IssueRef } from "@byronbroughten/spec-runner/IssueWorkspaces";
import {
  type OutcomeRowFile,
  outcomeSummaryOf,
  type SectionSelection,
} from "@byronbroughten/spec-runner/outcomeSummary";

import { issueReader } from "./issueReader.ts";
import { runKnobs } from "./runnerConfig.ts";

const usage =
  "Usage: npm run outcome:summary -- <spec section, such as byro-repo-480> | --recent <N> | --all";
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const outcomeFolder = join("docs", "agents", "outcomes");

const selection = selectionOf(process.argv.slice(2));
if (selection === undefined) {
  console.error(usage);
  process.exitCode = 1;
} else {
  const transcripts = transcriptIds();
  process.stdout.write(
    await outcomeSummaryOf({
      rowFiles: rowFiles(),
      selection,
      ticketBudget: runKnobs.ticketBudget,
      modelFitOf,
      hasTranscript: (sessionId) => transcripts.has(sessionId),
    }),
  );
}

function selectionOf(args: string[]): SectionSelection | undefined {
  const [first, second, ...rest] = args;
  if (first === undefined || rest.length > 0) return undefined;
  if (first === "--all") {
    return second === undefined ? { all: true } : undefined;
  }
  if (first === "--recent") {
    const count = Number(second);
    return Number.isInteger(count) && count > 0 ? { recent: count } : undefined;
  }
  if (first.startsWith("-") || second !== undefined) return undefined;
  return { section: first };
}

// A file not yet committed counts as landing now.
function rowFiles(): OutcomeRowFile[] {
  const landings = landingDates();
  const folder = join(repoRoot, outcomeFolder);
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((section) =>
      readdirSync(join(folder, section.name))
        .filter((name) => name.endsWith(".md"))
        .map((name) => {
          const path = `${section.name}/${name}`;
          return {
            path,
            text: readFileSync(join(folder, path), "utf8"),
            landedAt: landings.get(path) ?? new Date(),
          };
        }),
    );
}

// Each row file's adding commit date, keyed by its path under the outcome folder; a later rewrite such as a backfill doesn't move it.
function landingDates(): Map<string, Date> {
  const log = execFileSync(
    "git",
    [
      "log",
      "--diff-filter=A",
      "--format=%x00%cI",
      "--name-only",
      "--",
      outcomeFolder,
    ],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const prefix = `${outcomeFolder}/`;
  const landings = new Map<string, Date>();
  let landedAt = new Date();
  log.split("\n").forEach((line) => {
    if (line.startsWith("\0")) landedAt = new Date(line.slice(1));
    else if (line.startsWith(prefix)) {
      const path = line.slice(prefix.length);
      if (!landings.has(path)) landings.set(path, landedAt);
    }
  });
  return landings;
}

// The session ids with a transcript in any config folder: the live one and each cswap account's backup.
function transcriptIds(): Set<string> {
  const home = homedir();
  const backups = join(home, ".claude-swap-backup", "sessions");
  const configFolders = [
    join(home, ".claude"),
    ...subfoldersOf(backups).map((account) => join(backups, account)),
  ];
  return new Set(
    configFolders.flatMap((configFolder) => {
      const projects = join(configFolder, "projects");
      return subfoldersOf(projects).flatMap((project) =>
        readdirSync(join(projects, project))
          .filter((name) => name.endsWith(".jsonl"))
          .map((name) => name.slice(0, -".jsonl".length)),
      );
    }),
  );
}

function subfoldersOf(folder: string): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

async function modelFitOf(issue: IssueRef): Promise<string> {
  try {
    return await issueReader.modelFitOf(issue);
  } catch (error) {
    return `not read: ${messageOf(error)}`;
  }
}
