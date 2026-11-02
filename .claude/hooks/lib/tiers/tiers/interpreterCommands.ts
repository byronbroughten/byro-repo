// The verdict on `node` and `python`: a scratch helper runs free, inline code is refused naming the way through, and any other script asks.
import type { SimpleCommand } from "../ShellParser.ts";
import type { CallContext, Verdict } from "../tiers.ts";
import { PathChecker } from "./PathChecker.ts";

const interpreters = {
  nodeScratchFlags: new Set([
    "--experimental-strip-types",
    "--no-warnings",
    "--enable-source-maps",
  ]),
  // `-e`, `-p` and their pairing `-pe`, long forms included.
  nodeInlineFlag: /^(-[ep]{1,2}|--eval|--print)(=|$)/,
  pythonInlineFlag: /^-[a-zA-Z]*c/,
  python: new Set(["python", "python3"]),
  nodeWhy:
    "runs code that isn't a scratch helper: `node` runs only scratch helpers, in `$TMPDIR`, `/tmp` or a gitignored folder of the workspace, and a script being built runs through its tests, or through its `npm run` alias only when that alias is in `freeScripts` in `.claude/hooks/lib/tiers/tiers/npmCommands.ts`; any other script asks",
  // A deny, not an ask: the way through is free, so asking would only interrupt the developer.
  inlineWhy:
    "inline code is refused because the gate can't read it; read JSON with `jq`, or write a scratch helper in `$TMPDIR` and run `node` on it",
} as const;

export const interpreterCommands = {
  // node runs a scratch helper, in $TMPDIR, /tmp or gitignored in the workspace, at tier 1; inline code is refused, naming the way through; any other node is tier 3.
  verdictOf(
    { words, isBare }: SimpleCommand,
    { places }: CallContext,
  ): Verdict | undefined {
    if (!isBare) return undefined;
    const [program = "", ...args] = words;
    if (interpreters.python.has(program)) {
      if (args.some((arg) => interpreters.pythonInlineFlag.test(arg))) {
        return { permissionDecision: "deny", why: interpreters.inlineWhy };
      }
      return undefined;
    }
    if (program !== "node") return undefined;
    if (args.length === 1 && (args[0] === "-v" || args[0] === "--version")) {
      return {
        permissionDecision: "allow",
        why: "`node --version` only reads",
      };
    }
    const at = args.findIndex((arg) => !arg.startsWith("-"));
    if (isInlineNode(args, at)) {
      return { permissionDecision: "deny", why: interpreters.inlineWhy };
    }
    const isScratch =
      at >= 0 &&
      args
        .slice(0, at)
        .every((flag) => interpreters.nodeScratchFlags.has(flag)) &&
      PathChecker.init(places).isScratchFile(args[at] ?? "");
    if (!isScratch) {
      return { permissionDecision: "ask", why: interpreters.nodeWhy };
    }
    return {
      permissionDecision: "allow",
      why: "`node` runs a scratch helper",
      needsPlainText: true,
    };
  },
};

// Code passed by flag, or read from stdin when no script is named (`-` included); a flag after the script is the script's own.
function isInlineNode(args: string[], scriptAt: number): boolean {
  if (scriptAt === -1) return true;
  return args
    .slice(0, scriptAt)
    .some((flag) => interpreters.nodeInlineFlag.test(flag));
}
