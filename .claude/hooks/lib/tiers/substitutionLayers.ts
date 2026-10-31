// Splits a command into the text bash runs at each depth of `$(…)` and backtick substitution, quoted or not; bashReads.ts parses each layer.
// Stands in for a substitution in the text around it: its `$` and braces make it no program name and no plain path.
export const substitutionWord = "${substitution}";
// A `#` after one of these starts a comment, whose `)` or quote bash ignores.
const wordBreak = /[\s;&|()<>]/;

interface Substitution {
  inner: string;
  // The index of its closing `)` or backtick.
  end: number;
}

// The command with each substitution swapped for substitutionWord, then each substitution's own layers; throws on a quote or substitution left open.
export function substitutionLayersOf(command: string): string[] {
  const inners: string[] = [];
  let outer = "";
  let isInDoubleQuotes = false;
  let isWordStart = true;
  for (let at = 0; at < command.length; at++) {
    const substitution = substitutionAt(command, at);
    if (substitution) {
      inners.push(substitution.inner);
      outer += substitutionWord;
      at = substitution.end;
      isWordStart = false;
      continue;
    }
    const char = command.charAt(at);
    let end = at;
    if (char === "\\") end = at + 1;
    else if (isInDoubleQuotes) isInDoubleQuotes = char !== '"';
    else if (char === '"') isInDoubleQuotes = true;
    else if (char === "'") end = closingSingleQuoteOf(command, at);
    else if (char === "#" && isWordStart) end = lineEndOf(command, at) - 1;
    outer += command.slice(at, end + 1);
    isWordStart = end === at && !isInDoubleQuotes && wordBreak.test(char);
    at = end;
  }
  if (isInDoubleQuotes) throw new Error("Unbalanced quote");
  return [outer, ...inners.flatMap(substitutionLayersOf)];
}

// A backtick's inner text drops the backslashes that escape `$`, a backtick or a backslash, as bash does.
function substitutionAt(command: string, at: number): Substitution | undefined {
  if (command.startsWith("$(", at)) {
    const end = closingParenOf(command, at + 2);
    return { inner: command.slice(at + 2, end), end };
  }
  if (command[at] !== "`") return undefined;
  const end = closingBacktickOf(command, at + 1);
  return {
    inner: command.slice(at + 1, end).replace(/\\([$`\\])/g, "$1"),
    end,
  };
}

function closingParenOf(command: string, from: number): number {
  let depth = 1;
  let isWordStart = true;
  for (let at = from; at < command.length; at++) {
    const char = command.charAt(at);
    let end = at;
    if (char === "\\") end = at + 1;
    else if (char === "'") end = closingSingleQuoteOf(command, at);
    else if (char === '"') end = closingDoubleQuoteOf(command, at);
    else if (char === "`") end = closingBacktickOf(command, at + 1);
    else if (char === "#" && isWordStart) end = lineEndOf(command, at) - 1;
    else if (char === "(") depth++;
    else if (char === ")") depth--;
    if (depth === 0) return at;
    isWordStart = end === at && wordBreak.test(char);
    at = end;
  }
  throw new Error("Unclosed command substitution");
}

function closingDoubleQuoteOf(command: string, open: number): number {
  for (let at = open + 1; at < command.length; at++) {
    const char = command.charAt(at);
    if (char === "\\") at++;
    else if (char === '"') return at;
    else if (command.startsWith("$(", at)) at = closingParenOf(command, at + 2);
    else if (char === "`") at = closingBacktickOf(command, at + 1);
  }
  throw new Error("Unbalanced quote");
}

function closingBacktickOf(command: string, from: number): number {
  for (let at = from; at < command.length; at++) {
    if (command[at] === "\\") at++;
    else if (command[at] === "`") return at;
  }
  throw new Error("Unclosed command substitution");
}

function closingSingleQuoteOf(command: string, open: number): number {
  const close = command.indexOf("'", open + 1);
  if (close < 0) throw new Error("Unbalanced quote");
  return close;
}

function lineEndOf(command: string, at: number): number {
  const end = command.indexOf("\n", at);
  return end < 0 ? command.length : end;
}
