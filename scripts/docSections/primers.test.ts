import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  docSectionsArgsOf,
  docsInjectedBy,
} from "../../.claude/hooks/lib/docSectionsInjections.ts";
import {
  readFirstRows,
  tierTablePath,
} from "../../.claude/hooks/lib/readFirstGate.ts";
import { ruleDocs } from "./ruleDocs.ts";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const primerNames = ["file-issue", "code-style", "prose-style", "writing"];

function skillTextOf(name: string): string {
  return readFileSync(
    join(repoRoot, ".claude", "skills", name, "SKILL.md"),
    "utf8",
  );
}

describe("the Primers", () => {
  it.each(primerNames)("%s prints every section it names", (name) => {
    const injections = docSectionsArgsOf(skillTextOf(name));
    expect(injections).not.toHaveLength(0);
    for (const args of injections) {
      expect(() =>
        ruleDocs.textOf(args, (path) =>
          readFileSync(join(repoRoot, path), "utf8"),
        ),
      ).not.toThrow();
    }
  });

  it.each(primerNames)("%s is model-invocable", (name) => {
    expect(skillTextOf(name)).not.toMatch(/^disable-model-invocation: true$/m);
  });

  it("each read-first row but the tier table's has a Primer printing all its docs", () => {
    const injectedDocs = primerNames.map((name) =>
      docsInjectedBy(skillTextOf(name)),
    );
    const rowsWithoutPrimer = readFirstRows
      .map((row) => row.docs.map((doc) => doc.path))
      .filter(
        (paths) =>
          !injectedDocs.some((docs) =>
            paths.every((path) => docs.includes(path)),
          ),
      );
    expect(rowsWithoutPrimer).toEqual([[tierTablePath]]);
  });
});
