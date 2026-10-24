// The I/O shared by styleGate.ts and proseGate.ts: PostToolUse on Read or Bash records a full read of one doc; PreToolUse on Edit and Write asks the gate's decider whether to deny.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { type FullDocRead, isPostToolUse } from "./fullDocRead.ts";
import {
  lineCount,
  readHookInput,
  runFailOpen,
  sessionStatePath,
  writeDenyOutput,
} from "./hookIo.ts";
import type { FileLocation } from "./lintSet.ts";
import { BashReads } from "./tiers/bashReads.ts";

interface FullReadGate {
  marker: string;
  docPath: string;
  isDocRead: (read: FullDocRead) => boolean;
  isDocBashRead: (projectDir: string, wholeFilePaths: string[]) => boolean;
  editDenyReason: (
    where: FileLocation,
    hasReadDoc: boolean,
  ) => string | undefined;
}

export async function runFullReadGate(gate: FullReadGate): Promise<void> {
  await runFailOpen(() => {
    const input = readHookInput();
    if (!input) return;
    const projectDir =
      process.env.CLAUDE_PROJECT_DIR ??
      input.workspace_roots?.[0] ??
      input.cwd ??
      process.cwd();
    const markerPath = sessionStatePath(
      input.session_id ?? input.conversation_id,
      gate.marker,
    );
    const command = input.tool_input?.command;
    if (
      isPostToolUse(input.hook_event_name) &&
      input.tool_name === "Bash" &&
      typeof command === "string"
    ) {
      const wholeFilePaths = BashReads.init({
        command,
        cwd: input.cwd ?? projectDir,
        projectDir,
      }).wholeFilePaths();
      if (gate.isDocBashRead(projectDir, wholeFilePaths)) {
        writeFileSync(markerPath, "");
      }
      return;
    }
    const filePath = input.tool_input?.file_path ?? input.tool_input?.path;
    if (typeof filePath !== "string") return;
    const where = { projectDir, cwd: input.cwd ?? projectDir, filePath };
    if (isPostToolUse(input.hook_event_name)) {
      if (input.tool_name !== "Read") return;
      const { offset, limit } = input.tool_input ?? {};
      if (
        gate.isDocRead({
          ...where,
          offset,
          limit,
          totalLines: lineCount(join(projectDir, gate.docPath)),
        })
      ) {
        writeFileSync(markerPath, "");
      }
      return;
    }
    if (!["Edit", "Write"].includes(input.tool_name ?? "")) return;
    const denyReason = gate.editDenyReason(where, existsSync(markerPath));
    if (!denyReason) return;
    writeDenyOutput(denyReason);
  });
}
