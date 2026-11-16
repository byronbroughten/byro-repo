import { describe, expect, it } from "vitest";

import { inlinedSkill } from "./inlinedSkill.ts";

const skillText = `---
name: code-review
description: "Review the changes since a fixed point."
---

Two-axis review of the diff.

### 1. Pin the fixed point

The prose rules file, [\`docs/prose-style.md\`](../../../docs/prose-style.md), and [its agents](./agents/standards.md#brief), [a site](https://example.com/a.md) and [a heading](#process) stay.
`;

describe("inlinedSkill.sectionOf", () => {
  const section = inlinedSkill.sectionOf(skillText, "code-review");

  it("wraps the skill's body, without its frontmatter, in a section named for the skill", () => {
    expect(section).toMatch(
      /^<skill name="code-review">\nTwo-axis review of the diff\.\n\n### 1\. Pin the fixed point\n/,
    );
    expect(section).toMatch(/stay\.\n<\/skill>$/);
    expect(section).not.toContain("description:");
  });

  it("rewrites each relative link in the skill to its path from the repo root, leaving URLs and anchors", () => {
    expect(section).toContain("[`docs/prose-style.md`](docs/prose-style.md)");
    expect(section).toContain(
      "[its agents](.claude/skills/code-review/agents/standards.md#brief)",
    );
    expect(section).toContain("[a site](https://example.com/a.md)");
    expect(section).toContain("[a heading](#process)");
  });
});

describe("inlinedSkill.textIn", () => {
  it("reads the skill's SKILL.md from the workspace", () => {
    const text = inlinedSkill.textIn({
      workspacePath: "/workspaces/byro-repo-issue-12",
      skillName: "review-piece",
      readText(path) {
        return `read ${path}`;
      },
    });

    expect(text).toBe(
      "read /workspaces/byro-repo-issue-12/.claude/skills/review-piece/SKILL.md",
    );
  });
});
