// `npm run google:script -- <file> [args…]`: runs the named script with Node, outside the sandbox, holding a freshly minted access token for the agent account in `GOOGLE_ACCESS_TOKEN`; the token, the env rules and the tier row: scriptEnv.ts, AgentTokenMinter.ts, docs/targets-and-gates.md.
// npm runs a script from the root's folder, so a relative path is read from the folder npm was called from, INIT_CWD.
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { resolve } from "node:path";

import { AgentTokenMinter } from "../../.claude/hooks/lib/AgentTokenMinter.ts";
import { scriptEnvOf } from "./scriptEnv.ts";

const usage = "Usage: npm run google:script -- <file> [args…]";

try {
  const [file, ...args] = process.argv.slice(2);
  if (file === undefined) throw new Error(usage);
  const path = resolve(process.env.INIT_CWD ?? process.cwd(), file);
  if (!statSync(path, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`No script file at ${path}. ${usage}`);
  }
  const accessToken = await AgentTokenMinter.init().minted();
  const run = spawnSync(process.execPath, [path, ...args], {
    stdio: "inherit",
    env: scriptEnvOf(process.env, accessToken),
  });
  if (run.error) throw run.error;
  process.exitCode = run.status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
