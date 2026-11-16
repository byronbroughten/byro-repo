// Prints each repo in the repo map with its path from the primary root and whether it is private, read from GitHub
// and cached for a day under .runner/.
// Usage: npm run repos [-- --refresh]
import { GhCli } from "@byronbroughten/spec-runner/GhCli";
import {
  type RepoRow,
  repoRowsText,
  RepoVisibility,
} from "@byronbroughten/spec-runner/RepoVisibility";

import { githubOwner, runKnobs, stateFolder } from "./runnerConfig.ts";

const args = process.argv.slice(2);
try {
  if (args.length > 1 || (args.length === 1 && args[0] !== "--refresh")) {
    throw new Error("Usage: npm run repos [-- --refresh]");
  }
  const visibility = RepoVisibility.init({
    stateFolder,
    source: new GhCli(githubOwner),
    clock: { now: () => new Date() },
  });
  let rows: RepoRow[];
  if (args[0] === "--refresh") {
    rows = await visibility.refreshedRowsOf(runKnobs.clonePaths);
  } else {
    rows = await visibility.rowsOf(runKnobs.clonePaths);
  }
  console.log(repoRowsText(rows));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
