import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  constants,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A test repo is thrown away, so it needs no fsync, and automatic maintenance would add a child process to every commit, merge and push.
const cheapWritesConfig =
  "[core]\n\tfsync = none\n[gc]\n\tauto = 0\n[maintenance]\n\tauto = false\n[receive]\n\tautogc = false\n";

interface GitFixtureFiles {
  gitignoreOf: (repo: string) => string;
  addUntracked?: (primaryRoot: string) => void;
}

// A primary root of clones, each pushed to a bare remote, built once per test file and copied into each test's folder.
export class GitFixture {
  private readonly template: string;
  private readonly clonePaths: Record<string, string>;

  constructor(template: string, clonePaths: Record<string, string>) {
    this.template = template;
    this.clonePaths = clonePaths;
  }

  static init(
    clonePaths: Record<string, string>,
    { gitignoreOf, addUntracked = () => {} }: GitFixtureFiles,
  ): GitFixture {
    const template = realpathSync(mkdtempSync(join(tmpdir(), "git-fixture-")));
    const primaryRoot = join(template, "byro-repo");
    Object.entries(clonePaths).forEach(([repo, clonePath]) => {
      const remote = join(template, "remotes", `${repo}.git`);
      mkdirSync(remote, { recursive: true });
      git(remote, "init", "--bare", "-b", "master");
      appendFileSync(join(remote, "config"), cheapWritesConfig);
      const clone = join(primaryRoot, clonePath);
      mkdirSync(clone, { recursive: true });
      git(clone, "init", "-b", "master");
      appendFileSync(join(clone, ".git", "config"), cheapWritesConfig);
      git(clone, "config", "user.name", "Test");
      git(clone, "config", "user.email", "test@example.com");
      git(clone, "remote", "add", "origin", remote);
      writeFileSync(join(clone, ".gitignore"), gitignoreOf(repo));
      writeFileSync(join(clone, "README.md"), `# ${repo}\n`);
      git(clone, "add", ".");
      git(clone, "commit", "-m", "Initial commit");
      git(clone, "push", "-u", "origin", "master");
    });
    addUntracked(primaryRoot);
    return new GitFixture(template, clonePaths);
  }

  // Copy-on-write where the filesystem has it, so a copy costs a fraction of a build.
  copyTo(folder: string): void {
    cpSync(this.template, folder, {
      recursive: true,
      mode: constants.COPYFILE_FICLONE,
    });
    Object.values(this.clonePaths).forEach((clonePath) => {
      const config = join(folder, "byro-repo", clonePath, ".git", "config");
      writeFileSync(
        config,
        readFileSync(config, "utf8").replaceAll(this.template, folder),
      );
    });
  }

  remove(): void {
    rmSync(this.template, { recursive: true, force: true });
  }
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
