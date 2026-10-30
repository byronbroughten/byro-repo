// Prints one TypeScript file's outline, its declarations and signatures without bodies, so its structure can be judged unread.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { fileOutline } from "./fileOutline.ts";

const usage = "usage: npm run outline -- <file.ts>";

try {
  const { positionals } = parseArgs({ allowPositionals: true });
  const [file] = positionals;
  if (!file || positionals.length > 1) throw new Error(usage);
  console.log(fileOutline(file, readFileSync(file, "utf8")));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
