// Starts a one-turn headless session in a folder and prints what its hooks see, $CLAUDE_PROJECT_DIR first.
// Usage: npm run session:probe -- <folder>, e.g. an issue workspace's path from npm run issue:list.
import { resolve } from "node:path";

import { SessionProbe } from "@byronbroughten/spec-runner/SessionProbe";

try {
  const [folder] = process.argv.slice(2);
  if (folder === undefined) {
    throw new Error("Usage: npm run session:probe -- <folder>");
  }
  const cwd = resolve(folder);
  const reading = await SessionProbe.init().run(cwd);
  const verdict = reading.projectDir === cwd ? "matches" : "differs from";
  console.log(
    `CLAUDE_PROJECT_DIR ${reading.projectDir} ${verdict} the folder.`,
  );
  console.log(JSON.stringify(reading, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
