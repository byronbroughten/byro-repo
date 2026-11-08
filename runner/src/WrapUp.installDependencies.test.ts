import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { git } from "./GitFixture.ts";
import { type Command } from "./runKnobs.ts";
import {
  commitFileIn,
  commitIn,
  failureOf,
  primaryOf,
  primaryRoot,
  remoteOf,
  subjectsOf,
  temp,
  ticket,
  useWrapUpHarness,
  workspaceWith,
  wrapUp,
  writeFacts,
} from "./wrapUpHarness.ts";

useWrapUpHarness();

const manifest = "package.json";
const withDependency = JSON.stringify({ dependencies: { "sh-syntax": "^1" } });
const withScript = JSON.stringify({ scripts: { test: "vitest" } });

async function landedWorkspace(): Promise<string> {
  const workspace = await workspaceWith();
  commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
  writeFacts();
  return workspace.path;
}

function installMarker(): string {
  return join(temp, "installed");
}

function failsUntilInstalled(): Command {
  return ["test", "-f", installMarker()];
}

describe("installDependencies", () => {
  it("installs in the workspace before the checks and in the primary after the fast-forward when master adds a dependency", async () => {
    const workspace = await workspaceWith(["sheets-framework"]);
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    commitIn(workspace, "sheets-framework", manifest, withDependency);
    writeFacts();
    commitFileIn(primaryOf("byro-repo"), manifest, withDependency);
    const roots: string[] = [];

    await wrapUp({
      checks: [failsUntilInstalled()],
      async installDependencies(root) {
        roots.push(root);
        writeFileSync(installMarker(), "");
      },
    }).run(ticket);

    expect(roots).toEqual([workspace.path, primaryRoot]);
  });

  it("sees a dependency change in a nested package.json", async () => {
    const workspace = await workspaceWith(["sheets-framework"]);
    commitIn(workspace, "sheets-framework", "lib.ts", "export {};\n");
    writeFacts();
    commitFileIn(primaryOf("sheets-framework"), manifest, withDependency);
    const roots: string[] = [];

    await wrapUp({
      async installDependencies(root) {
        roots.push(root);
      },
    }).run(ticket);

    expect(roots).toEqual([workspace.path]);
  });

  it("installs only in the primary when the branch itself adds the dependency", async () => {
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", manifest, withDependency);
    writeFacts();
    const roots: string[] = [];

    await wrapUp({
      async installDependencies(root) {
        roots.push(root);
      },
    }).run(ticket);

    expect(roots).toEqual([primaryRoot]);
  });

  it("installs nothing for a landing with no dependency change", async () => {
    await landedWorkspace();
    const roots: string[] = [];

    await wrapUp({
      async installDependencies(root) {
        roots.push(root);
      },
    }).run(ticket);

    expect(roots).toEqual([]);
  });

  it("installs nothing when package.json changes outside the dependency fields", async () => {
    await landedWorkspace();
    commitFileIn(primaryOf("byro-repo"), manifest, withScript);
    const roots: string[] = [];

    await wrapUp({
      async installDependencies(root) {
        roots.push(root);
      },
    }).run(ticket);

    expect(roots).toEqual([]);
  });

  it("stops the landing with the install kind when the workspace install fails", async () => {
    await landedWorkspace();
    commitFileIn(primaryOf("byro-repo"), manifest, withDependency);

    const kind = await failureOf(
      wrapUp({
        async installDependencies() {
          throw new Error("registry down");
        },
      }).run(ticket),
    );

    expect(kind).toBe("install");
    expect(subjectsOf("byro-repo")).not.toContain("Add script.ts");
  });

  it("only warns when the primary install fails", async () => {
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", manifest, withDependency);
    writeFacts();
    const lines: string[] = [];

    await wrapUp({
      async installDependencies() {
        throw new Error("registry down");
      },
      log: (line) => lines.push(line),
    }).run(ticket);

    expect(lines).toContain(
      `Warning: the dependency install failed in ${primaryRoot}, continuing; run npm install --ignore-scripts in the primary root before the next check: registry down`,
    );
    expect(git(remoteOf("byro-repo"), "rev-parse", "master")).toBe(
      git(primaryOf("byro-repo"), "rev-parse", "master"),
    );
  });
});
