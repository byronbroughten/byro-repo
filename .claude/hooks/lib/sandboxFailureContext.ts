// What sandboxFailureContext.ts adds after a failed Bash call whose output shows the sandbox stopped it. See docs/claude-code-guardrails.md.
import { join } from "node:path";

import { callOfItsOwn } from "@byronbroughten/spec-runner/callOfItsOwn";
import { protectedClaudeEntries } from "@byronbroughten/spec-runner/claudeEntries";

import type { SandboxState } from "./sandboxState.ts";

export interface WriteScope {
  allow: string[];
  deny: string[];
}

export interface ScopeEnv {
  home: string;
  cwd: string;
  tmpdir: string;
}

const wayThrough = `The call ran in the sandbox. If the command is on \`excludedCommands\` in \`.claude/settings.json\`, ${callOfItsOwn("run it")}. Otherwise this is a limit of the sandbox: report it to the developer with the error, and never retry with \`dangerouslyDisableSandbox\`. A runner step records a blocker naming the sandbox.`;

const fixedRows = [
  {
    output: /x509: OSStatus -26276/,
    says: "This is the sandbox, not the network: it blocked a Go tool's TLS check (`x509: OSStatus -26276`).",
  },
  {
    output: /CONNECT tunnel failed, response 403/,
    says: "This is the sandbox: the host isn't on its `allowedDomains` (`CONNECT tunnel failed, response 403`).",
  },
  {
    output: /operation not permitted: ps\b/i,
    says: "This is the sandbox: it blocks `ps`.",
  },
];

// Claude Code protects these in every worktree without listing them in `denyWrite`, and the shell names them relative to the cwd, as `.claude/hooks/x`.
const protectedEntryAlternation = protectedClaudeEntries
  .map((entry) => entry.replaceAll(".", "\\."))
  .join("|");

const pathParts = {
  // What may stand before a path in an error line.
  before: `(?:^|[\\s'"\`(:])`,
  absolute: "(?:\\/|~\\/)",
  // A relative path counts only when it reaches a protected `.claude/` entry, however many folders lead to it.
  protectedRelative: `(?:[^\\s'"\`:,)/]+\\/)*\\.claude\\/(?=(?:${protectedEntryAlternation})(?:[\\s'"\`:,)/]|$))`,
  body: `[^\\s'"\`:,)]+`,
};

const deniedPathPatterns = {
  line: /operation not permitted/i,
  path: new RegExp(
    `${pathParts.before}((?:${pathParts.absolute}|${pathParts.protectedRelative})${pathParts.body})`,
    "g",
  ),
} as const;

// macOS reports a path through its real name, `/private/var` for `/var`, while settings may list either.
const privateAlias = /^\/private(?=\/(?:var|tmp|etc)(?:\/|$))/;

export function sandboxContextOf(
  error: string,
  scope: WriteScope,
): string | undefined {
  const says = fixedRows
    .filter((row) => row.output.test(error))
    .map((row) => row.says);
  const denied = deniedPathsOf(error, scope);
  if (denied.length > 0) {
    says.push(
      `This is the sandbox: it denies writes to ${denied.map((path) => `\`${path}\``).join(", ")}, and reads of the credential paths it denies. It writes only in the workspace, the temp folders and the \`allowWrite\` folders, and never under a primary checkout's \`.git\` or \`claude-guardrails/\`.`,
    );
  }
  if (says.length === 0) return undefined;
  return [...says, wayThrough].join(" ");
}

export function writeScopeOf(
  filesystem: SandboxState["filesystem"],
  env: ScopeEnv,
): WriteScope {
  return {
    allow: [
      ...listedPaths(filesystem.allowWrite, env.home),
      env.cwd,
      env.tmpdir,
      "/dev",
    ],
    deny: listedPaths(filesystem.denyWrite, env.home),
  };
}

function listedPaths(value: unknown, home: string): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => expandHome(entry, home));
}

function deniedPathsOf(error: string, scope: WriteScope): string[] {
  const paths = error
    .split("\n")
    .filter((line) => deniedPathPatterns.line.test(line))
    .flatMap((line) =>
      [...line.matchAll(deniedPathPatterns.path)].map(
        (match) => match[1] as string,
      ),
    );
  return [...new Set(paths)].filter((path) => !writableIn(path, scope));
}

function writableIn(path: string, scope: WriteScope): boolean {
  const segments = path.split("/");
  if (segments.includes("claude-guardrails")) return false;
  if (isProtectedClaudeEntry(segments)) return false;
  if (scope.deny.some((folder) => isUnder(path, folder))) return false;
  return scope.allow.some((folder) => isUnder(path, folder));
}

function isProtectedClaudeEntry(segments: string[]): boolean {
  return segments.some(
    (segment, index) =>
      segment === ".claude" &&
      protectedClaudeEntries.includes(segments[index + 1] ?? ""),
  );
}

function isUnder(path: string, folder: string): boolean {
  const real = path.replace(privateAlias, "");
  const realFolder = folder.replace(privateAlias, "");
  return real === realFolder || real.startsWith(join(realFolder, "/"));
}

function expandHome(path: string, home: string): string {
  return path.startsWith("~/") ? join(home, path.slice(2)) : path;
}
