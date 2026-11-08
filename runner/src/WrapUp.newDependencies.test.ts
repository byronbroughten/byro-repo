import { describe, expect, it } from "vitest";

import { IssueWorkspaces, type Workspace } from "./IssueWorkspaces.ts";
import { WrapUpFailure } from "./WrapUpFailure.ts";
import {
  commitFileIn,
  commitIn,
  errorOf,
  failureOf,
  github,
  primaryOf,
  subjectsOf,
  ticket,
  useWrapUpHarness,
  workspacesConfig,
  workspaceWith,
  wrapUp,
  writeFacts,
} from "./wrapUpHarness.ts";

useWrapUpHarness();

const manifest = "package.json";
const session = "add-a-package";
const scopedAndPlain = JSON.stringify({
  dependencies: { "@scope/pkg": "^1" },
  devDependencies: { "left-pad": "^1" },
});

function manifestWith(dependencies: Record<string, string>): string {
  return JSON.stringify({ dependencies });
}

async function ticketAdding(
  text: string,
  repo: "byro-repo" | "sheets-framework" = "byro-repo",
): Promise<void> {
  const workspace = await workspaceWith(["sheets-framework"]);
  commitIn(workspace, repo, manifest, text);
  writeFacts();
}

async function sessionAdding(text: string): Promise<Workspace> {
  const workspace = await IssueWorkspaces.init(workspacesConfig()).create({
    session,
  });
  commitIn(workspace, "byro-repo", manifest, text);
  return workspace;
}

describe("run", () => {
  it("lands a package the ticket's section lists", async () => {
    await ticketAdding(manifestWith({ "left-pad": "^1" }));
    github.bodies.set(
      ticket.number,
      "## What to build\n\n## New dependencies\n\n- left-pad\n\n## Model fit\n",
    );

    await wrapUp().run(ticket);

    expect(subjectsOf("byro-repo")).toContain(`Add ${manifest}`);
  });

  it("reads backticked, scoped names from a body with Windows line ends", async () => {
    await ticketAdding(scopedAndPlain);
    github.bodies.set(
      ticket.number,
      "## New dependencies\r\n\r\n- `@scope/pkg`\r\n- left-pad\r\n",
    );

    await wrapUp().run(ticket);

    expect(subjectsOf("byro-repo")).toContain(`Add ${manifest}`);
  });

  it("refuses an unlisted package with the new-dependency kind and merges nothing", async () => {
    await ticketAdding(manifestWith({ "left-pad": "^1" }), "sheets-framework");

    const error = await errorOf(wrapUp().run(ticket));

    expect(error).toBeInstanceOf(WrapUpFailure);
    expect((error as WrapUpFailure).kind).toBe("new-dependency");
    expect(error.message).toBe(
      "The change adds packages nothing names, so nothing was merged:\nsheets-framework package.json adds left-pad\nAdd each to the ticket's `## New dependencies` section as a `- <name>` line and rerun, or drop it from the change.",
    );
    expect(subjectsOf("sheets-framework")).not.toContain(`Add ${manifest}`);
  });

  it("doesn't take a bullet under the next heading as a listed name", async () => {
    await ticketAdding(manifestWith({ "left-pad": "^1" }));
    github.bodies.set(
      ticket.number,
      "## New dependencies\n\n- other\n\n## Notes\n\n- left-pad\n",
    );

    expect(await failureOf(wrapUp().run(ticket))).toBe("new-dependency");
  });

  it("lands a ticket with no section that adds no package", async () => {
    const workspace = await workspaceWith();
    commitIn(workspace, "byro-repo", "script.ts", "export {};\n");
    writeFacts();

    await wrapUp().run(ticket);

    expect(subjectsOf("byro-repo")).toContain("Add script.ts");
  });

  it("lands a version change and a removal the ticket doesn't list", async () => {
    commitFileIn(
      primaryOf("byro-repo"),
      manifest,
      manifestWith({ "left-pad": "^1", "right-pad": "^1" }),
    );
    await ticketAdding(manifestWith({ "left-pad": "^2" }));

    await wrapUp().run(ticket);

    expect(subjectsOf("byro-repo")).toContain(`Add ${manifest}`);
  });

  it("lands once the section names the refused package on a rerun", async () => {
    await ticketAdding(manifestWith({ "left-pad": "^1" }));
    await failureOf(wrapUp().run(ticket));
    github.bodies.set(ticket.number, "## New dependencies\n- left-pad\n");

    await wrapUp().run(ticket);

    expect(subjectsOf("byro-repo")).toContain(`Add ${manifest}`);
  });
});

describe("runSession", () => {
  it("lands a package passed as a new dependency", async () => {
    await sessionAdding(manifestWith({ "left-pad": "^1" }));

    await wrapUp().runSession(session, { newDependencies: ["left-pad"] });

    expect(subjectsOf("byro-repo")).toContain(`Add ${manifest}`);
  });

  it("refuses a package not passed, naming the flag, and merges nothing", async () => {
    await sessionAdding(manifestWith({ "left-pad": "^1" }));

    const error = await errorOf(wrapUp().runSession(session));

    expect((error as WrapUpFailure).kind).toBe("new-dependency");
    expect(error.message).toBe(
      "The change adds packages nothing names, so nothing was merged:\nbyro-repo package.json adds left-pad\nPass `--new-dependency <name>` for each to the wrap-up, or drop it from the change.",
    );
    expect(subjectsOf("byro-repo")).not.toContain(`Add ${manifest}`);
  });
});

describe("keepSession", () => {
  it("lands a package passed as a new dependency", async () => {
    await sessionAdding(manifestWith({ "left-pad": "^1" }));

    await wrapUp().keepSession(session, { newDependencies: ["left-pad"] });

    expect(subjectsOf("byro-repo")).toContain(`Add ${manifest}`);
  });
});
