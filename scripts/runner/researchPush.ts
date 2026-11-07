// Pushes the current Workspace checkout's `research/*` branch to origin, setting its upstream, behind wrap-up's secret
// scan; it refuses any other branch, a primary checkout and a scan hit. npm runs a script from the root's folder, so the
// checkout is the folder npm was called from, INIT_CWD.
import { WrapUp } from "@byronbroughten/spec-runner/WrapUp";
import { WrapUpFailure } from "@byronbroughten/spec-runner/WrapUpFailure";

import { wrapUpConfig } from "./runnerConfig.ts";

try {
  if (process.argv.length > 2) {
    throw new Error("Usage: npm run research:push");
  }
  const checkout = process.env.INIT_CWD ?? process.cwd();
  const branch = await WrapUp.init(wrapUpConfig).pushResearch(checkout);
  console.log(`Pushed ${branch} to origin.`);
} catch (error) {
  if (error instanceof WrapUpFailure) {
    console.error(`Research push failed (${error.kind}): ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
}
