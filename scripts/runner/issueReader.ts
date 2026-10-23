// The issue reader byro-repo's scripts share; the module is runner/src/IssueReader.ts.
import { GhCli } from "@byronbroughten/spec-runner/GhCli";
import { IssueReader } from "@byronbroughten/spec-runner/IssueReader";

import { developer, githubOwner, runKnobs } from "./runnerConfig.ts";

export const issueReader = IssueReader.init({
  source: new GhCli(githubOwner),
  developer,
  githubOwner,
  allowedRepos: Object.keys(runKnobs.clonePaths),
});
