import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { git } from "./GitFixture.ts";
import { stalePathsOf, stalePathsTouchedBy } from "./stalePaths.ts";

const clonePaths = {
  "byro-repo": ".",
  "sheets-framework": "packages/framework",
};

let primaryRoot: string;

beforeEach(() => {
  primaryRoot = realpathSync(mkdtempSync(join(tmpdir(), "stale-paths-")));
  initRepo(primaryRoot, { ".gitignore": "packages/*\n" });
  initRepo(join(primaryRoot, "packages/framework"), {
    "README.md": "Built on packages/framework.\n",
  });
});

afterEach(() => {
  rmSync(primaryRoot, { recursive: true, force: true });
});

function initRepo(folder: string, files: Record<string, string>): void {
  mkdirSync(folder, { recursive: true });
  git(folder, "init", "-q", "-b", "master");
  commitFiles(folder, files);
}

function commitFiles(folder: string, files: Record<string, string>): void {
  Object.entries(files).forEach(([file, content]) => {
    mkdirSync(dirname(join(folder, file)), { recursive: true });
    writeFileSync(join(folder, file), content);
    git(folder, "add", file);
  });
  git(
    folder,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-q",
    "-m",
    "Add files",
  );
}

describe("stalePathsOf", () => {
  it("finds a mention of a folder holding no clone, with its repo, file and line", async () => {
    commitFiles(primaryRoot, {
      "docs/guide.md": "Intro.\nSee packages/writing/AGENTS.md first.\n",
    });
    commitFiles(join(primaryRoot, "packages/framework"), {
      "docs/app.md": "The app sits in packages/real-estate.\n",
    });

    expect(await stalePathsOf({ primaryRoot, clonePaths })).toEqual([
      {
        repo: "byro-repo",
        file: "docs/guide.md",
        line: 2,
        path: "packages/writing",
      },
      {
        repo: "sheets-framework",
        file: "docs/app.md",
        line: 1,
        path: "packages/real-estate",
      },
    ]);
  });

  it("finds no mention of a folder that holds a clone", async () => {
    commitFiles(primaryRoot, {
      "AGENTS.md": "Read ./packages/framework/src/AGENTS.md.\n",
    });

    expect(await stalePathsOf({ primaryRoot, clonePaths })).toEqual([]);
  });

  it("skips test files, so fixtures can name made-up folders", async () => {
    commitFiles(primaryRoot, {
      "runner/src/move.test.ts": 'const moved = "packages/tools";\n',
      "runner/src/__snapshots__/move.test.ts.snap": "packages/tools\n",
    });

    expect(await stalePathsOf({ primaryRoot, clonePaths })).toEqual([]);
  });

  it("skips outcome records, which quote old paths, but not the same mention elsewhere", async () => {
    commitFiles(primaryRoot, {
      "docs/agents/outcomes/byro-repo-412/personal-21.md":
        "Moved packages/writing.\n",
      "docs/agents/guide.md": "Moved packages/writing.\n",
    });

    expect(await stalePathsOf({ primaryRoot, clonePaths })).toEqual([
      {
        repo: "byro-repo",
        file: "docs/agents/guide.md",
        line: 1,
        path: "packages/writing",
      },
    ]);
  });
});

describe("stalePathsTouchedBy", () => {
  it("skips outcome records in the files a branch changes", async () => {
    git(primaryRoot, "switch", "-q", "-c", "issue-1-fix");
    commitFiles(primaryRoot, {
      "docs/agents/outcomes/a/b-1.md": "Was packages/writing.\n",
      "new.md": "Was packages/writing.\n",
    });
    git(primaryRoot, "switch", "-q", "master");

    expect(
      await stalePathsTouchedBy({ primaryRoot, clonePaths }, [
        { repo: "byro-repo", branch: "issue-1-fix" },
      ]),
    ).toEqual([
      { repo: "byro-repo", file: "new.md", line: 1, path: "packages/writing" },
    ]);
  });

  it("finds stale mentions only in the files a branch changes", async () => {
    commitFiles(primaryRoot, { "old.md": "Was in packages/writing.\n" });
    git(primaryRoot, "switch", "-q", "-c", "issue-1-fix");
    commitFiles(primaryRoot, { "new.md": "Now in packages/personal.\n" });
    git(primaryRoot, "switch", "-q", "master");

    expect(
      await stalePathsTouchedBy({ primaryRoot, clonePaths }, [
        { repo: "byro-repo", branch: "issue-1-fix" },
      ]),
    ).toEqual([
      {
        repo: "byro-repo",
        file: "new.md",
        line: 1,
        path: "packages/personal",
      },
    ]);
  });
});
