import { describe, expect, it } from "vitest";

import { gmailGateDecision, unreadableDataDecision } from "./gmailGate.ts";
import type { SessionMode } from "./tiers.ts";

const proposals = `# Proposals

## P1: Example news filed under a new label, kept in the Inbox
- kind: filter
- query: from:news@example.com
- action: add Reading/Example (new label, created on apply); keep INBOX
- status: signed-off

## P2: Example deals archived
- kind: filter
- query: from:(deals@example.com OR promo@example.org) subject:(sale OR offer)
- action: add Label_42 (Shopping); remove INBOX
- status: signed-off

## P3: Old receipts trashed
- kind: bulk
- query: from:receipts@example.com older_than:1y
- action: add TRASH
- status: pending

## P4: Example digest archived
- kind: filter
- query: from:digest@example.com
- action: remove INBOX
- status: applied

## P5: The rest of Example news, archived under the same label
- kind: filter
- query: from:news@example.com -"top story"
- action: add Reading/Example; remove INBOX. A later Proposal swaps this for TRASH.
- status: signed-off
`;

const changes = `# Change log

## 2026-01-01T00:00:00Z: P1
- tool: manage_gmail_label create
- changed: created label Reading/Example (id Label_7)
- reverse: manage_gmail_label delete label_id Label_7 (removes no mail)
`;

function decisionOf(
  toolName: string,
  input: Record<string, unknown>,
  mode: SessionMode = "interactive",
) {
  return gmailGateDecision({
    toolName: `mcp__gmail__${toolName}`,
    input,
    proposals,
    changes,
    mode,
  });
}

describe("gmailGateDecision", () => {
  it("allows a filter whose criteria and labels a signed-off Proposal names", () => {
    const decision = decisionOf("manage_gmail_filter", {
      action: "create",
      criteria: {
        from: "deals@example.com OR promo@example.org",
        subject: "sale OR offer",
      },
      filter_action: { addLabelIds: ["Label_42"], removeLabelIds: ["INBOX"] },
    });
    expect(decision?.permissionDecision).toBe("allow");
    expect(decision?.reason).toContain("P2");
  });

  it("allows a label a signed-off Proposal creates, and its id once changes.md records it", () => {
    expect(
      decisionOf("manage_gmail_label", {
        action: "create",
        name: "Reading/Example",
      })?.permissionDecision,
    ).toBe("allow");
    expect(
      decisionOf("manage_gmail_filter", {
        action: "create",
        criteria: { from: "news@example.com" },
        filter_action: { addLabelIds: ["Label_7"] },
      })?.permissionDecision,
    ).toBe("allow");
  });

  it("allows a label another Proposal created, named in this one's add clause", () => {
    const decision = decisionOf("manage_gmail_filter", {
      action: "create",
      criteria: { from: "news@example.com", negatedQuery: '"top story"' },
      filter_action: { addLabelIds: ["Label_7"], removeLabelIds: ["INBOX"] },
    });
    expect(decision?.reason).toContain("P5");
    expect(decision?.permissionDecision).toBe("allow");
  });

  it("asks when the call removes a label the Proposal keeps", () => {
    expect(
      decisionOf("manage_gmail_filter", {
        action: "create",
        criteria: { from: "news@example.com" },
        filter_action: { addLabelIds: ["Label_7"], removeLabelIds: ["TRASH"] },
      })?.permissionDecision,
    ).toBe("ask");
  });

  it("asks for criteria no signed-off Proposal's query holds", () => {
    expect(
      decisionOf("manage_gmail_filter", {
        action: "create",
        criteria: { from: "stranger@example.net" },
        filter_action: { addLabelIds: ["Label_42"] },
      })?.permissionDecision,
    ).toBe("ask");
  });

  it("asks for a filter action beyond adding and removing labels", () => {
    expect(
      decisionOf("manage_gmail_filter", {
        action: "create",
        criteria: { from: "deals@example.com OR promo@example.org" },
        filter_action: { addLabelIds: ["Label_42"], forward: "x@example.net" },
      })?.permissionDecision,
    ).toBe("ask");
  });

  it("asks for a Proposal that is pending or already applied", () => {
    expect(
      decisionOf("batch_modify_gmail_message_labels", {
        message_ids: ["m1"],
        add_label_ids: ["TRASH"],
      })?.permissionDecision,
    ).toBe("ask");
    expect(
      decisionOf("manage_gmail_filter", {
        action: "create",
        criteria: { from: "digest@example.com" },
        filter_action: { removeLabelIds: ["INBOX"] },
      })?.permissionDecision,
    ).toBe("ask");
  });

  it("asks for a bulk change under a filter Proposal", () => {
    expect(
      decisionOf("batch_modify_gmail_message_labels", {
        message_ids: ["m1"],
        add_label_ids: ["Label_42"],
        remove_label_ids: ["INBOX"],
      })?.permissionDecision,
    ).toBe("ask");
  });

  it("denies marking mail as spam", () => {
    expect(
      decisionOf("modify_gmail_message_labels", {
        message_id: "m1",
        add_label_ids: ["SPAM"],
      })?.permissionDecision,
    ).toBe("deny");
  });

  it("denies instead of asking in a runner step", () => {
    const decision = decisionOf(
      "manage_gmail_label",
      { action: "delete", label_id: "Label_42" },
      "runnerStep",
    );
    expect(decision?.permissionDecision).toBe("deny");
    expect(unreadableDataDecision("interactive").permissionDecision).toBe(
      "ask",
    );
  });

  it("leaves other tools alone", () => {
    expect(
      decisionOf("search_gmail_messages", { query: "in:inbox" }),
    ).toBeUndefined();
  });
});
