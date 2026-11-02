// The paths a file command writes, read off its words, and its verdict once PathChecker.ts checks them against the write rule.
import type { SimpleCommand } from "../ShellParser.ts";
import {
  isSedScriptPrinting,
  sedCallOf,
  stdoutFilters,
} from "../stdoutFilters.ts";
import type { CallContext, Verdict } from "../tiers.ts";
import { PathChecker, writablePlaces } from "./PathChecker.ts";

const pathWriters = new Set(["rm", "mkdir", "cp", "mv"]);

export const fileCommands = {
  // rm, mkdir, cp, mv and sed -i: tier 1 when every path passes the write rule, tier 3 otherwise; a stdout filter that may write or run asks.
  verdictOf(
    { words, isBare }: SimpleCommand,
    { places }: CallContext,
  ): Verdict | undefined {
    if (!isBare) return undefined;
    const [program = "", ...args] = words;
    const paths = fileCommands.writtenPathsOf(program, args);
    if (paths) {
      const writeAsk = PathChecker.init(places).writeAskAmong(paths);
      if (writeAsk) return writeAsk;
      return {
        permissionDecision: "allow",
        why: `\`${program}\` writes only ${writablePlaces}`,
        needsPlainText: true,
      };
    }
    const isFilterRead = stdoutFilters.get(program);
    if (!isFilterRead || isFilterRead(args)) return undefined;
    return {
      permissionDecision: "ask",
      why: "may write a file or run a command, which the gate can't check",
    };
  },
  // The paths rm, mkdir, cp, mv or sed -i writes, or undefined for any other program.
  writtenPathsOf(program: string, args: string[]): string[] | undefined {
    if (program === "sed") {
      const call = sedCallOf(args);
      if (!call?.isInPlace || !isSedScriptPrinting(call)) return undefined;
      return call.files.length > 0 ? call.files : [""];
    }
    if (!pathWriters.has(program)) return undefined;
    const paths: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i] ?? "";
      if (arg === "--") {
        paths.push(...args.slice(i + 1));
        break;
      }
      if (arg.startsWith("--target-directory=")) {
        paths.push(arg.slice("--target-directory=".length));
      } else if (program === "mkdir" && arg === "-m") i++;
      else if (!arg.startsWith("-")) paths.push(arg);
    }
    return paths.length > 0 ? paths : [""];
  },
};
