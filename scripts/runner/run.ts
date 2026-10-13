// Runs a spec's tickets to landed, one at a time; rerunning the same command resumes. Progress is in .runner/<repo>-<n>.log.
// Usage: npm run runner -- <owner/repo> <n>.
import { SpecRun } from "@byronbroughten/spec-runner/SpecRun";

import { specRunConfigOf } from "./runnerConfig.ts";

try {
  const [ownerRepo = "", number] = process.argv.slice(2);
  const [owner, repo] = ownerRepo.split("/");
  if (!owner || !repo || !Number.isInteger(Number(number))) {
    throw new Error("Usage: npm run runner -- <owner/repo> <n>");
  }
  const result = await SpecRun.init(specRunConfigOf(owner)).run({
    repo,
    number: Number(number),
  });
  console.log(result.message);
  if (result.kind !== "finished") process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
