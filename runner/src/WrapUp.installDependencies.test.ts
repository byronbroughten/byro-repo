import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { git } from "./GitFixture.ts";
import { type Command } from "./runKnobs.ts";
import { type WrapUpConfig } from "./WrapUp.ts";
import { WrapUpFailure } from "./WrapUpFailure.ts";
import {
  commitFileIn,
  commitIn,
  errorOf,
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

async function landedWorkspace(): Promise<void> {
  const workspace = await workspaceWith();
  commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
  writeFacts();
}

function installMarker(): string {
  return join(temp, "installed");
}

function failsUntilInstalled(): Command {
  return ["test", "-f", installMarker()];
}

function recordingInstall(): Required<
  Pick<WrapUpConfig, "installDependencies">
> & { roots: string[] } {
  const roots: string[] = [];
  return {
    roots,
    async installDependencies(root) {
      roots.push(root);
    },
  };
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

  it("sees a dependency change in a member clone's package.json", async () => {
    const workspace = await workspaceWith(["sheets-framework"]);
    commitIn(workspace, "sheets-framework", "lib.ts", "export {};\n");
    writeFacts();
    commitFileIn(primaryOf("sheets-framework"), manifest, withDependency);
    const { roots, installDependencies } = recordingInstall();

    await wrapUp({ installDependencies }).run(ticket);

    expect(roots).toEqual([workspace.path]);
  });

  it("installs only in the primary when the branch itself adds the dependency", async () => {
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", manifest, withDependency);
    writeFacts();
    const { roots, installDependencies } = recordingInstall();

    await wrapUp({ installDependencies }).run(ticket);

    expect(roots).toEqual([primaryRoot]);
  });

  it("installs nothing for a landing with no dependency change", async () => {
    await landedWorkspace();
    const { roots, installDependencies } = recordingInstall();

    await wrapUp({ installDependencies }).run(ticket);

    expect(roots).toEqual([]);
  });

  it("installs nothing when package.json changes outside the dependency fields", async () => {
    await landedWorkspace();
    commitFileIn(primaryOf("byro-repo"), manifest, withScript);
    const { roots, installDependencies } = recordingInstall();

    await wrapUp({ installDependencies }).run(ticket);

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

  it("doesn't report an unreadable package.json as a failed install", async () => {
    await landedWorkspace();
    commitFileIn(primaryOf("byro-repo"), manifest, "not json");
    const { roots, installDependencies } = recordingInstall();

    const error = await errorOf(wrapUp({ installDependencies }).run(ticket));

    expect(error).not.toBeInstanceOf(WrapUpFailure);
    expect(roots).toEqual([]);
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
      `Warning: continuing without the dependency install; run npm install --ignore-scripts in the primary root before the next check: npm install --ignore-scripts failed in ${primaryRoot}: registry down`,
    );
    expect(git(remoteOf("byro-repo"), "rev-parse", "master")).toBe(
      git(primaryOf("byro-repo"), "rev-parse", "master"),
    );
  });
});
