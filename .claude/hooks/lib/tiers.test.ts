import { describe, expect, it } from "vitest";

import { dryRunChoresOf, gateDecision } from "./tiers.ts";

function decisionOf(command: string, dryRuns: string[] = []) {
  return gateDecision({ command, mode: "interactive", dryRuns })
    ?.permissionDecision;
}

describe("gateDecision", () => {
  it("allows a commit on any branch", () => {
    expect(decisionOf('git commit -m "Add the gate"')).toBe("allow");
    expect(decisionOf("git -C packages/framework commit -am wip")).toBe(
      "allow",
    );
  });

  it("allows wrap-up, the app build and both deploy aliases", () => {
    expect(decisionOf("npm run wrap-up -- byro-repo 274")).toBe("allow");
    expect(decisionOf("npm run app:build")).toBe("allow");
    expect(decisionOf("npm run app:deploy")).toBe("allow");
    expect(decisionOf("npm run -s dev:deploy")).toBe("allow");
  });

  it("has no opinion on a command it doesn't list, alone or beside an allowed one", () => {
    expect(decisionOf("npm test")).toBeUndefined();
    expect(decisionOf("npm run app:gen:configs")).toBeUndefined();
    expect(decisionOf("rm -rf dist")).toBeUndefined();
    expect(decisionOf("git commit -m wip && rm -rf dist")).toBeUndefined();
  });

  it("allows a chore's send once that chore's dry run is recorded", () => {
    expect(
      decisionOf("npm run app:chore fixRents -- --send", ["fixRents"]),
    ).toBe("allow");
  });

  it("denies a chore's send with no dry run of that chore, naming the dry-run command", () => {
    [[], ["otherChore"]].forEach((dryRuns) => {
      const decision = gateDecision({
        command: "npm run app:chore fixRents -- --send",
        mode: "interactive",
        dryRuns,
      });
      expect(decision?.permissionDecision).toBe("deny");
      expect(decision?.reason).toContain(
        "run `npm run app:chore fixRents` first",
      );
    });
  });

  it("denies a send in the same call as its own dry run", () => {
    expect(
      decisionOf(
        "npm run app:chore fixRents && npm run app:chore fixRents -- --send",
      ),
    ).toBe("deny");
  });

  it("asks for a raw push, a publish, and a bare clasp or sheets-framework, naming the command", () => {
    [
      "git push origin issue-274-gate",
      "git -C packages/framework push",
      "npm publish --access public",
      "clasp deploy",
      "npx clasp push",
      "npx sheets-framework gen:configs",
    ].forEach((command) => {
      const decision = gateDecision({
        command,
        mode: "interactive",
        dryRuns: [],
      });
      expect(decision?.permissionDecision).toBe("ask");
      expect(decision?.reason).toContain(`\`${command}\``);
    });
  });

  it("asks when any part of a compound command asks", () => {
    expect(decisionOf("git commit -m wip && git push")).toBe("ask");
  });
});

describe("dryRunChoresOf", () => {
  it("names each app chore a command runs without sending", () => {
    expect(dryRunChoresOf("npm run app:chore fixRents")).toEqual(["fixRents"]);
    expect(
      dryRunChoresOf("npm run app:chore fixRents -- --json | tail; npm test"),
    ).toEqual(["fixRents"]);
  });

  it("names nothing for a send, a dev chore or a chore with no name", () => {
    expect(dryRunChoresOf("npm run app:chore fixRents -- --send")).toEqual([]);
    expect(dryRunChoresOf("npm run dev:chore buildFixtures")).toEqual([]);
    expect(dryRunChoresOf("npm run app:chore")).toEqual([]);
  });
});
