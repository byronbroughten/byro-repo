// Only ever allows, since a -p run denies any .claude/ write prompt no hook answers.
import { existsSync, lstatSync, realpathSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  matchesGlob,
  relative,
  resolve,
} from "node:path";

export interface ClaudeWriteRequest {
  toolName: string;
  toolInput: ClaudeWriteToolInput;
  workspaceRoot: string;
  allowedGlobs: string[];
}

export interface ClaudeWriteToolInput {
  file_path?: unknown;
}

export function claudeWriteDecision({
  toolName,
  toolInput,
  workspaceRoot,
  allowedGlobs,
}: ClaudeWriteRequest): "allow" | undefined {
  if (toolName !== "Edit" && toolName !== "Write") return undefined;
  const { file_path: filePath } = toolInput;
  if (typeof filePath !== "string") return undefined;
  const root = realpathSync(workspaceRoot);
  const realPath = realPathOf(resolve(root, filePath));
  if (realPath === undefined) return undefined;
  const pathInRoot = relative(root, realPath);
  if (pathInRoot.startsWith("..") || isAbsolute(pathInRoot)) return undefined;
  if (!allowedGlobs.some((glob) => matchesGlob(pathInRoot, glob))) {
    return undefined;
  }
  return "allow";
}

// A Write can create the file and its folders, so resolve the nearest ancestor that exists; a dangling symlink resolves to nothing.
function realPathOf(path: string): string | undefined {
  if (existsSync(path)) return realpathSync(path);
  if (isSymlink(path)) return undefined;
  const parent = dirname(path);
  if (parent === path) return path;
  const realParent = realPathOf(parent);
  if (realParent === undefined) return undefined;
  return join(realParent, basename(path));
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
