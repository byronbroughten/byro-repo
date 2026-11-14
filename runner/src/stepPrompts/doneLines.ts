// The "when you're done" lines the code and piece Workflows' implement and red-checks prompts share.

import { sessionReturnOf } from "../promptText.ts";

export const doneLines = {
  implement: `Then stop. ${sessionReturnOf(["record"])}, the implement record:`,
  redChecks: `${sessionReturnOf(["summary"])}: one or two sentences on what was red and what you changed.`,
} as const;
