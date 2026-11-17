// What `issue:start` prints: whether the session is already in the workspace, its path, other repos' same-numbered branches, the skill to follow, with the spec for one that takes it, a drafting ticket's pull command and the ticket's text.
import { isAbsolute, relative } from "node:path";

import {
  isDraftingSkill,
  isSpecSkill,
  type SessionSkill,
} from "@byronbroughten/spec-runner/IssueReader";
import {
  type IssueRef,
  otherIssueBranch,
  type RepoBranch,
} from "@byronbroughten/spec-runner/IssueWorkspaces";

interface StartReport {
  path: string;
  hasLease: boolean;
  cwd: string;
  // Undefined for a session workspace, which has no ticket.
  ticket: StartedTicket | undefined;
  otherIssueBranches: RepoBranch[];
}

export interface StartedTicket {
  issue: IssueRef;
  skill: SessionSkill;
  // The ticket's parent, or the ticket itself with none.
  spec: IssueRef;
  text: string;
}

export function startReportOf({
  path,
  hasLease,
  cwd,
  ticket,
  otherIssueBranches,
}: StartReport): string {
  const lines = [path];
  if (!hasLease) {
    lines.push("No claude process ran this, so no lease was taken.");
  } else if (isInside(cwd, path)) {
    lines.unshift("This session is already in the workspace.");
  }
  lines.push(...otherIssueBranches.map(otherIssueBranch.noticeOf));
  if (ticket !== undefined) lines.push(...ticketLinesOf(ticket));
  return lines.join("\n");
}

// A drafting ticket's session pulls its Agent draft before drafting; `/start-issue` sends the pull with `EnterWorktree`.
function ticketLinesOf({ issue, skill, spec, text }: StartedTicket): string[] {
  const lines = [skillLineOf(skill, spec)];
  if (isDraftingSkill(skill)) {
    lines.push(`Pull: npm run piece:pull -- ${issue.repo} ${issue.number}`);
  }
  return [...lines, text];
}

function skillLineOf(skill: SessionSkill, spec: IssueRef): string {
  if (!isSpecSkill(skill)) return `Skill: /${skill}`;
  return `Skill: /${skill} ${spec.repo} ${spec.number}`;
}

function isInside(folder: string, root: string): boolean {
  const from = relative(root, folder);
  return from !== ".." && !from.startsWith("../") && !isAbsolute(from);
}
