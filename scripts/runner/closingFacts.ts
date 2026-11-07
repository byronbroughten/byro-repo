// Wrap-up's closing facts from its arguments; --closing-file carries a note holding `$(` or a backtick, which Claude Code keeps in the sandbox, quoted or escaped, where wrap-up can't run.
import { readFileSync } from "node:fs";

import {
  type ClosingFacts,
  closingFlagsText,
  type UndoneBox,
} from "@byronbroughten/spec-runner/FactsFile";

export interface ClosingArguments {
  closing?: string;
  closingFile?: string;
  undone: string[];
}

export function closingFactsOf({
  closing,
  closingFile,
  undone,
}: ClosingArguments): ClosingFacts | undefined {
  if (closing !== undefined && closingFile !== undefined) {
    throw new Error(`Pass ${closingFlagsText()}, not both`);
  }
  let closingComment = closing;
  if (closingFile !== undefined) {
    closingComment = readFileSync(closingFile, "utf8").trimEnd();
  }
  if (closingComment === undefined) {
    if (undone.length > 0) {
      throw new Error(`--undone needs ${closingFlagsText()} with it`);
    }
    return undefined;
  }
  return { closingComment, boxesUndone: undone.map(undoneBoxOf) };
}

function undoneBoxOf(value: string): UndoneBox {
  const separator = value.indexOf(": ");
  if (separator === -1) {
    throw new Error(`--undone takes "<box>: <reason>", not "${value}"`);
  }
  return {
    box: value.slice(0, separator),
    reason: value.slice(separator + 2),
  };
}
