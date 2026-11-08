// The bash parser didn't load, or threw something other than a syntax error, so the gate can read no call.
export class ParserUnavailableError extends Error {
  constructor(installRoot: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      `The tier gate can't run its bash parser, mvdan/sh from the sh-syntax package (${detail}), so it refuses every Bash call. Run \`npm install\` in ${installRoot} from your own terminal, as the gate refuses the agent's Bash until the parser loads`,
    );
    this.name = "ParserUnavailableError";
  }
}
