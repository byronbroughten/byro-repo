import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  deliverableDocIds,
  docGrantDecision,
  governingIssue,
  grantedDocWrites,
  grantedIssueOf,
  implementPieceIssue,
} from "./docGrants.ts";

const docId = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd";

describe("implementPieceIssue", () => {
  it("reads the issue number from a typed /implement-piece", () => {
    expect(implementPieceIssue("/implement-piece 12")).toBe(12);
    expect(implementPieceIssue("  /implement-piece #12")).toBe(12);
    expect(implementPieceIssue("/implement-piece https://github.com/byronbroughten/writing/issues/12")).toBe(12);
  });

  it("ignores any other prompt", () => {
    expect(implementPieceIssue("please /implement-piece 12")).toBeUndefined();
    expect(implementPieceIssue("/implement-piece")).toBeUndefined();
    expect(implementPieceIssue("/review-piece 12")).toBeUndefined();
    expect(implementPieceIssue(undefined)).toBeUndefined();
  });
});

describe("deliverableDocIds", () => {
  it("finds the Doc ID in the Deliverable section only", () => {
    const body = `## Solution\n\nsee ${"x".repeat(30)}\n\n## Deliverable\n\nMy piece, Doc ID ${docId}. Standing yes.\n\n## References\n\nPaper, Drive ID ${"y".repeat(30)}\n`;
    expect(deliverableDocIds(body)).toEqual([docId]);
  });

  it("finds a Doc ID in a URL, and in a Deliverable that ends the body", () => {
    expect(deliverableDocIds(`## Deliverable\nhttps://docs.google.com/document/d/${docId}/edit`)).toEqual([docId]);
  });

  it("finds nothing when there is no Deliverable section or ID", () => {
    expect(deliverableDocIds("## Solution\n\nno doc")).toEqual([]);
    expect(deliverableDocIds("## Deliverable\n\nTBD\n")).toEqual([]);
  });
});

describe("tickets", () => {
  const ticket = `## Parent\n\n#7\n\n## What to write\n\nSection A\n\n## Shared rules\n\nDeliverable: Doc ID ${docId}, standing yes.\n\n## Facts\n`;

  it("takes the Doc ID from Shared rules", () => {
    expect(deliverableDocIds(ticket)).toEqual([docId]);
  });

  it("is governed by its parent spec, or by itself with no Parent section", () => {
    expect(governingIssue(12, ticket)).toBe(7);
    expect(governingIssue(12, "## Parent\n\nhttps://github.com/byronbroughten/writing/issues/9\n")).toBe(9);
    expect(governingIssue(12, "## Deliverable\n\nx")).toBe(12);
  });
});

describe("grantedIssueOf", () => {
  it("looks a Doc up by its own key only", () => {
    expect(grantedIssueOf({ [docId]: 12 }, docId)).toBe(12);
    expect(grantedIssueOf({ [docId]: 12 }, "other")).toBeUndefined();
    expect(grantedIssueOf({}, "toString")).toBeUndefined();
    expect(grantedIssueOf({ [docId]: 12 }, undefined)).toBeUndefined();
  });
});

describe("docGrantDecision", () => {
  const toolName = "mcp__gworkspace__batch_update_doc";

  it("allows a write to a granted Doc while the issue is open", () => {
    const decision = docGrantDecision({ toolName, grantedIssue: 12, issueState: "OPEN" });
    expect(decision?.permissionDecision).toBe("allow");
    expect(decision?.reason).toMatch(/#12/);
  });

  it("leaves the default for a closed issue or one gh could not read", () => {
    expect(docGrantDecision({ toolName, grantedIssue: 12, issueState: "CLOSED" })).toBeUndefined();
    expect(docGrantDecision({ toolName, grantedIssue: 12, issueState: undefined })).toBeUndefined();
  });

  it("leaves the default for an ungranted Doc or an unguarded tool", () => {
    expect(docGrantDecision({ toolName, grantedIssue: undefined, issueState: "OPEN" })).toBeUndefined();
    expect(
      docGrantDecision({ toolName: "mcp__gworkspace__create_doc", grantedIssue: 12, issueState: "OPEN" }),
    ).toBeUndefined();
  });
});

describe("grantedDocWrites", () => {
  it("matches the Doc write names in settings.json's hook matcher", () => {
    const settings = JSON.parse(readFileSync(new URL("../../settings.json", import.meta.url), "utf8"));
    const matchers: string[] = settings.hooks.PreToolUse.map((entry: { matcher: string }) => entry.matcher);
    const matcher = matchers.find((names) => names.includes("update_paragraph_style"));
    expect(new Set(matcher?.split("|"))).toEqual(grantedDocWrites);
  });
});
