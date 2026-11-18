// Prints a repo rule doc, or only its named `##` sections; the docs it knows are in ruleDocs.ts.
// Usage: npm run doc:sections -- <doc> [<section>...]
import { readFileSync } from "node:fs";

import { ruleDocs } from "./ruleDocs.ts";

try {
  console.log(
    ruleDocs.textOf(process.argv.slice(2), (path) =>
      readFileSync(path, "utf8"),
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
