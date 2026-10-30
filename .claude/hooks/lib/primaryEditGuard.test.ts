import { describe, expect, it } from "vitest";

import {
  primaryEditDecision,
  type PrimaryEditInput,
} from "./primaryEditGuard.ts";

const root = "/code/byro-repo";
const framework = `${root}/packages/framework`;
const primaryCheckouts = [root, framework];
const workspace = `${root}/.claude/worktrees/byro-repo-issue-1-x`;

function decide(
  props: Partial<PrimaryEditInput> & Pick<PrimaryEditInput, "toolInput">,
) {
  return primaryEditDecision({
    cwd: root,
    primaryCheckouts,
    realPathOf: (path) => path,
    isIgnored: () => false,
    ...props,
  });
}

describe("primaryEditDecision, file tools", () => {
  it("denies a path the root doesn't ignore", () => {
    const decision = decide({ toolInput: { file_path: `${root}/docs/a.md` } });
    expect(decision.permissionDecision).toBe("deny");
  });

  it("judges a package clone's path by the clone, though the root ignores packages/*", () => {
    const decision = decide({
      toolInput: { file_path: "packages/framework/src/a.ts" },
      isIgnored: (checkout) => checkout === root,
    });
    expect(decision.permissionDecision).toBe("deny");
    expect(decision.reason).toContain(`primary checkout ${framework}.`);
  });

  it("denies a NotebookEdit in a primary checkout", () => {
    const decision = decide({
      toolInput: { notebook_path: `${root}/notes.ipynb` },
    });
    expect(decision.permissionDecision).toBe("deny");
  });

  it("judges where a symlink leads", () => {
    const decision = decide({
      toolInput: { file_path: "/elsewhere/link.md" },
      realPathOf: (path) =>
        path === "/elsewhere/link.md" ? `${root}/docs/a.md` : path,
    });
    expect(decision.permissionDecision).toBe("deny");
  });

  it.each([
    ["a gitignored path", `${root}/.runner/state.json`],
    ["a workspace path", `${workspace}/docs/a.md`],
    [
      "a workspace's package clone path",
      `${workspace}/packages/framework/src/a.ts`,
    ],
    ["a path outside every checkout", "/tmp/scratch/a.md"],
  ])("passes %s", (_case, filePath) => {
    const decision = decide({
      toolInput: { file_path: filePath },
      isIgnored: (_checkout, path) => path.includes("/.runner/"),
    });
    expect(decision.permissionDecision).toBe("allow");
  });
});

describe("primaryEditDecision, Bash", () => {
  function decideBash(command: string, cwd: string) {
    return decide({ toolInput: { command }, cwd });
  }

  it.each([
    ['git add -A && git commit -m "x"', root],
    ["git -C packages/framework commit -m x", root],
    ["cd packages/framework && git commit -m x", root],
    ["git commit --amend --no-edit", `${framework}/src`],
    ["git merge master", root],
    ["git -C packages/framework merge master", root],
    ["cd packages/framework && git merge master", root],
  ])("denies `%s` from %s", (command, cwd) => {
    expect(decideBash(command, cwd).permissionDecision).toBe("deny");
  });

  it("names the merge in a merge's denial", () => {
    expect(decideBash("git merge master", root).reason).toContain(
      "`git merge` would merge in the primary checkout",
    );
  });

  it.each([
    ["git commit -m x", workspace],
    ["git merge master", workspace],
    [`cd ${workspace} && git merge master`, root],
    [`cd ${workspace} && git commit -m x`, root],
    [`git -C ${workspace}/packages/framework commit -m x`, root],
    ["git status", root],
    ["npm test", root],
  ])("passes `%s` from %s", (command, cwd) => {
    expect(decideBash(command, cwd).permissionDecision).toBe("allow");
  });
});

describe("primaryEditDecision, the denial", () => {
  it.each([
    ["an edit", { file_path: `${root}/docs/a.md` }],
    ["a commit", { command: "git commit -m x" }],
  ])(
    "names /start-issue and both issue:start forms for %s",
    (_case, toolInput) => {
      const { reason } = decide({ toolInput });
      expect(reason).toContain("`/start-issue <repo> <n>`");
      expect(reason).toContain("npm run issue:start -- <repo> <n>");
      expect(reason).toContain("npm run issue:start -- --session <slug>");
      expect(reason).toMatch(/printed path/);
    },
  );
});
