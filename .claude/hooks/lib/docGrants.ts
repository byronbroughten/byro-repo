// Decides the Deliverable grant: a Doc write is allowed on a Doc a user-typed /implement-piece named, while that spec's issue is open. Pure; docGrantGuard.ts does the I/O.
import type { Decision } from "./pinnedTargets.ts";

// The gworkspace Doc writes that take a document_id; settings.json's hook matcher lists the same names.
export const grantedDocWrites = new Set([
  "mcp__gworkspace__modify_doc_text",
  "mcp__gworkspace__find_and_replace_doc",
  "mcp__gworkspace__insert_doc_elements",
  "mcp__gworkspace__batch_update_doc",
  "mcp__gworkspace__update_paragraph_style",
]);

// Doc ID to the number of the spec issue whose Deliverable it is.
export type DocGrants = Record<string, number>;

export interface DocWrite {
  toolName: string | undefined;
  grantedIssue: number | undefined;
  issueState: string | undefined;
}

const implementPiecePrompt = /^\s*\/implement-piece\s+(?:\S*\/issues\/|#)?(\d+)\b/;
const idSections = /^## (?:Deliverable|Shared rules)\s*$([\s\S]*?)(?=^## |(?![\s\S]))/gm;
const parentSection = /^## Parent\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m;
const docIdPattern = /\/document\/d\/([\w-]+)|\b([\w-]{25,})\b/g;

export function implementPieceIssue(prompt: unknown): number | undefined {
  if (typeof prompt !== "string") return undefined;
  const match = implementPiecePrompt.exec(prompt);
  return match ? Number(match[1]) : undefined;
}

export function deliverableDocIds(issueBody: string): string[] {
  const sections = [...issueBody.matchAll(idSections)].map((match) => match[1] ?? "");
  return sections.flatMap((section) =>
    [...section.matchAll(docIdPattern)].map((match) => match[1] ?? match[2]).filter((id) => id !== undefined),
  );
}

// A ticket's grant lives as long as its parent spec is open.
export function governingIssue(issue: number, issueBody: string): number {
  const parent = /#(\d+)|\/issues\/(\d+)/.exec(parentSection.exec(issueBody)?.[1] ?? "");
  return Number(parent?.[1] ?? parent?.[2] ?? issue);
}

export function grantedIssueOf(grants: DocGrants, documentId: unknown): number | undefined {
  if (typeof documentId !== "string" || !Object.hasOwn(grants, documentId)) return undefined;
  return grants[documentId];
}

export function docGrantDecision({ toolName, grantedIssue, issueState }: DocWrite): Decision | undefined {
  if (toolName === undefined || !grantedDocWrites.has(toolName) || grantedIssue === undefined) return undefined;
  if (issueState !== "OPEN") return undefined;
  return {
    permissionDecision: "allow",
    reason: `Doc grant: this is the Deliverable of spec #${grantedIssue}, which is open and was named by the developer's /implement-piece.`,
  };
}
