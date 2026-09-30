import { describe, expect, it } from "vitest";

import { checkDocs, type Docs, type Violation } from "./docLint.js";

function nested(lines: number): string {
  const rules = Array.from({ length: lines }, (_, i) => `- rule ${i}`);
  return `${rules.join("\n")}\n`;
}
const baseDocs = {
  "AGENTS.md": "# Root\n",
  "CLAUDE.md": "@AGENTS.md\n",
};
function check(
  docs: Docs,
  paths: string[] = [],
  published?: string | string[],
): Violation[] {
  return checkDocs({
    docs: { ...baseDocs, ...docs },
    paths,
    published: typeof published === "string" ? [published] : published,
  });
}
function messages(
  docs: Docs,
  paths?: string[],
  published?: string | string[],
): string[] {
  return check(docs, paths, published).map(
    (each) => `${each.path}: ${each.message}`,
  );
}

describe("checkDocs", () => {
  it("passes a clean tree", () => {
    expect(check({})).toEqual([]);
  });

  describe("links", () => {
    it("passes a relative link to an existing doc or path", () => {
      const docs = {
        "docs/a.md": "[b](./b.md) and [src](../src/x.ts) and [dir](./sub/)\n",
        "docs/b.md": "# B\n",
      };
      expect(check(docs, ["src/x.ts", "docs/sub"])).toEqual([]);
    });

    it("fails a relative link to a missing file", () => {
      expect(messages({ "docs/a.md": "See [gone](./gone.md).\n" })).toEqual([
        "docs/a.md: broken link ./gone.md: no file docs/gone.md",
      ]);
    });

    it("reports the line of a broken link", () => {
      const [violation] = check({
        "docs/a.md": "# A\n\ntext\n[gone](./gone.md)\n",
      });
      expect(violation?.line).toBe(4);
    });

    it("resolves an anchor against a GitHub-style heading slug", () => {
      const docs = {
        "docs/a.md":
          "[ok](./b.md#the-gsheets-mcp-tools--more) [same](#top-level)\n# Top level\n",
        "docs/b.md": "### The `gsheets` MCP tools & more\n",
      };
      expect(check(docs)).toEqual([]);
    });

    it("fails an anchor that matches no heading", () => {
      const docs = {
        "docs/a.md": "[x](./b.md#nope)\n",
        "docs/b.md": "# Yes\n",
      };
      expect(messages(docs)).toEqual([
        "docs/a.md: broken anchor ./b.md#nope: no heading slugs to nope in docs/b.md",
      ]);
    });

    it("numbers repeated headings as GitHub does", () => {
      const docs = { "docs/a.md": "# Same\n# Same\n[x](#same-1)\n" };
      expect(check(docs)).toEqual([]);
    });

    it("ignores external links and links inside code", () => {
      const docs = {
        "docs/a.md":
          "[w](https://x.y/z) `[c](./c.md)`\n```\n[d](./d.md)\n```\n",
      };
      expect(check(docs)).toEqual([]);
    });

    it("checks README's links", () => {
      expect(messages({ "README.md": "[gone](./gone.md)\n" })).toEqual([
        "README.md: broken link ./gone.md: no file gone.md",
      ]);
    });

    it("fails a link to the old root STYLE.md once it lives at docs/code-style.md", () => {
      const docs = {
        "docs/a.md": "[style](../STYLE.md)\n",
        "docs/code-style.md": "# Style\n",
      };
      expect(messages(docs)).toEqual([
        "docs/a.md: broken link ../STYLE.md: no file STYLE.md",
      ]);
    });

    it("checks a package's docs, CONTEXT.md and README.md", () => {
      expect(
        messages({
          "packages/app/docs/a.md": "[gone](./gone.md)\n",
          "packages/app/CONTEXT.md": "[gone](./gone.md)\n",
          "packages/app/README.md": "[gone](./gone.md)\n",
        }),
      ).toEqual([
        "packages/app/docs/a.md: broken link ./gone.md: no file packages/app/docs/gone.md",
        "packages/app/CONTEXT.md: broken link ./gone.md: no file packages/app/gone.md",
        "packages/app/README.md: broken link ./gone.md: no file packages/app/gone.md",
      ]);
    });

    it("checks the config workspace's docs and README.md", () => {
      expect(
        messages({
          "config/docs/a.md": "[gone](./gone.md)\n",
          "config/README.md": "[gone](./gone.md)\n",
        }),
      ).toEqual([
        "config/docs/a.md: broken link ./gone.md: no file config/docs/gone.md",
        "config/README.md: broken link ./gone.md: no file config/gone.md",
      ]);
    });

    it("leaves unlisted docs such as skills unchecked", () => {
      expect(
        check({ ".claude/skills/x/SKILL.md": "[gone](./gone.md)\n" }),
      ).toEqual([]);
    });
  });

  describe("untracked packages", () => {
    const paths = ["packages/app/src/x.ts"];

    it("treats a link into a packages/<name>/ path the repo doesn't track as external", () => {
      const docs = {
        "AGENTS.md":
          "[fw](./packages/framework/src/x.ts) [dir](./packages/framework/) [doc](./packages/framework/docs/a.md#nope)\n",
      };
      expect(check(docs, paths)).toEqual([]);
    });

    it("still checks a link into a tracked package", () => {
      const docs = { "AGENTS.md": "[gone](./packages/app/src/gone.ts)\n" };
      expect(messages(docs, paths)).toEqual([
        "AGENTS.md: broken link ./packages/app/src/gone.ts: no file packages/app/src/gone.ts",
      ]);
    });

    it("counts a package as tracked when only its docs are", () => {
      const docs = {
        "AGENTS.md": "[gone](./packages/app/docs/gone.md)\n",
        "packages/app/docs/a.md": "# A\n",
      };
      expect(messages(docs)).toEqual([
        "AGENTS.md: broken link ./packages/app/docs/gone.md: no file packages/app/docs/gone.md",
      ]);
    });

    it("checks a link outside packages/ whatever is tracked", () => {
      expect(
        messages({ "AGENTS.md": "[gone](./src/gone.ts)\n" }, paths),
      ).toEqual(["AGENTS.md: broken link ./src/gone.ts: no file src/gone.ts"]);
    });
  });

  describe("link direction", () => {
    const paths = [
      "docs/code-style.md",
      "packages/framework/src/x.ts",
      "packages/real-estate/src/y.ts",
    ];
    const published = "packages/framework";

    it("fails a published framework doc linking outside the framework", () => {
      expect(
        messages(
          {
            "packages/framework/docs/a.md": "[style](../../../docs/code-style.md)\n",
            "packages/framework/CONTEXT.md":
              "[app](../real-estate/src/y.ts) [root](/docs/code-style.md)\n",
            "packages/framework/README.md": "[root](../../AGENTS.md)\n",
            "packages/framework/docs/sub/c.md":
              "[style](../../../../docs/code-style.md)\n",
          },
          paths,
          published,
        ),
      ).toEqual([
        "packages/framework/docs/a.md: link ../../../docs/code-style.md leaves packages/framework; its published docs link only inside packages/framework",
        "packages/framework/CONTEXT.md: link ../real-estate/src/y.ts leaves packages/framework; its published docs link only inside packages/framework",
        "packages/framework/CONTEXT.md: link /docs/code-style.md leaves packages/framework; its published docs link only inside packages/framework",
        "packages/framework/README.md: link ../../AGENTS.md leaves packages/framework; its published docs link only inside packages/framework",
        "packages/framework/docs/sub/c.md: link ../../../../docs/code-style.md leaves packages/framework; its published docs link only inside packages/framework",
      ]);
    });

    it("passes a published framework doc linking inside the framework", () => {
      const docs = {
        "packages/framework/docs/a.md":
          "[src](../src/x.ts) [b](./b.md#b) [readme](../README.md)\n",
        "packages/framework/docs/b.md": "# B\n",
        "packages/framework/README.md":
          "[a](./docs/a.md) [abs](/packages/framework/src/x.ts)\n",
      };
      expect(check(docs, paths, published)).toEqual([]);
    });

    it("fails a published framework's AGENTS.md and CLAUDE.md linking outside it", () => {
      const docs = {
        "packages/framework/CLAUDE.md": "[root](../../docs/code-style.md)\n",
        "packages/framework/src/AGENTS.md": "[root](../../../docs/code-style.md)\n",
        "packages/framework/src/CLAUDE.md": "@AGENTS.md\n",
      };
      expect(messages(docs, paths, published)).toEqual([
        "packages/framework/CLAUDE.md: link ../../docs/code-style.md leaves packages/framework; its published docs link only inside packages/framework",
        "packages/framework/src/AGENTS.md: link ../../../docs/code-style.md leaves packages/framework; its published docs link only inside packages/framework",
      ]);
    });

    it("passes a published framework's AGENTS.md and CLAUDE.md linking inside it", () => {
      const docs = {
        "packages/framework/CLAUDE.md": "@AGENTS.md\n",
        "packages/framework/src/AGENTS.md": "[x](./x.ts) [b](../docs/b.md)\n",
        "packages/framework/src/CLAUDE.md": "@AGENTS.md\n",
        "packages/framework/docs/b.md": "# B\n",
      };
      expect(check(docs, paths, published)).toEqual([]);
    });

    it("lets the app's docs link into the framework and root", () => {
      const docs = {
        "packages/real-estate/docs/a.md":
          "[fw](../../framework/src/x.ts) [root](../../../docs/code-style.md)\n",
      };
      expect(check(docs, paths, published)).toEqual([]);
    });

    it("applies the rule to whichever package is configured", () => {
      const docs = {
        "packages/framework/docs/a.md": "[app](../../real-estate/src/y.ts)\n",
        "packages/real-estate/docs/a.md": "[fw](../../framework/src/x.ts)\n",
        "packages/real-estate/README.md": "[root](../../docs/code-style.md)\n",
      };
      expect(messages(docs, paths, "packages/real-estate")).toEqual([
        "packages/real-estate/docs/a.md: link ../../framework/src/x.ts leaves packages/real-estate; its published docs link only inside packages/real-estate",
        "packages/real-estate/README.md: link ../../docs/code-style.md leaves packages/real-estate; its published docs link only inside packages/real-estate",
      ]);
    });

    it("rejects a published folder that is neither . nor a workspace folder nor a package", () => {
      const expected = 'published must be ".", "config", or packages/<name>';
      expect(() => check({}, paths, "packages/framwork/docs")).toThrow(
        expected,
      );
      expect(() => check({}, paths, "elsewhere")).toThrow(expected);
    });

    it("holds the config workspace folder's docs when it is published", () => {
      const docs = {
        "config/docs/code-style.md": "[b](./code-style/b.md) [out](../../docs/x.md)\n",
        "config/docs/code-style/b.md": "# B\n",
        "config/README.md": "[style](./docs/code-style.md) [root](../AGENTS.md)\n",
        "config/AGENTS.md": "[root](../docs/x.md)\n",
        "config/CLAUDE.md": "@AGENTS.md\n",
      };
      expect(messages(docs, ["docs/x.md"], "config")).toEqual([
        "config/docs/code-style.md: link ../../docs/x.md leaves config; its published docs link only inside config",
        "config/README.md: link ../AGENTS.md leaves config; its published docs link only inside config",
        "config/AGENTS.md: link ../docs/x.md leaves config; its published docs link only inside config",
      ]);
    });

    it("rejects a workspace folder the repo doesn't track", () => {
      expect(() => check({}, paths, "config")).toThrow(
        "published package config has no tracked files",
      );
    });

    it("holds every package named, and no other", () => {
      const docs = {
        "packages/framework/docs/a.md": "[app](../../real-estate/src/y.ts)\n",
        "config/docs/a.md": "[root](../../docs/code-style.md)\n",
        "packages/real-estate/docs/a.md": "[fw](../../framework/src/x.ts)\n",
      };
      expect(messages(docs, paths, ["packages/framework", "config"])).toEqual([
        "packages/framework/docs/a.md: link ../../real-estate/src/y.ts leaves packages/framework; its published docs link only inside packages/framework",
        "config/docs/a.md: link ../../docs/code-style.md leaves config; its published docs link only inside config",
      ]);
    });

    it("rejects a published package the repo doesn't track", () => {
      expect(() => check({}, paths, "packages/framwork")).toThrow(
        "published package packages/framwork has no tracked files",
      );
    });

    it("holds no package to the rule when none is configured", () => {
      const docs = {
        "packages/framework/docs/a.md": "[root](../../../docs/code-style.md)\n",
      };
      expect(check(docs, paths)).toEqual([]);
    });

    it("holds the repo's own docs when the repo root is the published package", () => {
      const docs = {
        "docs/a.md": "[b](./b.md) [README](../README.md)\n",
        "docs/b.md": "# B\n",
        "docs/c.md": "[out](../../elsewhere.md)\n",
        "README.md": "[a](/docs/a.md)\n",
      };
      expect(messages(docs, [], ".")).toEqual([
        "docs/c.md: link ../../elsewhere.md leaves the repo; its published docs link only inside the repo",
        "docs/c.md: broken link ../../elsewhere.md: no file ../elsewhere.md",
      ]);
    });
  });

  describe("rule lines", () => {
    it("passes a rules-file rule line of any length", () => {
      expect(check({ "docs/code-style.md": `- **${"x".repeat(600)}**\n` })).toEqual(
        [],
      );
    });
  });

  describe("leads", () => {
    function withLead(lines: number, width = 6): string {
      return `# Doc\n\n${Array.from({ length: lines }, (_, i) => `line ${i}`.padEnd(width, "x")).join("\n\n")}\n\n## Section\n\nBody.\n`;
    }
    function unheaded(bytes: number): string {
      return `# Doc\n\n${"x".repeat(bytes - 8)}\n`;
    }

    it("fails a docs/ file whose lead before the first ## heading is over 5 lines", () => {
      expect(messages({ "docs/a.md": withLead(6) })).toEqual([
        "docs/a.md: lead is 6 lines before the first ## heading; keep it to 5 and move the rest under a heading",
      ]);
    });

    it("fails a lead over 800 bytes even at 5 lines or fewer", () => {
      expect(messages({ "docs/a.md": withLead(2, 401) })).toEqual([
        "docs/a.md: lead is 803 bytes before the first ## heading; keep it to 800 and move the rest under a heading",
      ]);
    });

    it("passes a lead of 5 lines and 800 bytes, not counting blank lines", () => {
      expect(check({ "docs/a.md": withLead(5, 159) })).toEqual([]);
    });

    it("fails a docs/ file over 4 KB with no ## heading", () => {
      expect(messages({ "docs/a.md": unheaded(4097) })).toEqual([
        "docs/a.md: doc is 4097 bytes with no ## heading; over 4096 bytes, give it a short lead and ## headings so it can be read by section",
      ]);
    });

    it("passes a docs/ file of 4 KB or less with no ## heading", () => {
      expect(check({ "docs/a.md": unheaded(4096) })).toEqual([]);
    });

    it("checks a package's docs/ files", () => {
      expect(messages({ "packages/app/docs/a.md": withLead(6) })).toEqual([
        "packages/app/docs/a.md: lead is 6 lines before the first ## heading; keep it to 5 and move the rest under a heading",
      ]);
    });

    it("checks the config workspace's docs/ files", () => {
      expect(messages({ "config/docs/a.md": withLead(6) })).toEqual([
        "config/docs/a.md: lead is 6 lines before the first ## heading; keep it to 5 and move the rest under a heading",
      ]);
    });

    it("leaves files outside docs/ unchecked", () => {
      expect(
        check({
          "README.md": withLead(6),
          "packages/app/README.md": withLead(6),
          "packages/app/src/docs/a.md": withLead(6),
        }),
      ).toEqual([]);
    });
  });

  describe("CLAUDE.md pairing", () => {
    it("fails a nested AGENTS.md with no sibling CLAUDE.md", () => {
      expect(messages({ "scripts/AGENTS.md": nested(2) })).toEqual([
        "scripts/AGENTS.md: no sibling CLAUDE.md importing it; add scripts/CLAUDE.md containing @AGENTS.md",
      ]);
    });

    it("fails a sibling CLAUDE.md that does not import it", () => {
      expect(
        messages({
          "scripts/AGENTS.md": nested(2),
          "scripts/CLAUDE.md": "Read AGENTS.md\n",
        }),
      ).toEqual([
        "scripts/AGENTS.md: no sibling CLAUDE.md importing it; add scripts/CLAUDE.md containing @AGENTS.md",
      ]);
    });
  });
});
