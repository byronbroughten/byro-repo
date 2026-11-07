// A fake file system for the tier tests, laid out like macOS: a workspace at /ws, $TMPDIR at /var/T, /tmp linked to /private/tmp, and a few links out of the workspace.
import { dirname, join } from "node:path";

import type { ShellPlaces } from "./stepWrites.ts";

const existing = new Set([
  "/ws",
  "/ws/AGENTS.md",
  "/ws/run.command",
  "/ws/dist",
  "/ws/.git",
  "/ws/packages",
  "/ws/packages/framework",
  "/ws/packages/framework/.git",
  "/ws/packages/framework/src",
  "/var",
  "/var/T",
  "/var/T/helper.mjs",
  "/private",
  "/private/tmp",
  "/private/tmp/helper.mjs",
  "/outside",
  "/outside/x",
  "/outside/deep",
]);
const links = new Map([
  ["/ws/escape", "/outside"],
  ["/ws/linkdir", "/outside/deep"],
  ["/ws/dangling", "/nowhere"],
  ["/tmp", "/private/tmp"],
]);
const files = new Set([
  "/ws/AGENTS.md",
  "/ws/run.command",
  "/var/T/helper.mjs",
  "/private/tmp/helper.mjs",
  "/outside/x",
]);

export function fakePlaces(cwd = "/ws"): ShellPlaces {
  return {
    workspaceRoot: "/ws",
    tmpDir: "/var/T",
    cwd,
    realPathOf: fakeRealPathOf,
    isLink: (path) => links.has(path),
    isFile: (path) => files.has(fakeRealPathOf(path) ?? ""),
  };
}

function fakeRealPathOf(path: string): string | undefined {
  let current = "/";
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      current = dirname(current);
      continue;
    }
    const next = join(current, part);
    const target = links.get(next);
    if (target !== undefined) {
      const real = fakeRealPathOf(target);
      if (real === undefined) return undefined;
      current = real;
    } else if (existing.has(next)) current = next;
    else return undefined;
  }
  return current;
}
