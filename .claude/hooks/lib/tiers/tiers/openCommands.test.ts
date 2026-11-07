import { describe, expect, it } from "vitest";

import { fakePlaces } from "../fakePlaces.ts";
import { gateDecision, type SessionMode } from "../tiers.ts";

const entries = ["open", "open *"];
const notInPlaces = "isn't a file in the workspace or temp";

function decisionOf(command: string, mode: SessionMode = "interactive") {
  return gateDecision({
    command,
    mode,
    dryRuns: [],
    places: fakePlaces(),
    sandbox: { isOn: true, excludedCommands: entries },
  });
}

describe("`open` in an Interactive session", () => {
  it.each([
    "open /ws/AGENTS.md",
    "open AGENTS.md",
    "open /var/T/helper.mjs",
    "open /tmp/helper.mjs",
    "open /private/tmp/helper.mjs",
  ])("frees `%s`, a file in the workspace or temp", (command) => {
    const decision = decisionOf(command);
    expect(decision?.permissionDecision).toBe("allow");
    expect(decision?.reason).toContain(
      "shows the developer a file in the workspace or temp",
    );
  });

  it.each([
    ["open https://example.com", "opens a URL"],
    ["open -a Safari /ws/AGENTS.md", "names an app with `-a`"],
    ["open /Applications/Safari.app", "launches an app"],
    ["open /ws/run.command", "launches an app"],
    ["open -R /ws/AGENTS.md", "passes `open` a flag"],
    ["open /outside/x", notInPlaces],
    ["open /ws/escape/x", notInPlaces],
    ["open /ws/missing.html", notInPlaces],
    ["open /ws/dist", notInPlaces],
    ["open $HOME/x", notInPlaces],
  ])("asks for `%s`, as it %s", (command, why) => {
    const decision = decisionOf(command);
    expect(decision?.permissionDecision).toBe("ask");
    expect(decision?.reason).toContain(why);
  });

  it("refuses `open` kept in the box, which can't reach Launch Services", () => {
    const decision = decisionOf("cd /ws | open AGENTS.md");
    expect(decision?.permissionDecision).toBe("deny");
    expect(decision?.reason).toContain(
      "the sandbox can't reach Launch Services",
    );
  });
});

describe("`open` in a runner step", () => {
  it.each(["open /ws/AGENTS.md", "open https://example.com"])(
    "refuses `%s`",
    (command) => {
      const decision = decisionOf(command, "runnerStep");
      expect(decision?.permissionDecision).toBe("deny");
      expect(decision?.reason).toContain(
        "shows the developer something, and nobody watches a runner step",
      );
    },
  );
});
