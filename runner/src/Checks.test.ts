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
import { setTimeout as sleep } from "node:timers/promises";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  type CheckedPackage,
  type CheckResult,
  Checks,
  type ChecksConfig,
  type CommandDuration,
} from "./Checks.ts";
import { git, GitFixture } from "./GitFixture.ts";
import { deadPid, liveHolder, seedHolder } from "./lockFixture.ts";
import { type LockHolder, PidLock } from "./PidLock.ts";
import type { Command } from "./runKnobs.ts";

// The root package depends on none, so a test can see config carved out of it.
const packages: CheckedPackage[] = [
  {
    name: "root",
    path: ".",
    excludedPaths: ["config", "packages/utils", "packages/framework"],
    dependencies: [],
  },
  { name: "config", path: "config", excludedPaths: [], dependencies: [] },
  {
    name: "utils",
    path: "packages/utils",
    excludedPaths: [],
    dependencies: ["config"],
  },
  {
    name: "framework",
    path: "packages/framework",
    excludedPaths: [],
    dependencies: ["utils"],
  },
];

const everyPackage = ["root", "config", "utils", "framework"];

const clonePaths = {
  "byro-repo": ".",
  utils: "packages/utils",
  framework: "packages/framework",
};

const rootTrackedFiles: Record<string, string> = {
  "package.json": "{}\n",
  "config/README.md": "# config\n",
};

let fixture: GitFixture;
let temp: string;
let root: string;
let stateFolder: string;
let stampFolder: string;
let heldPids: (number | undefined)[];

beforeAll(() => {
  fixture = GitFixture.init(clonePaths, {
    gitignoreOf: (repo) =>
      repo === "byro-repo" ? "packages/*\npackage-lock.json\n" : "",
    trackedFilesOf: (repo) => (repo === "byro-repo" ? rootTrackedFiles : {}),
    addUntracked: (primaryRoot) =>
      writeFileSync(join(primaryRoot, "package-lock.json"), "lock 1"),
  });
});

afterAll(() => {
  fixture.remove();
});

beforeEach(() => {
  temp = realpathSync(mkdtempSync(join(tmpdir(), "checks-")));
  root = join(temp, "byro-repo");
  stateFolder = join(temp, ".runner");
  stampFolder = join(stateFolder, "check-stamps");
  heldPids = [];
  fixture.copyTo(temp);
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
    packages,
    sharedPaths: ["package.json"],
    commandEnvOf: (packageNames) => ({
      CHECK_PACKAGES: packageNames.join(","),
    }),
    stateFolder,
    nodeVersion: "v22.0.0",
    slot: { pollMs: 10, sleep, onHeld: (pid) => heldPids.push(pid) },
    ...overrides,
  });
}

function writeLockfile(content: string): void {
  writeFileSync(join(root, "package-lock.json"), content);
}

// Commits a change to one file, from inside the folder that holds it.
function commitChange(path: string): void {
  const file = join(root, path);
  writeFileSync(file, "# changed\n");
  git(join(file, ".."), "commit", "-am", "Change");
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

function stampedPackages(): string[] {
  if (!existsSync(stampFolder)) return [];
  return everyPackage.filter(
    (name) =>
      existsSync(join(stampFolder, name)) &&
      readdirSync(join(stampFolder, name)).length > 0,
  );
}

function sleeping(seconds: number): Command {
  return ["sh", "-c", `sleep ${seconds}`];
}

function durationsOf(result: CheckResult): CommandDuration[] {
  if (result.kind === "skipped") throw new Error("A skip has no durations.");
  return result.durations;
}

function stampContentsOf(name: string): unknown[] {
  const folder = join(stampFolder, name);
  return readdirSync(folder).map((stamp) =>
    JSON.parse(readFileSync(join(folder, stamp), "utf8")),
  );
}

// Leaves its own marker, then waits up to five seconds for the other's; only commands run at once both pass.
function waitingFor(own: string, other: string): Command {
  const script = `touch ${join(temp, own)}; i=0; while [ ! -f ${join(temp, other)} ]; do i=$((i+1)); [ $i -gt 100 ] && exit 1; sleep 0.05; done`;
  return ["sh", "-c", script];
}

// Writes the package list the command was narrowed to into a file in temp.
function recordingNarrowing(): Command {
  return ["sh", "-c", `echo "$CHECK_PACKAGES" > ${join(temp, "narrowed")}`];
}

function narrowing(): string {
  return readFileSync(join(temp, "narrowed"), "utf8").trim();
}

function slotPath(): string {
  return join(stateFolder, "check.slot");
}

function seedSlot(holder: Omit<LockHolder, "token">): void {
  mkdirSync(stateFolder, { recursive: true });
  seedHolder(slotPath(), holder);
}

async function stampEveryPackage(): Promise<void> {
  await checks([marking("a")]).run();
  clearMarkers("a");
}

describe("Checks.run", () => {
  it("passes and stamps every package when every command is green and every package clean", async () => {
    const result = await checks([marking("a"), marking("b")]).run();

    expect(result).toMatchObject({
      kind: "passed",
      checked: everyPackage,
      skipped: [],
      stamped: everyPackage,
    });
    expect(stampedPackages()).toEqual(everyPackage);
  });

  it("fails with the red command's output and writes no stamp", async () => {
    const result = await checks([marking("a"), marking("b", 1)]).run();

    expect(result).toMatchObject({
      kind: "failed",
      checked: everyPackage,
      failures: [{ command: marking("b", 1), output: "b says hello" }],
    });
    expect(stampedPackages()).toEqual([]);
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

  it("checks but doesn't stamp a package with an uncommitted change or its dependents, and stamps the clean packages beside it", async () => {
    writeFileSync(join(root, "packages/utils/README.md"), "# edited\n");

    const result = await checks([marking("a")]).run();

    expect(result).toMatchObject({
      kind: "passed",
      checked: everyPackage,
      stamped: ["root", "config"],
    });
    expect(hasRun("a")).toBe(true);
    expect(stampedPackages()).toEqual(["root", "config"]);
  });

  it("checks a package with an uncommitted change again, though its stamp is there", async () => {
    await stampEveryPackage();
    writeFileSync(join(root, "packages/framework/README.md"), "# edited\n");

    const result = await checks([marking("a")]).run();

    expect(result).toMatchObject({
      kind: "passed",
      checked: ["framework"],
      skipped: ["root", "config", "utils"],
    });
    expect(hasRun("a")).toBe(true);
  });

  it("doesn't stamp the root package for an untracked file of its own, and stamps the packages beside it", async () => {
    writeFileSync(join(root, "new.txt"), "new\n");

    const result = await checks([marking("a")]).run();

    expect(result).toMatchObject({
      kind: "passed",
      stamped: ["config", "utils", "framework"],
    });
    expect(stampedPackages()).toEqual(["config", "utils", "framework"]);
  });

  it("stamps no package while a shared root file has an uncommitted change", async () => {
    writeFileSync(join(root, "package.json"), '{ "edited": true }\n');

    const result = await checks([marking("a")]).run();

    expect(result).toMatchObject({ kind: "passed", stamped: [] });
    expect(stampedPackages()).toEqual([]);
  });

  it("doesn't stamp the package whose tracked file a command changes", async () => {
    const editing: Command = [
      "sh",
      "-c",
      `echo edited > ${join(root, "README.md")}`,
    ];

    const result = await checks([editing]).run();

    expect(result).toMatchObject({
      kind: "passed",
      stamped: ["config", "utils", "framework"],
    });
    expect(stampedPackages()).toEqual(["config", "utils", "framework"]);
  });

  it("doesn't stamp a package, or its dependents, when a commit lands in it while the commands run", async () => {
    const committing: Command = [
      "sh",
      "-c",
      `cd ${join(root, "packages/utils")} && echo changed > README.md && git commit -qam Change`,
    ];

    const result = await checks([committing]).run();

    expect(result).toMatchObject({
      kind: "passed",
      stamped: ["root", "config"],
    });
    expect(stampedPackages()).toEqual(["root", "config"]);
  });

  it("runs no command when every package has a matching stamp", async () => {
    await checks([marking("a"), marking("b")]).run();
    clearMarkers("a", "b");

    const result = await checks([marking("a"), marking("b")]).run();

    expect(result).toEqual({ kind: "skipped" });
    expect([hasRun("a"), hasRun("b")]).toEqual([false, false]);
  });

  it("checks every package despite their stamps when fresh, and the pass stamps", async () => {
    await stampEveryPackage();

    const result = await checks([marking("a")]).run({ isFresh: true });

    expect(result).toMatchObject({
      kind: "passed",
      checked: everyPackage,
      skipped: [],
      stamped: everyPackage,
    });
    expect(hasRun("a")).toBe(true);
  });

  it("puts back only a clone package and its dependents after a commit in it", async () => {
    await stampEveryPackage();
    commitChange("packages/utils/README.md");

    const result = await checks([marking("a")]).run();

    expect(result).toMatchObject({
      kind: "passed",
      checked: ["utils", "framework"],
      skipped: ["root", "config"],
      stamped: ["utils", "framework"],
    });
    expect(hasRun("a")).toBe(true);
  });

  it("puts back only the root package after a commit to its own files", async () => {
    await stampEveryPackage();
    commitChange("README.md");

    const result = await checks([marking("a")]).run();

    expect(result).toMatchObject({
      kind: "passed",
      checked: ["root"],
      skipped: ["config", "utils", "framework"],
    });
  });

  it("puts back a folder package of the root repo and its dependents after a commit in it, but not the root package", async () => {
    await stampEveryPackage();
    commitChange("config/README.md");

    const result = await checks([marking("a")]).run();

    expect(result).toMatchObject({
      kind: "passed",
      checked: ["config", "utils", "framework"],
      skipped: ["root"],
    });
  });

  it("doesn't stamp a folder package with an uncommitted change, and stamps the root package around it", async () => {
    writeFileSync(join(root, "config/README.md"), "# edited\n");

    const result = await checks([marking("a")]).run();

    expect(result).toMatchObject({ kind: "passed", stamped: ["root"] });
    expect(stampedPackages()).toEqual(["root"]);
  });

  it("puts back every package after a commit to a shared root file", async () => {
    await stampEveryPackage();
    commitChange("package.json");

    const result = await checks([marking("a")]).run();

    expect(result).toMatchObject({ kind: "passed", checked: everyPackage });
  });

  it("puts back every package after the lockfile changes", async () => {
    await stampEveryPackage();
    writeLockfile("lock 2");

    const result = await checks([marking("a")]).run();

    expect(result).toMatchObject({ kind: "passed", checked: everyPackage });
    expect(hasRun("a")).toBe(true);
  });

  it("puts back every package under another Node version", async () => {
    await stampEveryPackage();

    const result = await checks([marking("a")], {
      nodeVersion: "v24.0.0",
    }).run();

    expect(result).toMatchObject({ kind: "passed", checked: everyPackage });
    expect(hasRun("a")).toBe(true);
  });

  it("narrows the commands to the packages being checked", async () => {
    await stampEveryPackage();
    commitChange("packages/utils/README.md");

    await checks([recordingNarrowing()]).run();

    expect(narrowing()).toBe("utils,framework");
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

  it("keeps a stamped pass's durations in each package's stamp", async () => {
    const result = await checks([marking("a"), marking("b")]).run();

    expect(stampContentsOf("utils")).toEqual([durationsOf(result)]);
    expect(stampContentsOf("root")).toEqual([durationsOf(result)]);
  });

  it("reports no durations on a skip and leaves the stamps as they were", async () => {
    await checks([marking("a")]).run();
    const stamped = stampContentsOf("framework");

    const result = await checks([marking("a")]).run();

    expect(result).toEqual({ kind: "skipped" });
    expect(stampContentsOf("framework")).toEqual(stamped);
  });

  it("makes a second check started at once wait, then skip on the first's stamps", async () => {
    const results = await Promise.all([
      checks([marking("a")]).run(),
      checks([marking("b")]).run(),
    ]);

    expect(results).toEqual([
      expect.objectContaining({ kind: "passed", stamped: everyPackage }),
      { kind: "skipped" },
    ]);
    expect(heldPids).toEqual([process.pid]);
    expect(hasRun("b")).toBe(false);
  });

  it("waits on a live holder until the slot is free", async () => {
    seedSlot(liveHolder());
    setTimeout(() => rmSync(slotPath(), { force: true }), 100);

    const result = await checks([marking("a")]).run();

    expect(result).toMatchObject({ kind: "passed", stamped: everyPackage });
    expect(heldPids).toEqual([process.pid]);
  });

  it("takes over a slot whose holder is no longer running", async () => {
    seedSlot({ ...liveHolder(), pid: deadPid() });

    const result = await checks([marking("a")]).run();

    expect(result).toMatchObject({ kind: "passed", stamped: everyPackage });
    expect(heldPids).toEqual([]);
  });

  it("releases the slot when the check passes", async () => {
    await checks([marking("a")]).run();

    expect(PidLock.isHeldAt(slotPath())).toBe(false);
  });

  it("releases the slot when the check fails", async () => {
    await checks([marking("a", 1)]).run();

    expect(PidLock.isHeldAt(slotPath())).toBe(false);
  });

  it("runs the commands at the same time", async () => {
    const result = await checks([
      waitingFor("left", "right"),
      waitingFor("right", "left"),
    ]).run();

    expect(result).toMatchObject({ kind: "passed", stamped: everyPackage });
  });
});
