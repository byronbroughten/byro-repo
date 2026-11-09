import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { git } from "./GitFixture.ts";
import { WrapUpFailure } from "./WrapUpFailure.ts";
import {
  commitFileIn,
  errorOf,
  primaryOf,
  remoteOf,
  useWrapUpHarness,
  workspaceWith,
  wrapUp,
} from "./wrapUpHarness.ts";

useWrapUpHarness();

const research = "research/sheets-quotas";
const secretLine = `{"client_id":"x","client_secret"` + `: "GOCSPX-abc"}\n`;

async function checkoutOn(branch: string): Promise<string> {
  const workspace = await workspaceWith();
  git(workspace.path, "switch", "-c", branch);
  return workspace.path;
}

function remoteHeadOf(branch: string): string | undefined {
  try {
    return execFileSync(
      "git",
      ["--git-dir", remoteOf("byro-repo"), "rev-parse", `refs/heads/${branch}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return undefined;
  }
}

function remoteBranches(): string {
  return git(remoteOf("byro-repo"), "for-each-ref", "--format=%(refname)");
}

describe("WrapUp.pushResearch", () => {
  it("pushes the checkout's research branch to origin, setting its upstream", async () => {
    const checkout = await checkoutOn(research);
    commitFileIn(checkout, "notes.md", "# Sheets quotas\n");

    expect(await wrapUp().pushResearch(checkout)).toBe(research);

    expect(remoteHeadOf(research)).toBe(git(checkout, "rev-parse", "HEAD"));
    expect(git(checkout, "rev-parse", "--abbrev-ref", "@{upstream}")).toBe(
      `origin/${research}`,
    );
  });

  it("pushes a later commit onto the branch it pushed before", async () => {
    const checkout = await checkoutOn(research);
    commitFileIn(checkout, "notes.md", "# Sheets quotas\n");
    await wrapUp().pushResearch(checkout);
    commitFileIn(checkout, "more.md", "More\n");

    await wrapUp().pushResearch(checkout);

    expect(remoteHeadOf(research)).toBe(git(checkout, "rev-parse", "HEAD"));
  });

  it.each([
    ["master", ["switch", "--ignore-other-worktrees", "master"]],
    ["the workspace's issue branch", ["status"]],
    ["another branch", ["switch", "-c", "notes/research"]],
  ])("refuses %s and leaves the remote unchanged", async (_label, args) => {
    const before = remoteBranches();
    const remoteMaster = remoteHeadOf("master");
    const workspace = await workspaceWith();
    git(workspace.path, ...args);
    commitFileIn(workspace.path, "notes.md", "Notes\n");

    const refusal = await errorOf(wrapUp().pushResearch(workspace.path));

    expect(refusal.message).toContain("not under `research/`");
    expect(remoteBranches()).toBe(before);
    expect(remoteHeadOf("master")).toBe(remoteMaster);
  });

  it("refuses a primary checkout", async () => {
    const primary = primaryOf("byro-repo");
    git(primary, "switch", "-c", research);
    commitFileIn(primary, "notes.md", "Notes\n");

    const refusal = await errorOf(wrapUp().pushResearch(primary));

    expect(refusal.message).toContain("primary checkout");
    expect(remoteHeadOf(research)).toBeUndefined();
  });

  it("refuses a planted secret at secret-scan, naming the file and line, and pushes nothing", async () => {
    const checkout = await checkoutOn(research);
    commitFileIn(checkout, "notes.md", "# Notes\n");
    commitFileIn(checkout, "creds.json", secretLine);

    const refusal = await errorOf(wrapUp().pushResearch(checkout));

    expect(refusal).toBeInstanceOf(WrapUpFailure);
    expect((refusal as WrapUpFailure).kind).toBe("secret-scan");
    expect(refusal.message).toContain(
      "byro-repo creds.json:1 (OAuth client secret)",
    );
    expect(remoteHeadOf(research)).toBeUndefined();
  });

  it("refuses a secret a later commit removes, naming the file and line, and pushes nothing", async () => {
    const checkout = await checkoutOn(research);
    commitFileIn(checkout, "creds.json", secretLine);
    commitFileIn(checkout, "creds.json", "{}\n");

    const refusal = await errorOf(wrapUp().pushResearch(checkout));

    expect((refusal as WrapUpFailure).kind).toBe("secret-scan");
    expect(refusal.message).toContain(
      "byro-repo creds.json:1 (OAuth client secret)",
    );
    expect(remoteHeadOf(research)).toBeUndefined();
  });

  it("scans only what the push adds over the remote branch", async () => {
    const checkout = await checkoutOn(research);
    commitFileIn(checkout, "creds.json", secretLine);
    git(checkout, "push", "origin", research);
    const pushed = remoteHeadOf(research);
    commitFileIn(checkout, "notes.md", "# Notes\n");

    await wrapUp().pushResearch(checkout);

    expect(remoteHeadOf(research)).not.toBe(pushed);
  });
});
