import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { gmailGateDecisionAt } from "./inboxData.ts";

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
  root = mkdtempSync(join(tmpdir(), "inbox-data-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeInbox(checkout: string, proposalsText: string) {
  const inbox = join(checkout, "packages", "personal", "inbox");
  mkdirSync(inbox, { recursive: true });
  writeFileSync(join(inbox, "proposals.md"), proposalsText);
  writeFileSync(join(inbox, "changes.md"), "# Change log\n");
  return inbox;
}

describe("gmailGateDecisionAt", () => {
  it("allows a call a signed-off Proposal in the personal clone covers", () => {
    writeInbox(root, proposals);
    expect(gmailGateDecisionAt(root, archive)?.permissionDecision).toBe(
      "allow",
    );
  });

  it("asks when no Proposal covers the call", () => {
    writeInbox(root, proposals.replace("signed-off", "pending"));
    expect(gmailGateDecisionAt(root, archive)?.permissionDecision).toBe("ask");
  });

  it("asks when the personal folder is missing", () => {
    expect(gmailGateDecisionAt(root, archive)?.permissionDecision).toBe("ask");
  });

  it("asks when a data file can't be read", () => {
    const inbox = writeInbox(root, proposals);
    // A folder, not chmod 000, so the read fails even when tests run as root.
    rmSync(join(inbox, "proposals.md"));
    mkdirSync(join(inbox, "proposals.md"));
    expect(gmailGateDecisionAt(root, archive)?.permissionDecision).toBe("ask");
  });

  it("reads a workspace session's own copy, not the primary root's", () => {
    writeInbox(root, proposals.replace("signed-off", "pending"));
    const workspace = join(root, ".claude", "worktrees", "session-inbox");
    writeInbox(workspace, proposals);
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
