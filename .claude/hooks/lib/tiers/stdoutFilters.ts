// Reads a sed call's scripts, files and in-place flag, for bashReads.ts's `-i` write check.

export interface SedCall {
  scripts: string[];
  files: string[];
  isInPlace: boolean;
}

const sedFlags = {
  // Flags that change only how sed reads or prints.
  plain: new Set([
    "--quiet",
    "--silent",
    "--regexp-extended",
    "--posix",
    "--debug",
    "--null-data",
    "--separate",
    "--unbuffered",
    "--sandbox",
  ]),
  cluster: /^-[nEsrzu]+$/,
  inPlaceCluster: /^-[nEsrzu]*i/,
  // macOS sed's `-i` takes the next word as its backup suffix, so only `-i ''` leaves the script where GNU sed reads it.
  bareInPlace: /^-[nEsrzu]*i$/,
} as const;

// Undefined when a flag or a missing script leaves what sed does unknown.
export function sedCallOf(args: string[]): SedCall | undefined {
  const scripts: string[] = [];
  const files: string[] = [];
  let isInPlace = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--") {
      files.push(...args.slice(i + 1));
      break;
    }
    if (arg === "-e" || arg === "--expression") scripts.push(args[++i] ?? "");
    else if (arg.startsWith("--expression=")) {
      scripts.push(arg.slice("--expression=".length));
    } else if (sedFlags.bareInPlace.test(arg)) {
      if (args[i + 1] !== "") return undefined;
      isInPlace = true;
      i++;
    } else if (
      arg.startsWith("--in-place") ||
      sedFlags.inPlaceCluster.test(arg)
    ) {
      isInPlace = true;
    } else if (sedFlags.cluster.test(arg) || sedFlags.plain.has(arg)) continue;
    else if (arg.startsWith("-") && arg !== "-") return undefined;
    else files.push(arg);
  }
  if (scripts.length === 0) {
    const script = files.shift();
    if (script === undefined) return undefined;
    scripts.push(script);
  }
  return { scripts, files, isInPlace };
}
