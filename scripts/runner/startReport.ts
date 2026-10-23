// What `issue:start` prints: whether the session is already in the workspace, its path, and the ticket's text.
import { isAbsolute, relative } from "node:path";

interface StartReport {
  path: string;
  hasLease: boolean;
  cwd: string;
  ticketText: string | undefined;
}

export function startReportOf({
  path,
  hasLease,
  cwd,
  ticketText,
}: StartReport): string {
  const lines = [path];
  if (!hasLease) {
    lines.push("No claude process ran this, so no lease was taken.");
  } else if (isInside(cwd, path)) {
    lines.unshift("This session is already in the workspace.");
  }
  if (ticketText !== undefined) lines.push(ticketText);
  return lines.join("\n");
}

function isInside(folder: string, root: string): boolean {
  const from = relative(root, folder);
  return from !== ".." && !from.startsWith("../") && !isAbsolute(from);
}
