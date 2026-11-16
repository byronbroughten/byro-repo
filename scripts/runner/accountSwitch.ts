// `npm run account:switch`: switches the Active account to the best free one, in place of `cswap auto`.
// The core is runner/src/accountSwitch.ts; this entry passes it the real cswap and the primary's account leases.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { AccountLease } from "@byronbroughten/spec-runner/AccountLease";
import { accountSwitch } from "@byronbroughten/spec-runner/accountSwitch";
import { CswapUsageReader } from "@byronbroughten/spec-runner/CswapUsageReader";
import { messageOf } from "@byronbroughten/spec-runner/failureText";

import { runKnobs, stateFolder } from "./runnerConfig.ts";

const execFileAsync = promisify(execFile);

try {
  await accountSwitch.run({
    usageReader: CswapUsageReader.init(),
    leaseReader: AccountLease.readerOf(stateFolder),
    switchPort: {
      async switchTo(account) {
        await execFileAsync("cswap", ["switch", String(account)]);
      },
    },
    knobs: runKnobs,
    print: (line) => console.log(line),
  });
} catch (error) {
  console.error(messageOf(error));
  process.exitCode = 1;
}
