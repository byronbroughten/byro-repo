// The active cswap account's number, which a recorded session's transcripts are read under.
import { execFileSync } from "node:child_process";

export function activeAccount(): number | undefined {
  return activeAccountOf(cswapStatus());
}

export function activeAccountOf(cswapStatus: string): number | undefined {
  try {
    const number = JSON.parse(cswapStatus)?.active?.number;
    return typeof number === "number" ? number : undefined;
  } catch {
    return undefined;
  }
}

// Empty when cswap is missing or fails, which leaves the account unknown.
function cswapStatus(): string {
  try {
    return execFileSync("cswap", ["status", "--json"], { encoding: "utf8" });
  } catch {
    return "";
  }
}
