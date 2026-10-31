// Splits a command into the text bash runs at each depth of `$(…)` and backtick substitution, quoted or not; bashReads.ts parses each layer.
// It throws where it can't read a command as bash does, so the gate asks: a quote or substitution left open, a comment inside a substitution or hiding one, and `${…}` beside one, whose `)` or `#` bash reads differently.
// Stands in for a substitution in the text around it: its `$` and braces make it no program name and no plain path.
export const substitutionWord = "${substitution}";
const scanErrors = {
  unbalancedQuote: "Unbalanced quote",
  unclosed: "Unclosed command substitution",
  unreadable: "Unreadable command substitution",
} as const;
// A `#` after one of these starts a comment, whose `)` or quote bash ignores.
const wordBreak = /[\s;&|()<>]/;

interface Substitution {
  start: number;
  closeAt: number;
}

interface Walk {
  substitutions: Substitution[];
  closeAt: number;
}

export class SubstitutionScanner {
  readonly command: string;
  constructor(command: string) {
    this.command = command;
  }
  static init(command: string): SubstitutionScanner {
    return new SubstitutionScanner(command);
  }
  // The command with each substitution swapped for substitutionWord, then each substitution's own layers.
  get layers(): string[] {
    const { command } = this;
    if (/\$\{/.test(command) && /\$\(|`/.test(command)) {
      throw new Error(scanErrors.unreadable);
    }
    const { substitutions } = this._walk(0, false);
    let outer = "";
    let at = 0;
    substitutions.forEach(({ start, closeAt }) => {
      outer += command.slice(at, start) + substitutionWord;
      at = closeAt + 1;
    });
    outer += command.slice(at);
    return [
      outer,
      ...substitutions.flatMap(
        (substitution) =>
          SubstitutionScanner.init(this._innerOf(substitution)).layers,
      ),
    ];
  }
  // Each substitution at this depth, and the `)` closing the substitution the walk is in, or the command's end.
  _walk(from: number, isInSubstitution: boolean): Walk {
    const { command } = this;
    const substitutions: Substitution[] = [];
    let depth = 0;
    let isInDoubleQuotes = false;
    let isWordStart = true;
    for (let at = from; at < command.length; at++) {
      const char = command.charAt(at);
      let skipTo = at;
      if (char === "\\") skipTo = at + 1;
      else if (command.startsWith("$(", at)) {
        skipTo = this._walk(at + 2, true).closeAt;
        substitutions.push({ start: at, closeAt: skipTo });
      } else if (char === "`") {
        skipTo = this._closingBacktickOf(at);
        substitutions.push({ start: at, closeAt: skipTo });
      } else if (isInDoubleQuotes) isInDoubleQuotes = char !== '"';
      else if (char === '"') isInDoubleQuotes = true;
      else if (char === "'") skipTo = closingQuoteOf(command, at);
      else if (char === "#" && isWordStart) {
        skipTo = this._commentEndOf(at, isInSubstitution);
      } else if (isInSubstitution && char === "(") depth++;
      else if (isInSubstitution && char === ")") {
        if (depth === 0) return { substitutions, closeAt: at };
        depth--;
      }
      isWordStart = skipTo === at && !isInDoubleQuotes && wordBreak.test(char);
      at = skipTo;
    }
    if (isInSubstitution) throw new Error(scanErrors.unclosed);
    if (isInDoubleQuotes) throw new Error(scanErrors.unbalancedQuote);
    return { substitutions, closeAt: command.length };
  }
  // Bash ends no comment inside `((…))` or `${…}`, so a comment that could be one of those is refused rather than skipped.
  _commentEndOf(at: number, isInSubstitution: boolean): number {
    const newline = this.command.indexOf("\n", at);
    const end = newline < 0 ? this.command.length : newline;
    if (isInSubstitution || /\$\(|`/.test(this.command.slice(at, end))) {
      throw new Error(scanErrors.unreadable);
    }
    return end - 1;
  }
  _closingBacktickOf(open: number): number {
    for (let at = open + 1; at < this.command.length; at++) {
      if (this.command[at] === "\\") at++;
      else if (this.command[at] === "`") return at;
    }
    throw new Error(scanErrors.unclosed);
  }
  // A backtick's inner text drops the backslashes that escape `$`, a backtick or a backslash, as bash does.
  _innerOf({ start, closeAt }: Substitution): string {
    if (this.command[start] !== "`") {
      return this.command.slice(start + 2, closeAt);
    }
    return this.command.slice(start + 1, closeAt).replace(/\\([$`\\])/g, "$1");
  }
}

// The index of the quote closing the one at `open`; a backslash escapes only inside double quotes.
export function closingQuoteOf(command: string, open: number): number {
  const quote = command[open];
  for (let at = open + 1; at < command.length; at++) {
    if (quote === '"' && command[at] === "\\") at++;
    else if (command[at] === quote) return at;
  }
  throw new Error(scanErrors.unbalancedQuote);
}
