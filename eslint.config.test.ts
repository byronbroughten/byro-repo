import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL(".", import.meta.url));

async function boundaryErrors(
  code: string,
  filePath: string,
): Promise<string[]> {
  const [result] = await new ESLint({ cwd: repoRoot }).lintText(code, {
    filePath,
  });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === "runner/import-boundary")
    .map((message) => message.message);
}

describe("the runner's import boundary", () => {
  it("rejects a relative import that leaves the runner", async () => {
    const code =
      'import { x } from "../../.claude/hooks/lib/hookIo.ts";\nexport { x };\n';
    expect(await boundaryErrors(code, "runner/src/step.ts")).toHaveLength(1);
  });

  it("rejects another workspace package by name", async () => {
    const framework =
      'import { x } from "@byronbroughten/sheets-framework";\nexport { x };\n';
    const config =
      'export { eslintPreset } from "@byronbroughten/config/eslint";\n';
    expect(await boundaryErrors(framework, "runner/src/step.ts")).toHaveLength(
      1,
    );
    expect(await boundaryErrors(config, "runner/src/step.ts")).toHaveLength(1);
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
