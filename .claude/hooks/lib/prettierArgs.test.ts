import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prettierWriteArgsOf } from "./prettierArgs.ts";

const prettier = join(
  import.meta.dirname,
  "../../../node_modules/.bin/prettier",
);
const unformatted = "export const   probe = {a:1}\n";
let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "prettier-args-")));
  writeFileSync(join(root, ".gitignore"), "packages/*\n");
  writeFileSync(join(root, ".prettierignore"), "*.md\n");
  mkdirSync(join(root, "packages", "utils"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function formatted(relativePath: string): string {
  const path = join(root, relativePath);
  writeFileSync(path, unformatted);
  spawnSync(prettier, prettierWriteArgsOf(root, ["--ignore-unknown", path]), {
    cwd: root,
  });
  return readFileSync(path, "utf8");
}

describe("prettierWriteArgsOf", () => {
  it("formats a clone's file that the root's .gitignore lists", () => {
    expect(formatted("packages/utils/probe.ts")).toBe(
      "export const probe = { a: 1 };\n",
    );
  });

  it("still skips a file .prettierignore lists", () => {
    expect(formatted("notes.md")).toBe(unformatted);
  });
});
