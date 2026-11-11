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

    it("checks a package's docs, GLOSSARY.md and README.md", () => {
      expect(
        messages({
          "packages/app/docs/a.md": "[gone](./gone.md)\n",
          "packages/app/GLOSSARY.md": "[gone](./gone.md)\n",
          "packages/app/README.md": "[gone](./gone.md)\n",
        }),
      ).toEqual([
        "packages/app/docs/a.md: broken link ./gone.md: no file packages/app/docs/gone.md",
        "packages/app/GLOSSARY.md: broken link ./gone.md: no file packages/app/gone.md",
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

    it("checks every SKILL.md", () => {
      expect(
        messages({
          ".claude/skills/x/SKILL.md": "[gone](./gone.md)\n",
          "runner/skills/x/SKILL.md": "[gone](./gone.md)\n",
        }),
      ).toEqual([
        ".claude/skills/x/SKILL.md: broken link ./gone.md: no file .claude/skills/x/gone.md",
        "runner/skills/x/SKILL.md: broken link ./gone.md: no file runner/skills/x/gone.md",
      ]);
    });

    it("leaves unlisted docs unchecked", () => {
      expect(
        check({ ".claude/skills/x/notes.md": "[gone](./gone.md)\n" }),
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
            "packages/framework/docs/a.md":
              "[style](../../../docs/code-style.md)\n",
            "packages/framework/GLOSSARY.md":
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
        "packages/framework/GLOSSARY.md: link ../real-estate/src/y.ts leaves packages/framework; its published docs link only inside packages/framework",
        "packages/framework/GLOSSARY.md: link /docs/code-style.md leaves packages/framework; its published docs link only inside packages/framework",
        "packages/framework/README.md: link ../../AGENTS.md leaves packages/framework; its published docs link only inside packages/framework",
        "packages/framework/docs/sub/c.md: link ../../../../docs/code-style.md leaves packages/framework; its published docs link only inside packages/framework",
      ]);
    });

    it("passes a published framework doc linking inside the framework", () => {
      const docs = {
        "packages/framework/docs/a.md":
          "[src](../src/x.ts) [b](./b.md#b) [agents](../AGENTS.md)\n",
        "packages/framework/AGENTS.md": "# Framework\n",
        "packages/framework/CLAUDE.md": "@AGENTS.md\n",
        "packages/framework/docs/b.md": "# B\n",
        "packages/framework/README.md":
          "[a](./docs/a.md) [abs](/packages/framework/src/x.ts)\n",
      };
      expect(check(docs, paths, published)).toEqual([]);
    });

    it("fails a published framework's AGENTS.md and CLAUDE.md linking outside it", () => {
      const docs = {
        "packages/framework/CLAUDE.md": "[root](../../docs/code-style.md)\n",
        "packages/framework/src/AGENTS.md":
          "[root](../../../docs/code-style.md)\n",
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
        "config/docs/code-style.md":
          "[b](./code-style/b.md) [out](../../docs/x.md)\n",
        "config/docs/code-style/b.md": "# B\n",
        "config/README.md":
          "[style](./docs/code-style.md) [root](../AGENTS.md)\n",
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
        "docs/a.md": "[b](./b.md) [agents](../AGENTS.md)\n",
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
      expect(
        check({ "docs/code-style.md": `- **${"x".repeat(600)}**\n` }),
      ).toEqual([]);
    });
  });

  describe("line-number citations", () => {
    it("fails a .md:<n> citation in any markdown file, naming its line", () => {
      const violations = check({
        "notes/a.md": "# A\n\nSee [`b.md:38`](./b.md#ticket-size).\n",
      });
      expect(violations).toEqual([
        {
          path: "notes/a.md",
          line: 3,
          message:
            "line-number citation b.md:38; cite a heading anchor, since a line number drifts",
        },
      ]);
    });

    it("passes a citation inside a record folder", () => {
      const cited = "Cited `planning.md:38` at a fixed commit.\n";
      expect(
        check({
          "docs/agents/outcomes/r-1/r-2.md": cited,
          "packages/personal/writing/agent-drafts/s.md": cited,
          "packages/personal/inbox/changes.md": cited,
          "inbox/proposals.md": cited,
        }),
      ).toEqual([]);
    });

    it("passes an anchor link", () => {
      const docs = {
        "docs/a.md": "[Ticket size, **Split**](./b.md#ticket-size)\n",
        "docs/b.md": "## Ticket size\n",
      };
      expect(check(docs)).toEqual([]);
    });
  });

  describe("README links", () => {
    const readmes = {
      "README.md": "# Repo\n",
      "runner/README.md": "## Context nudge\n",
    };

    it("fails a non-README doc's link to a README, anchored or not, naming its line", () => {
      const violations = check({
        ...readmes,
        "docs/a.md": "# A\n\nSee [r](../runner/README.md#context-nudge).\n",
        ".claude/skills/x/SKILL.md": "[r](../../../README.md)\n",
      });
      expect(violations).toEqual([
        {
          path: "docs/a.md",
          line: 3,
          message: "A README is for humans; link the fact's home instead.",
        },
        {
          path: ".claude/skills/x/SKILL.md",
          line: 1,
          message: "A README is for humans; link the fact's home instead.",
        },
      ]);
    });

    it("passes a README linking a README", () => {
      expect(
        check({ ...readmes, "README.md": "[r](./runner/README.md)\n" }),
      ).toEqual([]);
    });

    it("passes a README link in code or a record", () => {
      expect(
        check({
          ...readmes,
          "docs/a.md": "`[r](../README.md)`\n",
          "docs/agents/outcomes/r-1.md": "[r](../../../README.md)\n",
        }),
      ).toEqual([]);
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

  describe("observation indexes", () => {
    const index = "docs/claude-code-behaviour.md";
    const evidence = "[#1](https://github.com/o/r/issues/1#issuecomment-2)";
    const untagged = `${index}: observation line starts with neither "Observed:" nor "Documented:"`;
    function withBullets(...bullets: string[]): string {
      const body = bullets.map((bullet) => `- ${bullet}`).join("\n");
      return `# Index\n\n- Lead bullet, untagged.\n\n## Section\n\n${body}\n`;
    }

    it("passes a listed index whose every bullet is tagged, dated and linked", () => {
      expect(
        check({
          [index]: withBullets(
            `Observed: a read; 2026-10-28; ${evidence}.`,
            `Documented: the docs say so; 2026-10-29; ${evidence}.`,
          ),
        }),
      ).toEqual([]);
    });

    it("fails a bullet with no tag", () => {
      expect(
        messages({ [index]: withBullets(`A read; 2026-10-28; ${evidence}.`) }),
      ).toEqual([untagged]);
    });

    it("fails a bullet with no YYYY-MM-DD date", () => {
      expect(
        messages({
          [index]: withBullets(`Observed: a read; Sept 2026; ${evidence}.`),
        }),
      ).toEqual([`${index}: observation line has no YYYY-MM-DD date`]);
    });

    it("fails a bullet with no link", () => {
      expect(
        messages({ [index]: withBullets("Observed: a read; 2026-10-28; #1.") }),
      ).toEqual([`${index}: observation line links no evidence`]);
    });

    it("fails an Open: bullet", () => {
      expect(
        messages({
          [index]: withBullets(`Open: does it? 2026-10-28; ${evidence}.`),
        }),
      ).toEqual([untagged]);
    });

    it("checks the framework's Sheets index, keyed from the framework clone's root", () => {
      const sheetsIndex = "docs/sheets-behaviour.md";
      expect(
        messages({
          [sheetsIndex]: withBullets(`A read; 2026-10-28; ${evidence}.`),
        }),
      ).toEqual([
        `${sheetsIndex}: observation line starts with neither "Observed:" nor "Documented:"`,
      ]);
    });

    it("leaves bullets in the lead unchecked", () => {
      expect(check({ [index]: withBullets() })).toEqual([]);
    });

    it("leaves an unlisted file's bullets unchecked", () => {
      expect(
        check({ "docs/a.md": withBullets("A read, undated and unlinked.") }),
      ).toEqual([]);
    });
  });

  describe("skill index", () => {
    const index = "docs/agents/workflows.md";
    const skills = {
      ".claude/skills/grilling/SKILL.md": "# Grilling\n",
      "runner/skills/runner/SKILL.md": "# Runner\n",
    };
    const linksBoth =
      "# Index\n\n[grilling](../../.claude/skills/grilling/SKILL.md), [runner](../../runner/skills/runner/SKILL.md)\n";
    const linksGrilling =
      "# Index\n\n[grilling](../../.claude/skills/grilling/SKILL.md)\n";
    const linksRunner =
      "# Index\n\n[runner](../../runner/skills/runner/SKILL.md)\n";
    const placeIn = "a Workflow stage or the out-of-scope list";

    it("passes an index that links every skill under both skill roots", () => {
      expect(check({ ...skills, [index]: linksBoth })).toEqual([]);
    });

    it("fails an index that skips a skill under .claude/skills", () => {
      expect(messages({ ...skills, [index]: linksRunner })).toEqual([
        `${index}: skill grilling is not linked; place .claude/skills/grilling/SKILL.md in ${placeIn}`,
      ]);
    });

    it("fails an index that skips a skill under runner/skills", () => {
      expect(check({ ...skills, [index]: linksGrilling })).toEqual([
        {
          path: index,
          line: 1,
          message: `skill runner is not linked; place runner/skills/runner/SKILL.md in ${placeIn}`,
        },
      ]);
    });

    it("leaves skills unchecked when the map is absent", () => {
      expect(check(skills)).toEqual([]);
    });

    it("leaves a doc not listed as a skill index unchecked for skill links", () => {
      expect(check({ ...skills, "docs/agents/other.md": "# Other\n" })).toEqual(
        [],
      );
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
