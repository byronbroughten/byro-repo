// Prints a `/wayfinder` session's brief of a wayfinder map, read-only; the module is runner/src/MapNext.ts.
// Usage: npm run map:next -- (<repo> <map> | <owner>/<repo> <map> | <map-url> | <map>) [<ticket> | <ticket-url>]
// A brief exits 0 on every outcome, wording its own refusals, so a skill can inject it.
import { cloneRepoOf } from "@byronbroughten/spec-runner/clonePaths";
import { messageOf } from "@byronbroughten/spec-runner/failureText";
import { GhCli } from "@byronbroughten/spec-runner/GhCli";
import { MapNext, noBriefOf } from "@byronbroughten/spec-runner/MapNext";

import { developer, githubOwner, runKnobs } from "./runnerConfig.ts";

const mapNext = MapNext.init({
  source: new GhCli(githubOwner),
  developer,
  githubOwner,
  allowedRepos: Object.keys(runKnobs.clonePaths),
});

try {
  console.log(
    await mapNext.brief(process.argv.slice(2), currentRepoOf(process.cwd())),
  );
} catch (error) {
  console.log(noBriefOf(messageOf(error)));
}

// A checkout with no origin remote names no repo, as a folder outside any checkout doesn't.
function currentRepoOf(folder: string): string | undefined {
  try {
    return cloneRepoOf(folder);
  } catch {
    return undefined;
  }
}
