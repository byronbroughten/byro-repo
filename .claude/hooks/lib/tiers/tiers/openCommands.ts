// The verdict on `open`, which runs outside the box: free for an Interactive session's file in the workspace or temp, asking for anything else, and refused for a runner step, which has nobody to show.
import type { SimpleCommand } from "../ShellParser.ts";
import type { CallContext, Verdict } from "../tiers.ts";
import { type ShellPlaces, WritePathResolver } from "../WritePathResolver.ts";

const urlScheme = /^[a-z][a-z\d+.-]*:/i;
// Files macOS runs or installs rather than shows, such as a `.command` script, which opens in Terminal outside the box.
const launchedSuffix =
  /\.(app|command|tool|terminal|scpt|applescript|workflow|pkg|mpkg)\/?$/i;
const fileInPlaces = "a file in the workspace or temp";

export const openCommands = {
  openVerdictOf(
    { words }: SimpleCommand,
    { mode, places }: CallContext,
  ): Verdict | undefined {
    const [program, ...args] = words;
    if (program !== "open") return undefined;
    if (mode === "runnerStep") {
      return {
        permissionDecision: "ask",
        why: "shows the developer something, and nobody watches a runner step",
      };
    }
    if (args.length === 0) return undefined;
    const askWhy = args
      .map((arg) => askWhyOf(arg, places))
      .find((why) => why !== undefined);
    if (askWhy) return { permissionDecision: "ask", why: askWhy };
    return {
      permissionDecision: "allow",
      why: `shows the developer ${fileInPlaces}`,
      needsPlainText: true,
    };
  },
};

function askWhyOf(
  arg: string,
  places: ShellPlaces | undefined,
): string | undefined {
  if (arg === "-a") return "names an app with `-a`";
  if (arg.startsWith("-")) return "passes `open` a flag";
  if (urlScheme.test(arg)) return "opens a URL";
  if (launchedSuffix.test(arg)) return "launches an app";
  const resolved =
    places &&
    WritePathResolver.init(places).resolvedFileInPlacesOf(arg, places.cwd);
  if (resolved === undefined) {
    return `names \`${arg}\`, which isn't ${fileInPlaces}`;
  }
  if (launchedSuffix.test(resolved)) return "launches an app";
  return undefined;
}
