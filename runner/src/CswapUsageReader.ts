import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  readCswapList,
  type UsageList,
  type UsageReader,
} from "./limitGuard.ts";

const execFileAsync = promisify(execFile);

// Reads every account's usage and the active account from `cswap list --json`; a failed command throws, which SpecRun.ts treats as a missing reading.
export class CswapUsageReader implements UsageReader {
  private readonly cswapPath: string;

  constructor(cswapPath: string) {
    this.cswapPath = cswapPath;
  }

  static init(cswapPath = "cswap"): CswapUsageReader {
    return new CswapUsageReader(cswapPath);
  }

  async read(): Promise<UsageList> {
    const { stdout } = await execFileAsync(this.cswapPath, ["list", "--json"]);
    return readCswapList(stdout);
  }
}
