import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { defaultRunKnobs } from "./runKnobs.ts";
import {
  skillWriteDecision,
  type SkillWriteRequest,
} from "./skillWriteDecision.ts";

const workspaceRoot = mkdtempSync(join(tmpdir(), "skill-write-"));
mkdirSync(join(workspaceRoot, ".claude/skills/tdd"), { recursive: true });
mkdirSync(join(workspaceRoot, ".claude/agents"), { recursive: true });
const outside = mkdtempSync(join(tmpdir(), "skill-write-outside-"));
symlinkSync(outside, join(workspaceRoot, ".claude/skills/escape"));
symlinkSync(
  join(outside, "not-yet.md"),
  join(workspaceRoot, ".claude/skills/dangling.md"),
);

function request(
  toolName: string,
  toolInput: SkillWriteRequest["toolInput"],
): SkillWriteRequest {
  return {
    toolName,
    toolInput,
    workspaceRoot,
    allowedGlobs: defaultRunKnobs.allowedWriteGlobs,
  };
}

const skillPath = join(workspaceRoot, ".claude/skills/tdd/SKILL.md");
const agentPath = join(workspaceRoot, ".claude/agents/repo-explorer.md");

describe("skillWriteDecision", () => {
  it("allows a Write to a skill file inside the workspace", () => {
    expect(
      skillWriteDecision(
        request("Write", { file_path: skillPath, content: "# TDD\n" }),
      ),
    ).toBe("allow");
  });

  it("allows an Edit to an agent definition inside the workspace", () => {
    expect(
      skillWriteDecision(
        request("Edit", {
          file_path: agentPath,
          old_string: "a",
          new_string: "description: Read-only sweep.",
        }),
      ),
    ).toBe("allow");
  });

  it("allows a Write creating a new skill folder", () => {
    expect(
      skillWriteDecision(
        request("Write", {
          file_path: join(workspaceRoot, ".claude/skills/new/SKILL.md"),
          content: "# New\n",
        }),
      ),
    ).toBe("allow");
  });

  it("allows a workspace root reached through a symlink", () => {
    const linkedRoot = join(outside, "linked-root");
    symlinkSync(realpathSync(workspaceRoot), linkedRoot);
    expect(
      skillWriteDecision({
        ...request("Write", { file_path: skillPath, content: "# TDD\n" }),
        workspaceRoot: linkedRoot,
      }),
    ).toBe("allow");
  });

  it.each(["allowed-tools", "permissionMode", "hooks"])(
    "gives no decision for content carrying a %s key",
    (key) => {
      const content = `---\nname: tdd\n${key}: Bash\n---\n`;
      expect(
        skillWriteDecision(request("Write", { file_path: skillPath, content })),
      ).toBeUndefined();
      expect(
        skillWriteDecision(
          request("Edit", {
            file_path: agentPath,
            old_string: "a",
            new_string: `  ${key}:`,
          }),
        ),
      ).toBeUndefined();
    },
  );

  it.each([".claude/settings.json", ".claude/hooks/branchGuard.ts"])(
    "gives no decision for %s",
    (path) => {
      expect(
        skillWriteDecision(
          request("Write", {
            file_path: join(workspaceRoot, path),
            content: "",
          }),
        ),
      ).toBeUndefined();
    },
  );

  it("gives no decision for a skills path that climbs out with ..", () => {
    expect(
      skillWriteDecision(
        request("Write", {
          file_path: join(workspaceRoot, ".claude/skills/../settings.json"),
          content: "",
        }),
      ),
    ).toBeUndefined();
  });

  it("gives no decision for a path outside the workspace", () => {
    expect(
      skillWriteDecision(
        request("Write", {
          file_path: join(outside, ".claude/skills/tdd/SKILL.md"),
          content: "",
        }),
      ),
    ).toBeUndefined();
  });

  it("gives no decision for a skills path whose symlink resolves outside the workspace", () => {
    expect(
      skillWriteDecision(
        request("Write", {
          file_path: join(workspaceRoot, ".claude/skills/escape/SKILL.md"),
          content: "",
        }),
      ),
    ).toBeUndefined();
  });

  it("gives no decision for a dangling symlink pointing outside the workspace", () => {
    expect(
      skillWriteDecision(
        request("Write", {
          file_path: join(workspaceRoot, ".claude/skills/dangling.md"),
          content: "",
        }),
      ),
    ).toBeUndefined();
  });

  it.each(["Bash", "MultiEdit", "NotebookEdit", "Read"])(
    "gives no decision for %s",
    (toolName) => {
      expect(
        skillWriteDecision(
          request(toolName, { file_path: skillPath, content: "" }),
        ),
      ).toBeUndefined();
    },
  );

  it("gives no decision for an input with no file path or text", () => {
    expect(skillWriteDecision(request("Write", {}))).toBeUndefined();
    expect(
      skillWriteDecision(request("Edit", { file_path: skillPath })),
    ).toBeUndefined();
  });
});
