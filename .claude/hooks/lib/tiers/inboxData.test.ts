import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { gmailGateDecisionAt, inboxDataOf } from "./inboxData.ts";

const proposals = `# Proposals

## P1: Example deals archived
- kind: bulk
- query: from:deals@example.com
- action: remove INBOX
- status: signed-off
`;

const archive = {
  toolName: "mcp__gmail__batch_modify_gmail_message_labels",
  input: { message_ids: ["m1"], remove_label_ids: ["INBOX"] },
  mode: "interactive" as const,
};

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "inbox-data-")));
  git(root, "init", "-q", "-b", "master");
  git(root, "commit", "-q", "--allow-empty", "-m", "root");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]) {
  const result = spawnSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@t", ...args],
    { cwd },
  );
  if (result.status !== 0) throw new Error(result.stderr.toString());
}

function writeInbox(proposalsText: string) {
  const inbox = join(root, "packages", "personal", "inbox");
  mkdirSync(inbox, { recursive: true });
  writeFileSync(join(inbox, "proposals.md"), proposalsText);
  writeFileSync(join(inbox, "changes.md"), "# Change log\n");
  return inbox;
}

describe("gmailGateDecisionAt", () => {
  it("allows a call a signed-off Proposal in the personal clone covers", () => {
    writeInbox(proposals);
    expect(gmailGateDecisionAt(root, archive)?.permissionDecision).toBe(
      "allow",
    );
  });

  it("asks when no Proposal covers the call", () => {
    writeInbox(proposals.replace("signed-off", "pending"));
    expect(gmailGateDecisionAt(root, archive)?.permissionDecision).toBe("ask");
  });

  it("asks when the personal folder is missing", () => {
    expect(gmailGateDecisionAt(root, archive)?.permissionDecision).toBe("ask");
  });

  it("asks when a data file can't be read", () => {
    const inbox = writeInbox(proposals);
    chmodSync(join(inbox, "proposals.md"), 0o000);
    expect(gmailGateDecisionAt(root, archive)?.permissionDecision).toBe("ask");
  });

  it("reads the primary root's data from a session in a workspace", () => {
    writeInbox(proposals);
    const workspace = join(root, ".claude", "worktrees", "issue-1");
    git(root, "worktree", "add", "-q", workspace);
    expect(inboxDataOf(workspace)).toBe(
      join(root, "packages", "personal", "inbox"),
    );
    expect(gmailGateDecisionAt(workspace, archive)?.permissionDecision).toBe(
      "allow",
    );
  });

  it("leaves other tools alone", () => {
    expect(
      gmailGateDecisionAt(root, { ...archive, toolName: "Read" }),
    ).toBeUndefined();
  });
});
