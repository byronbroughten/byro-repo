// Prints an issue with each part labelled Trusted text or Untrusted text; the module is runner/src/IssueReader.ts.
// Usage: npm run issue:read -- <repo> <n> [--body] [--comments] [--hide-others]
import { issueReader } from "./issueReader.ts";

try {
  console.log(await issueReader.read(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
