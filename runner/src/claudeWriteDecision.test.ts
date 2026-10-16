import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  claudeWriteDecision,
  type ClaudeWriteRequest,
  type ClaudeWriteToolInput,
} from "./claudeWriteDecision.ts";
import { defaultRunKnobs } from "./runKnobs.ts";

const workspaceRoot = mkdtempSync(join(tmpdir(), "claude-write-"));
mkdirSync(join(workspaceRoot, ".claude/skills/tdd"), { recursive: true });
const outside = mkdtempSync(join(tmpdir(), "claude-write-outside-"));
symlinkSync(outside, join(workspaceRoot, ".claude/skills/escape"));
symlinkSync(
  join(outside, "not-yet.md"),
  join(workspaceRoot, ".claude/skills/dangling.md"),
);

function request(
  toolName: string,
  toolInput: ClaudeWriteToolInput & Record<string, unknown>,
): ClaudeWriteRequest {
  return {
    toolName,
    toolInput,
    workspaceRoot,
    allowedGlobs: defaultRunKnobs.allowedWriteGlobs,
  };
}

const skillPath = join(workspaceRoot, ".claude/skills/tdd/SKILL.md");

describe("claudeWriteDecision", () => {
  it.each([
    ".claude/skills/tdd/SKILL.md",
    ".claude/agents/repo-explorer.md",
    ".claude/hooks/branchGuard.ts",
  ])("allows an Edit or Write to %s", (path) => {
    const filePath = join(workspaceRoot, path);
    expect(claudeWriteDecision(request("Write", { file_path: filePath }))).toBe(
      "allow",
    );
    expect(claudeWriteDecision(request("Edit", { file_path: filePath }))).toBe(
      "allow",
    );
  });

  it.each(["allowed-tools", "permissionMode", "hooks", "mcpServers"])(
    "allows a write whose frontmatter carries a %s key",
    (key) => {
      const content = `---\nname: tdd\n${key}: Bash\n---\n`;
      expect(
        claudeWriteDecision(
          request("Write", { file_path: skillPath, content }),
        ),
      ).toBe("allow");
      expect(
        claudeWriteDecision(
          request("Edit", {
            file_path: skillPath,
            old_string: "name: tdd",
            new_string: `${key}: Bash`,
          }),
        ),
      ).toBe("allow");
    },
  );

  it("allows a Write creating a new skill folder", () => {
    expect(
      claudeWriteDecision(
        request("Write", {
          file_path: join(workspaceRoot, ".claude/skills/new/SKILL.md"),
        }),
      ),
    ).toBe("allow");
  });

  it("allows a workspace root reached through a symlink", () => {
    const linkedRoot = join(outside, "linked-root");
    symlinkSync(realpathSync(workspaceRoot), linkedRoot);
    expect(
      claudeWriteDecision({
        ...request("Write", { file_path: skillPath }),
        workspaceRoot: linkedRoot,
      }),
    ).toBe("allow");
  });

  it.each([".claude/settings.json", ".claude/settings.local.json"])(
    "gives no decision for %s",
    (path) => {
      expect(
        claudeWriteDecision(
          request("Write", { file_path: join(workspaceRoot, path) }),
        ),
      ).toBeUndefined();
    },
  );

  it("gives no decision for a skills path that climbs out with ..", () => {
    expect(
      claudeWriteDecision(
        request("Write", {
          file_path: join(workspaceRoot, ".claude/skills/../settings.json"),
        }),
      ),
    ).toBeUndefined();
  });

  it("gives no decision for a path outside the workspace", () => {
    expect(
      claudeWriteDecision(
        request("Write", {
          file_path: join(outside, ".claude/skills/tdd/SKILL.md"),
        }),
      ),
    ).toBeUndefined();
  });

  it("gives no decision for a skills path whose symlink resolves outside the workspace", () => {
    expect(
      claudeWriteDecision(
        request("Write", {
          file_path: join(workspaceRoot, ".claude/skills/escape/SKILL.md"),
        }),
      ),
    ).toBeUndefined();
  });

  it("gives no decision for a dangling symlink pointing outside the workspace", () => {
    expect(
      claudeWriteDecision(
        request("Write", {
          file_path: join(workspaceRoot, ".claude/skills/dangling.md"),
        }),
      ),
    ).toBeUndefined();
  });

  it.each(["Bash", "MultiEdit", "NotebookEdit", "Read"])(
    "gives no decision for %s",
    (toolName) => {
      expect(
        claudeWriteDecision(request(toolName, { file_path: skillPath })),
      ).toBeUndefined();
    },
  );

  it("gives no decision for an input with no file path", () => {
    expect(claudeWriteDecision(request("Write", {}))).toBeUndefined();
  });
});
