// Finds each heredoc as bash does: a `<<` outside quotes and comments, not a `<<<` here-string, its body the lines after it up to its delimiter.
// ShellParser.ts strips bodies by a text match and checks it against this scan; this scan throws on a quote left open or a `<<` the text match reads differently.
import { closingQuoteOf } from "./SubstitutionScanner.ts";

// isQuoted: its delimiter is quoted, so bash expands nothing in its body.
export interface Heredoc {
  delimiter: string;
  isQuoted: boolean;
}

interface HeredocScan {
  heredocs: Heredoc[];
  withoutBodies: string;
}

// A `#` after one of these starts a comment.
const wordBreak = /[\s;&|()<>]/;
// The delimiter shapes ShellParser's text match reads, ending where bash ends the word.
const heredocOpener =
  /<<-?[ \t]*(?:'([\w.-]+)'|"([\w.-]+)"|([\w.-]+))(?=[\s;&|()<>]|$)/y;

export class HeredocScanner {
  readonly command: string;
  constructor(command: string) {
    this.command = command;
  }
  static init(command: string): HeredocScanner {
    return new HeredocScanner(command);
  }
  get scan(): HeredocScan {
    const { command } = this;
    const heredocs: Heredoc[] = [];
    let pending: Heredoc[] = [];
    let withoutBodies = "";
    let isWordStart = true;
    for (let at = 0; at < command.length; at++) {
      const char = command.charAt(at);
      if (char === "\n" && pending.length > 0) {
        const resumeAt = this._bodiesEndOf(at + 1, pending);
        if (resumeAt <= command.length) withoutBodies += char;
        pending = [];
        isWordStart = true;
        at = resumeAt - 1;
        continue;
      }
      let skipTo = at;
      if (char === "\\") skipTo = at + 1;
      else if (char === "'" || char === '"') {
        skipTo = closingQuoteOf(command, at);
      } else if (char === "#" && isWordStart) skipTo = this._lineEndOf(at) - 1;
      else if (command.startsWith("<<<", at)) skipTo = at + 2;
      else if (command.startsWith("<<", at)) {
        const { heredoc, length } = this._heredocAt(at);
        heredocs.push(heredoc);
        pending.push(heredoc);
        skipTo = at + length - 1;
      }
      withoutBodies += command.slice(at, skipTo + 1);
      isWordStart = skipTo === at && wordBreak.test(char);
      at = skipTo;
    }
    return { heredocs, withoutBodies };
  }
  _heredocAt(at: number): { heredoc: Heredoc; length: number } {
    heredocOpener.lastIndex = at;
    const match = heredocOpener.exec(this.command);
    if (!match) throw new Error("Unreadable heredoc");
    const [opener, singleQuoted, doubleQuoted, bare] = match;
    return {
      heredoc: {
        delimiter: singleQuoted ?? doubleQuoted ?? bare ?? "",
        isQuoted: bare === undefined,
      },
      length: opener.length,
    };
  }
  // Past the newline after the last body's delimiter line, or past the end when the command ends first; a delimiter line matches trimmed, as the text match reads it.
  _bodiesEndOf(from: number, pending: Heredoc[]): number {
    let at = from;
    pending.forEach(({ delimiter }) => {
      while (at < this.command.length) {
        const end = this._lineEndOf(at);
        const line = this.command.slice(at, end);
        at = end + 1;
        if (line.trim() === delimiter) break;
      }
    });
    return at;
  }
  _lineEndOf(at: number): number {
    const newline = this.command.indexOf("\n", at);
    return newline < 0 ? this.command.length : newline;
  }
}
