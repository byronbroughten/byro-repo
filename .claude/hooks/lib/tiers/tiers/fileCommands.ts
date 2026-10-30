// The paths a file command writes, read off its words; PathChecker.ts checks them against the write rule.
import { isSedScriptPrinting, sedCallOf } from "../stdoutFilters.ts";

const pathWriters = new Set(["rm", "mkdir", "cp", "mv"]);

export const fileCommands = {
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
