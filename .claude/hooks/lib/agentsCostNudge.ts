// Decides the AGENTS.md cost nudge: the first edit to the root AGENTS.md in a session carries a reminder of what growing it costs. Pure; agentsCostNudge.ts does the I/O.
import { type FileLocation, projectRelative } from "./lintSet.ts";

export const agentsCostReminder =
  "AGENTS.md cost reminder: this file loads on every turn for every agent, so each byte is paid on every task and dilutes the rest. " +
  "Add only what changes what an agent does on nearly every task, or a miss that is costly and can't be cheaply undone. " +
  "A fact for some tasks goes on a higher rung: lint, a nested AGENTS.md, or a trigger word on an existing router row. " +
  "Shorten or drop a line that no longer earns its place, and state the net bytes in your reply. " +
  'Full text: docs/agents/prose-files.md, "What an addition to AGENTS.md costs".';
const rootAgentsPath = "AGENTS.md";

interface EditTarget extends FileLocation {
  hasReminded: boolean;
}

export function agentsCostContext({
  hasReminded,
  ...target
}: EditTarget): string | undefined {
  return projectRelative(target) === rootAgentsPath && !hasReminded
    ? agentsCostReminder
    : undefined;
}
