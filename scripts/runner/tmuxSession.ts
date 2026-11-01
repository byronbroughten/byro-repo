// Prints a run's tmux session name, so tmux.sh names a Batch's session as the watch's attach lines do.
// Usage: node scripts/runner/tmuxSession.ts <owner/repo> <n> [<n>…]; exits 2, printing nothing, on any other form.
import { launchArgsOf, tmuxSessionOf } from "./launchArgs.ts";

const launch = launchArgsOf(process.argv.slice(2));
if (launch === undefined) {
  process.exitCode = 2;
} else {
  console.log(tmuxSessionOf(launch.members));
}
