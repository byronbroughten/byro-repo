// Decides whether sed, awk, sort, uniq, cut and tr only print, for the tier gate's reads; sed's call is shared with its `-i` write check.

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
// Commands that print, delete or move between lines; q, Q, l and L may take a number.
const sedPrintCommands = new Set([..."pPlL=dDnNgGhHxzqQF"]);
const sedLabelCommands = new Set([..."btT:"]);
const sedSubstituteFlags = /[gpiImM\d]/;
const awkRunsOrWrites = /[|>@]/;
// A `/` opens a regex only where no operand can come before it, so a `/` that could divide stays in the code checked for `|` and `>`.
const awkRegexMayOpen = /(?:^|[(,~!{};&|=\n])\s*$/;
const sortWriteFlags = ["--output", "--compress-program"];
const uniqValueFlags = new Set(["-f", "-s", "-w"]);

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

function isSedRead(args: string[]): boolean {
  const call = sedCallOf(args);
  return call !== undefined && !call.isInPlace && isSedScriptPrinting(call);
}

// No w, W or e command, no s flag w or e, and nothing the scanner doesn't know; sed joins -e scripts with newlines.
export function isSedScriptPrinting({ scripts }: SedCall): boolean {
  const script = scripts.join("\n");
  let depth = 0;
  let at = 0;
  while (at < script.length) {
    const char = script.charAt(at);
    if (/[\s;]/.test(char)) {
      at++;
      continue;
    }
    if (char === "#") {
      at = endOfLine(script, at);
      continue;
    }
    if (char === "}") {
      depth--;
      if (depth < 0) return false;
      at++;
      continue;
    }
    at = afterAddresses(script, at);
    if (at < 0) return false;
    while (/[\s!]/.test(script.charAt(at))) at++;
    const command = script.charAt(at++);
    if (command === "{") depth++;
    else if (sedPrintCommands.has(command)) {
      while (/\d/.test(script.charAt(at))) at++;
    } else if (sedLabelCommands.has(command)) {
      while (at < script.length && !/[;\n]/.test(script.charAt(at))) at++;
    } else if (command === "s" || command === "y") {
      at = afterDelimited(script, at, 2);
      if (at < 0) return false;
      if (command === "s") {
        while (sedSubstituteFlags.test(script.charAt(at))) at++;
      }
    } else return false;
  }
  return depth === 0;
}

// Past an address or a range, or -1 for one the scanner can't read.
function afterAddresses(script: string, start: number): number {
  let at = afterAddress(script, start);
  if (at < 0 || script.charAt(at) !== ",") return at;
  at++;
  if (/[+~]/.test(script.charAt(at))) {
    at++;
    while (/\d/.test(script.charAt(at))) at++;
    return at;
  }
  return afterAddress(script, at);
}

function afterAddress(script: string, start: number): number {
  let at = start;
  const char = script.charAt(at);
  if (/\d/.test(char)) {
    while (/[\d~]/.test(script.charAt(at))) at++;
    return at;
  }
  if (char === "$") return at + 1;
  if (char === "/") at = afterDelimited(script, at, 1);
  else if (char === "\\") at = afterDelimited(script, at + 1, 1);
  else return at;
  while (at >= 0 && /[IM]/.test(script.charAt(at))) at++;
  return at;
}

// Past `parts` pieces ended by the delimiter at `start`, a backslash escaping the next character; -1 when one is left open.
function afterDelimited(script: string, start: number, parts: number): number {
  const delimiter = script.charAt(start);
  if (delimiter === "" || /[\\\n]/.test(delimiter)) return -1;
  let at = start + 1;
  let closed = 0;
  while (closed < parts) {
    if (at >= script.length) return -1;
    const char = script.charAt(at);
    if (char === "\\") at++;
    else if (char === delimiter) closed++;
    at++;
  }
  return at;
}

function endOfLine(script: string, start: number): number {
  const end = script.indexOf("\n", start);
  return end < 0 ? script.length : end;
}

// awk's program, the first word but -F and -v values; no -f file, no system in it, and no pipe, redirect or gawk @ directive outside a string or regex.
function isAwkRead(args: string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "-F" || arg === "-v") i++;
    else if (/^-[Fv]./.test(arg)) continue;
    else if (arg === "--") return isAwkProgramRead(args[i + 1]);
    else if (arg.startsWith("-")) return false;
    else return isAwkProgramRead(arg);
  }
  return false;
}

function isAwkProgramRead(program: string | undefined): boolean {
  if (program === undefined || /system/.test(program)) return false;
  const code = awkCodeOf(program);
  return code !== undefined && !awkRunsOrWrites.test(code);
}

// The program with each string and regex emptied, so a `|` or `>` in one isn't a pipe or redirect; undefined when one is left open.
function awkCodeOf(program: string): string | undefined {
  let code = "";
  for (let at = 0; at < program.length; at++) {
    const char = program.charAt(at);
    if (char !== '"' && !(char === "/" && awkRegexMayOpen.test(code))) {
      code += char;
      continue;
    }
    at = awkLiteralEndOf(program, at);
    if (at < 0) return undefined;
    code += char + char;
  }
  return code;
}

// The index of the quote or slash closing the literal opened at `open`, or -1.
function awkLiteralEndOf(program: string, open: number): number {
  for (let at = open + 1; at < program.length; at++) {
    if (program[at] === "\\") at++;
    else if (program[at] === program[open]) return at;
  }
  return -1;
}

function isSortRead(args: string[]): boolean {
  return !args.some(
    (arg) =>
      sortWriteFlags.some((flag) => arg.startsWith(flag)) ||
      /^-[a-zA-Z]*o/.test(arg),
  );
}

// uniq writes its second operand.
function isUniqRead(args: string[]): boolean {
  let operands = 0;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (uniqValueFlags.has(arg)) i++;
    else if (arg === "-" || !arg.startsWith("-")) operands++;
  }
  return operands <= 1;
}

function printsOnly(): boolean {
  return true;
}

// Each filter program, and whether its args only print.
export const stdoutFilters = new Map<string, (args: string[]) => boolean>([
  ["sed", isSedRead],
  ["awk", isAwkRead],
  ["sort", isSortRead],
  ["uniq", isUniqRead],
  ["cut", printsOnly],
  ["tr", printsOnly],
  ["echo", printsOnly],
  ["printf", printsOnly],
  ["pwd", printsOnly],
]);
