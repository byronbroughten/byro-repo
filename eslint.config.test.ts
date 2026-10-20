import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

import { packagesImportRegex, workspaceNames } from "./eslint.config.mjs";

const repoRoot = fileURLToPath(new URL(".", import.meta.url));

async function ruleMessages(
  code: string,
  filePath: string,
  ruleId: string,
): Promise<string[]> {
  const [result] = await new ESLint({ cwd: repoRoot }).lintText(code, {
    filePath,
  });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === ruleId)
    .map((message) => message.message);
}

function fakeWorkspaceRoot(
  workspaces: string[],
  packages: { folder: string; name: string }[],
): string {
  const root = mkdtempSync(join(tmpdir(), "workspace-names-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces }));
  packages.forEach(({ folder, name }) => {
    mkdirSync(join(root, folder), { recursive: true });
    writeFileSync(join(root, folder, "package.json"), JSON.stringify({ name }));
  });
  return root;
}

async function boundaryErrors(
  code: string,
  filePath: string,
): Promise<string[]> {
  return ruleMessages(code, filePath, "runner/import-boundary");
}

describe("the runner's import boundary", () => {
  it("rejects a relative import that leaves the runner", async () => {
    const code =
      'import { x } from "../../.claude/hooks/lib/hookIo.ts";\nexport { x };\n';
    expect(await boundaryErrors(code, "runner/src/step.ts")).toHaveLength(1);
  });

  it("rejects another workspace package by name", async () => {
    const code =
      'export { eslintPreset } from "@byronbroughten/config/eslint";\n';
    expect(await boundaryErrors(code, "runner/src/step.ts")).toHaveLength(1);
  });

  it("finds workspace names under packages/*", () => {
    const root = fakeWorkspaceRoot(
      ["packages/*"],
      [{ folder: "packages/fake", name: "@example/fake" }],
    );
    expect(workspaceNames(root)).toEqual(["@example/fake"]);
  });

  it("rejects a dynamic import out of the runner", async () => {
    const code =
      'export const loaded = await import("../../scripts/jev/jev.ts");\n';
    expect(await boundaryErrors(code, "runner/src/step.ts")).toHaveLength(1);
  });

  it("allows imports inside the runner, from its own name and from node or npm", async () => {
    const code = [
      'import { readFileSync } from "node:fs";',
      'import { describe } from "vitest";',
      'import { ContextMeter } from "@byronbroughten/spec-runner/contextMeter";',
      'import { y } from "../meter/y.ts";',
      "export { ContextMeter, describe, readFileSync, y };",
      "",
    ].join("\n");
    expect(await boundaryErrors(code, "runner/src/steps/step.ts")).toEqual([]);
  });

  it("leaves code outside the runner alone", async () => {
    const code =
      'import { x } from "../packages/framework/src/x.ts";\nexport { x };\n';
    expect(await boundaryErrors(code, "scripts/x.ts")).toEqual([]);
  });
});

describe("the private-helper rule", () => {
  async function helperErrors(code: string): Promise<string[]> {
    return ruleMessages(
      code,
      "scripts/helper.ts",
      "style/private-helper-uses-this",
    );
  }

  it("flags a `private` or `#` method that never reads `this`", async () => {
    const code = `export class Box {
  open(): number {
    return this._twice(1) + this.#thrice(1);
  }
  private _twice(n: number): number {
    return n * 2;
  }
  #thrice(n: number): number {
    return n * 3;
  }
}
`;
    expect(await helperErrors(code)).toHaveLength(2);
  });

  it("passes a helper that reads `this` from an arrow, and a protected or public method", async () => {
    const code = `class Base {
  protected _size(): number {
    return 0;
  }
}
export class Box extends Base {
  readonly items: number[] = [];
  open(): number {
    return this._sum() + this._size();
  }
  private _sum(): number {
    return this.items.reduce((total, item) => total + item + this.items.length, 0);
  }
  protected override _size(): number {
    return 1;
  }
}
`;
    expect(await helperErrors(code)).toEqual([]);
  });
});

describe("the packages/ import rule", () => {
  async function packagesErrors(code: string): Promise<string[]> {
    return ruleMessages(code, ".claude/hooks/hook.ts", "no-restricted-imports");
  }

  it("passes the runner and config by name", async () => {
    const code = [
      'import { ContextMeter } from "@byronbroughten/spec-runner/contextMeter";',
      'import { eslintPreset } from "@byronbroughten/config/eslint";',
      "export { ContextMeter, eslintPreset };",
      "",
    ].join("\n");
    expect(await packagesErrors(code)).toEqual([]);
  });

  it("rejects a relative import into packages/", async () => {
    const code =
      'import { x } from "../../packages/framework/src/x.ts";\nexport { x };\n';
    expect(await packagesErrors(code)).toHaveLength(1);
  });

  it("finds only the names under packages/", () => {
    const root = fakeWorkspaceRoot(
      ["config", "packages/*"],
      [
        { folder: "config", name: "@example/config" },
        { folder: "packages/fake", name: "@example/fake" },
      ],
    );
    expect(workspaceNames(root, "packages/")).toEqual(["@example/fake"]);
  });

  it("rejects a given name and its subpath, but not a longer name", () => {
    const regex = new RegExp(packagesImportRegex(["@example/fake.js"]));
    expect(regex.test("@example/fake.js")).toBe(true);
    expect(regex.test("@example/fake.js/sub")).toBe(true);
    expect(regex.test("@example/fake.jsx")).toBe(false);
    expect(regex.test("@example/fakexjs")).toBe(false);
  });

  it("keeps only the path pattern with no names", () => {
    const regex = new RegExp(packagesImportRegex([]));
    expect(regex.test("@byronbroughten/spec-runner")).toBe(false);
    expect(regex.test("packages/x")).toBe(true);
  });
});
