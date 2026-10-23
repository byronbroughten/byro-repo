// `npm run tsc`: every type-check program at once, the root's and each `&&` part of a workspace's own tsc script.
// Prints each program's output under its label, then fails when any program does.
import { existsSync, globSync, readFileSync } from "node:fs";
import { delimiter, join, relative } from "node:path";

import { runCollecting } from "@byronbroughten/spec-runner/runCollecting";

interface Program {
  cwd: string;
  command: string;
}

interface Outcome {
  label: string;
  isOk: boolean;
  output: string;
}

const root = join(import.meta.dirname, "../..");

const programs: Program[] = [
  { cwd: root, command: "tsc -p ." },
  ...workspaceFolders().flatMap((cwd) =>
    tscScriptOf(cwd)
      .split("&&")
      .map((command) => ({ cwd, command: command.trim() })),
  ),
];

const outcomes = await Promise.all(programs.map(outcomeOf));
outcomes
  .filter(({ output }) => output !== "")
  .forEach(({ label, output }) => console.log(`--- ${label} ---\n${output}`));
const failed = outcomes.filter(({ isOk }) => !isOk);
if (failed.length > 0) {
  console.error(`tsc failed: ${failed.map(({ label }) => label).join("; ")}`);
  process.exitCode = 1;
}

function workspaceFolders(): string[] {
  const { workspaces } = readJson(join(root, "package.json")) as {
    workspaces: string[];
  };
  return workspaces
    .flatMap((pattern) => globSync(pattern, { cwd: root }))
    .map((folder) => join(root, folder))
    .filter((folder) => existsSync(join(folder, "package.json")));
}

function tscScriptOf(folder: string): string {
  const { scripts } = readJson(join(folder, "package.json")) as {
    scripts?: Record<string, string>;
  };
  return scripts?.tsc ?? "";
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function outcomeOf({ cwd, command }: Program): Promise<Outcome> {
  const label = `${relative(root, cwd) || "."}: ${command}`;
  // The workspace's own bin folder first, as `npm run` would put it.
  const pathValue = [join(cwd, "node_modules/.bin"), process.env.PATH].join(
    delimiter,
  );
  const run = await runCollecting("sh", ["-c", command], {
    cwd,
    env: { ...process.env, PATH: pathValue },
  });
  return { label, ...run };
}
