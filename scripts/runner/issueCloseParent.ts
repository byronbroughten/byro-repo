// Prints a Close-out's brief of a parent and, with --comment-file, closes it; the module is runner/src/CloseOutBrief.ts.
// Usage: npm run issue:close-parent -- <repo> <p> [--comment-file <path>]
// A brief exits 0 on every outcome, wording its own refusals, so a skill can inject it.
import {
  CloseOutBrief,
  noBriefOf,
} from "@byronbroughten/spec-runner/CloseOutBrief";
import { messageOf } from "@byronbroughten/spec-runner/failureText";
import { GhCli } from "@byronbroughten/spec-runner/GhCli";

import { developer, githubOwner, runKnobs } from "./runnerConfig.ts";

const closeOut = CloseOutBrief.init({
  github: new GhCli(githubOwner),
  developer,
  githubOwner,
  allowedRepos: Object.keys(runKnobs.clonePaths),
});

try {
  console.log(await closeOut.brief(process.argv.slice(2)));
} catch (error) {
  console.log(noBriefOf(messageOf(error)));
}
