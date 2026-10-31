// A one-off chore (#474): fills a spec's outcome rows' `unrecorded` transcript cells from the sessions its run state recorded.
// Usage: node scripts/runner/outcomeBackfill.ts <run state file> <spec's outcome folder> <config folder>...
import { backfillOutcomeRows } from "@byronbroughten/spec-runner/outcomeBackfill";

const [runStatePath, specFolder, ...configFolders] = process.argv.slice(2);
if (runStatePath === undefined || specFolder === undefined) {
  console.error(
    "Usage: node scripts/runner/outcomeBackfill.ts <run state file> <spec's outcome folder> <config folder>...",
  );
  process.exitCode = 1;
} else {
  backfillOutcomeRows({ runStatePath, specFolder, configFolders }).forEach(
    (path) => console.log(path),
  );
}
