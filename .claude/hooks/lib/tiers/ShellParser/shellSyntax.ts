// Loads mvdan/sh's bash parser, the WASM build in the sh-syntax package, and parses each command once per process.
// ../ShellParser.ts serves the tree; a parser that won't load or throws past a syntax error raises ParserUnavailableError, which the tier gate refuses naming `npm install`.
import { fileURLToPath } from "node:url";

import type * as shSyntaxModule from "sh-syntax";
import type { File } from "sh-syntax";

import { ParserUnavailableError } from "./ParserUnavailableError.ts";

type ShSyntax = typeof shSyntaxModule;

const installRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
// A static import that failed would crash the hook, and Claude Code lets a crashed hook's call through.
const loading = await loadingOf();
// Each parse builds a WASM instance that keeps about 0.25 MB, so a command is parsed once.
const outcomes = new Map<string, File | Error>();
// The phrases a parse failure finishes "it holds …" with, matched on mvdan/sh's own message.
const syntaxPhrases: [RegExp, string][] = [
  [/closing quote `["']`/, "a quote left open"],
  [/closing quote "`"|matching `\$\(`/, "a command substitution left open"],
];

export const shellSyntax = {
  // Throws a plain Error naming syntax bash rejects too, or ParserUnavailableError.
  treeOf(command: string): File {
    const outcome = outcomes.get(command) ?? parsedOutcomeOf(command);
    outcomes.set(command, outcome);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  },
};

async function loadingOf(): Promise<ShSyntax | Error> {
  try {
    return await import("sh-syntax");
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function parsedOutcomeOf(command: string): File | Error {
  if (loading instanceof Error) {
    return new ParserUnavailableError(installRoot, loading);
  }
  try {
    return loading.parseSync(command, { keepComments: false });
  } catch (error) {
    if (error instanceof loading.ParseError) {
      return new Error(syntaxPhraseOf(error.text));
    }
    if (error instanceof SyntaxError) {
      return new Error(syntaxPhraseOf(error.message));
    }
    return new ParserUnavailableError(installRoot, error);
  }
}

function syntaxPhraseOf(text: string): string {
  const phrase = syntaxPhrases.find(([pattern]) => pattern.test(text))?.[1];
  return phrase ?? `syntax bash rejects too: ${text}`;
}
