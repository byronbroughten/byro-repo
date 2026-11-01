// Run by .githooks/commit-msg in the root or a package clone, with the message file's path: refuses a message that would close an issue.
import { readFileSync } from "node:fs";

import { closingPhrasesOf, refusalOf } from "./closingKeywords.ts";

// Git passes the path relative to the top of the committing repo's worktree, where it runs the hook.
const messageFile = process.argv[2];
if (messageFile === undefined) {
  throw new Error("commit-msg: git passed no commit message file.");
}
const [first, ...rest] = closingPhrasesOf(readFileSync(messageFile, "utf8"));
if (first !== undefined) {
  console.error(`\n${refusalOf([first, ...rest])}`);
  process.exitCode = 1;
}
