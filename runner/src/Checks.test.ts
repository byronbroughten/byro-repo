import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type CheckResult,
  Checks,
  type ChecksConfig,
  type CommandDuration,
} from "./Checks.ts";
import type { Command } from "./runKnobs.ts";

const clonePaths = {
  "byro-repo": ".",
  utils: "packages/utils",
};

let temp: string;
let root: string;
let stampFolder: string;

beforeEach(() => {
  temp = realpathSync(mkdtempSync(join(tmpdir(), "checks-")));
  root = join(temp, "byro-repo");
  stampFolder = join(temp, ".runner", "check-stamps");
  buildRepos();
});

afterEach(() => {
  rmSync(temp, { recursive: true, force: true });
});

function checks(
  commands: Command[],
  overrides: Partial<ChecksConfig> = {},
): Checks {
  return Checks.init({
    commands,
    root,
    clonePaths,
    stampFolder,
    nodeVersion: "v22.0.0",
    ...overrides,
  });
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
    { cwd, encoding: "utf8" },
  ).trim();
}

function buildRepos(): void {
  Object.entries(clonePaths).forEach(([repo, clonePath]) => {
    const clone = join(root, clonePath);
    mkdirSync(clone, { recursive: true });
    git(clone, "init", "-b", "master");
    const ignored =
      repo === "byro-repo" ? "packages/*\npackage-lock.json\n" : "";
    writeFileSync(join(clone, ".gitignore"), ignored);
    writeFileSync(join(clone, "README.md"), `# ${repo}\n`);
    git(clone, "add", ".");
    git(clone, "commit", "-m", "Initial commit");
  });
  writeLockfile("lock 1");
}

function writeLockfile(content: string): void {
  writeFileSync(join(root, "package-lock.json"), content);
}

function commitChange(clonePath: string): void {
  const clone = join(root, clonePath);
  writeFileSync(join(clone, "README.md"), "# changed\n");
  git(clone, "commit", "-am", "Change");
}

// A shell command that leaves a marker file in temp, so a test can see whether it ran.
function marking(name: string, exitCode = 0): Command {
  return [
    "sh",
    "-c",
    `touch ${join(temp, name)}; echo ${name} says hello; exit ${exitCode}`,
  ];
}

function hasRun(name: string): boolean {
  return existsSync(join(temp, name));
}

function clearMarkers(...names: string[]): void {
  names.forEach((name) => rmSync(join(temp, name), { force: true }));
}

function stampCount(): number {
  return existsSync(stampFolder) ? readdirSync(stampFolder).length : 0;
}

function sleeping(seconds: number): Command {
  return ["sh", "-c", `sleep ${seconds}`];
}

function durationsOf(result: CheckResult): CommandDuration[] {
  if (result.kind === "skipped") throw new Error("A skip has no durations.");
  return result.durations;
}

function stampContents(): unknown[] {
  return readdirSync(stampFolder).map((name) =>
    JSON.parse(readFileSync(join(stampFolder, name), "utf8")),
  );
}

// Leaves its own marker, then waits up to five seconds for the other's; only commands run at once both pass.
function waitingFor(own: string, other: string): Command {
  const script = `touch ${join(temp, own)}; i=0; while [ ! -f ${join(temp, other)} ]; do i=$((i+1)); [ $i -gt 100 ] && exit 1; sleep 0.05; done`;
  return ["sh", "-c", script];
}

describe("Checks.run", () => {
  it("passes and writes a stamp when every command is green and every repo clean", async () => {
    const result = await checks([marking("a"), marking("b")]).run();

    expect(result).toMatchObject({ kind: "passed", isStamped: true });
    expect(stampCount()).toBe(1);
  });

  it("fails with the red command's output and writes no stamp", async () => {
    const result = await checks([marking("a"), marking("b", 1)]).run();

    expect(result).toMatchObject({
      kind: "failed",
      failures: [{ command: marking("b", 1), output: "b says hello" }],
    });
    expect(stampCount()).toBe(0);
  });

  it("reports every red command together", async () => {
    const result = await checks([
      marking("a", 1),
      marking("b"),
      marking("c", 2),
    ]).run();

    expect(result).toMatchObject({
      kind: "failed",
      failures: [
        { command: marking("a", 1), output: "a says hello" },
        { command: marking("c", 2), output: "c says hello" },
      ],
    });
  });

  it("runs but writes no stamp when a repo has an uncommitted change", async () => {
    writeFileSync(join(root, "packages/utils/README.md"), "# edited\n");

    const result = await checks([marking("a")]).run();

    expect(result).toMatchObject({ kind: "passed", isStamped: false });
    expect(hasRun("a")).toBe(true);
    expect(stampCount()).toBe(0);
  });

  it("runs but writes no stamp when a repo has an untracked file", async () => {
    writeFileSync(join(root, "new.txt"), "new\n");

    const result = await checks([marking("a")]).run();

    expect(result).toMatchObject({ kind: "passed", isStamped: false });
    expect(stampCount()).toBe(0);
  });

  it("writes no stamp when a command changes a tracked file", async () => {
    const editing: Command = [
      "sh",
      "-c",
      `echo edited > ${join(root, "README.md")}`,
    ];

    const result = await checks([editing]).run();

    expect(result).toMatchObject({ kind: "passed", isStamped: false });
    expect(stampCount()).toBe(0);
  });

  it("writes no stamp when a commit lands while the commands run", async () => {
    const committing: Command = [
      "sh",
      "-c",
      `cd ${join(root, "packages/utils")} && echo changed > README.md && git -c user.name=Test -c user.email=test@example.com commit -qam Change`,
    ];

    const result = await checks([committing]).run();

    expect(result).toMatchObject({ kind: "passed", isStamped: false });
    expect(stampCount()).toBe(0);
  });

  it("runs no command on a matching stamp", async () => {
    await checks([marking("a"), marking("b")]).run();
    clearMarkers("a", "b");

    const result = await checks([marking("a"), marking("b")]).run();

    expect(result).toEqual({ kind: "skipped" });
    expect([hasRun("a"), hasRun("b")]).toEqual([false, false]);
  });

  it("runs every command despite a stamp when fresh, and the pass stamps", async () => {
    await checks([marking("a")]).run();
    clearMarkers("a");

    const result = await checks([marking("a")]).run({ isFresh: true });

    expect(result).toMatchObject({ kind: "passed", isStamped: true });
    expect(hasRun("a")).toBe(true);
    expect(stampCount()).toBe(1);
  });

  it("misses the stamp after a commit in any repo", async () => {
    await checks([marking("a")]).run();
    commitChange("packages/utils");
    clearMarkers("a");

    const result = await checks([marking("a")]).run();

    expect(result).toMatchObject({ kind: "passed", isStamped: true });
    expect(hasRun("a")).toBe(true);
  });

  it("misses the stamp after the lockfile changes", async () => {
    await checks([marking("a")]).run();
    writeLockfile("lock 2");
    clearMarkers("a");

    const result = await checks([marking("a")]).run();

    expect(result).toMatchObject({ kind: "passed", isStamped: true });
    expect(hasRun("a")).toBe(true);
  });

  it("misses the stamp under another Node version", async () => {
    await checks([marking("a")]).run();
    clearMarkers("a");

    const result = await checks([marking("a")], {
      nodeVersion: "v24.0.0",
    }).run();

    expect(result).toMatchObject({ kind: "passed", isStamped: true });
    expect(hasRun("a")).toBe(true);
  });

  it("times each command of a pass, in command order", async () => {
    const result = await checks([marking("a"), sleeping(0.2)]).run();

    expect(result).toMatchObject({
      kind: "passed",
      durations: [
        { command: marking("a"), ms: expect.any(Number) },
        { command: sleeping(0.2), ms: expect.any(Number) },
      ],
    });
    expect(durationsOf(result)[1]?.ms).toBeGreaterThanOrEqual(200);
  });

  it("times each command of a failure, green and red alike", async () => {
    const result = await checks([marking("a"), marking("b", 1)]).run();

    expect(result).toMatchObject({
      kind: "failed",
      durations: [
        { command: marking("a"), ms: expect.any(Number) },
        { command: marking("b", 1), ms: expect.any(Number) },
      ],
    });
  });

  it("keeps a stamped pass's durations in its stamp", async () => {
    const result = await checks([marking("a"), marking("b")]).run();

    expect(stampContents()).toEqual([durationsOf(result)]);
  });

  it("reports no durations on a skip and leaves the stamp as it was", async () => {
    await checks([marking("a")]).run();
    const stamped = stampContents();

    const result = await checks([marking("a")]).run();

    expect(result).toEqual({ kind: "skipped" });
    expect(stampContents()).toEqual(stamped);
  });

  it("runs the commands at the same time", async () => {
    const result = await checks([
      waitingFor("left", "right"),
      waitingFor("right", "left"),
    ]).run();

    expect(result).toMatchObject({ kind: "passed", isStamped: true });
  });
});
