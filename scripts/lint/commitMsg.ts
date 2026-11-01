// Run by .githooks/commit-msg in the root or a package clone, with the message file's path: refuses a message that would close an issue.
import { readFileSync } from "node:fs";

import { closingPhrasesOf, refusalOf } from "./closingKeywords.ts";

// Git passes the path relative to the top of the committing repo's worktree, where it runs the hook.
const phrases = closingPhrasesOf(readFileSync(process.argv[2], "utf8"));
if (phrases.length > 0) {
  console.error(`\n${refusalOf(phrases)}`);
  process.exitCode = 1;
}
