// Prints an issue with each part labelled Trusted text or Untrusted text; the module is runner/src/IssueReader.ts.
// Usage: npm run issue:read -- <repo> <n> [--body] [--comments] [--hide-others]
import { GhCli } from "@byronbroughten/spec-runner/GhCli";
import { IssueReader } from "@byronbroughten/spec-runner/IssueReader";

import { githubOwner, runKnobs } from "./runnerConfig.ts";

const reader = IssueReader.init({
  source: new GhCli(githubOwner),
  owner: githubOwner,
  allowedRepos: Object.keys(runKnobs.clonePaths),
});

try {
  console.log(await reader.read(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
