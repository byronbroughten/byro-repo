// What `issue:start` prints: whether the session is already in the workspace, its path, the skill to follow and the ticket's text.
import { isAbsolute, relative } from "node:path";

import type { SessionSkill } from "@byronbroughten/spec-runner/IssueReader";

interface StartReport {
  path: string;
  hasLease: boolean;
  cwd: string;
  // Undefined for a session workspace, which has no ticket.
  ticket: StartedTicket | undefined;
}

export interface StartedTicket {
  skill: SessionSkill;
  text: string;
}

export function startReportOf({
  path,
  hasLease,
  cwd,
  ticket,
}: StartReport): string {
  const lines = [path];
  if (!hasLease) {
    lines.push("No claude process ran this, so no lease was taken.");
  } else if (isInside(cwd, path)) {
    lines.unshift("This session is already in the workspace.");
  }
  if (ticket !== undefined) lines.push(`Skill: /${ticket.skill}`, ticket.text);
  return lines.join("\n");
}

function isInside(folder: string, root: string): boolean {
  const from = relative(root, folder);
  return from !== ".." && !from.startsWith("../") && !isAbsolute(from);
}
