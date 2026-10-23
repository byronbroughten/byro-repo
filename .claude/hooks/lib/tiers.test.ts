import { describe, expect, it } from "vitest";

import {
  callsGh,
  decisionInMode,
  dryRunChoresOf,
  gateDecision,
  sessionModeOf,
} from "./tiers.ts";

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

  it("allows starting, listing and a plain remove of a workspace", () => {
    [
      "npm run issue:start -- byro-repo 261",
      "npm run issue:start -- --session glossary-fix --claude",
      "npm run issue:list",
      "npm run issue:remove -- byro-repo 261",
      "npm run issue:remove -- --session glossary-fix",
    ].forEach((command) => expect(decisionOf(command)).toBe("allow"));
  });

  it("asks for a forced workspace remove, which discards work git can't bring back", () => {
    [
      "npm run issue:remove -- byro-repo 261 --force",
      "npm run issue:remove -- --session glossary-fix --force",
      "npm run issue:remove --force -- --session glossary-fix",
    ].forEach((command) => expect(decisionOf(command)).toBe("ask"));
    expect(
      gateDecision({
        command: "npm run issue:remove -- --session glossary-fix --force",
        mode: "runnerStep",
        dryRuns: [],
      })?.permissionDecision,
    ).toBe("deny");
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

  it("treats --send before npm's `--` as npm's own flag, so a dry run", () => {
    expect(decisionOf("npm run app:chore fixRents --send")).toBeUndefined();
    expect(dryRunChoresOf("npm run app:chore fixRents --send")).toEqual([
      "fixRents",
    ]);
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

  it("asks for a clasp or sheets-framework run by version, path or npm exec", () => {
    [
      "npx clasp@2.4.2 deploy",
      "npx @google/clasp@latest deploy",
      "./node_modules/.bin/clasp deploy",
      "npm exec clasp deploy",
      "npm exec -- sheets-framework probe",
    ].forEach((command) => expect(decisionOf(command)).toBe("ask"));
  });

  it("asks for a publish behind npm's own flags", () => {
    expect(decisionOf("npm --prefix packages/utils publish")).toBe("ask");
    expect(decisionOf("npm -w @byronbroughten/utils publish")).toBe("ask");
  });

  it("allows nothing whose words hide a command substitution", () => {
    expect(decisionOf('git commit -m "$(git push origin master)"')).not.toBe(
      "allow",
    );
    expect(decisionOf('git commit -m "`git push`"')).not.toBe("allow");
  });

  it("has no opinion on an npm script named after an object built-in", () => {
    expect(decisionOf("npm run constructor")).toBeUndefined();
    expect(decisionOf("npm run toString")).toBeUndefined();
  });

  it("asks when any part of a compound command asks", () => {
    expect(decisionOf("git commit -m wip && git push")).toBe("ask");
  });
});

describe("a supervising session's gh calls", () => {
  function supervisedDecisionOf(command: string) {
    return gateDecision({
      command,
      mode: "interactive",
      dryRuns: [],
      supervising: true,
    });
  }
  const writes = [
    'gh issue comment 331 --body "Approved reply"',
    "gh issue edit 341 -R byronbroughten/byro-repo --add-label ready-for-agent",
    "gh issue close 341",
    'gh pr comment 12 -b "Looks right"',
    "gh api -X PATCH repos/o/r/issues/341 -f state=closed",
    "gh api --method=DELETE repos/o/r/issues/comments/9",
    "gh api -XPOST repos/o/r/issues/341/comments",
    "gh api repos/o/r/issues/341/comments -f body=hi",
    "gh api repos/o/r/issues/341/comments --input body.json",
    "gh api graphql -f query='mutation { x }'",
    "/opt/homebrew/bin/gh issue comment 331 -b hi",
    "env -i gh issue close 341",
    "bash -c 'gh issue close 341'",
    'echo "$(gh issue close 341)"',
    "git log | xargs gh issue comment 331 -b",
    'gh issue view "$(gh issue close 341)"',
    "gh api -iXPOST repos/o/r/issues/341/comments",
    "gh api -X post repos/o/r/issues/341/comments",
  ];

  it("asks for each write, naming the exact command", () => {
    writes.forEach((command) => {
      const decision = supervisedDecisionOf(command);
      expect(decision?.permissionDecision).toBe("ask");
      expect(decision?.reason).toContain(`\`${command}\``);
    });
  });

  it("lets reads through as before", () => {
    [
      "gh issue view 341 --comments",
      "gh pr list --state open",
      "gh pr diff 12",
      "gh api repos/o/r/issues/341",
      "gh api -X GET search/issues -f q=repo:o/r",
      "gh api --method HEAD repos/o/r",
      "gh search issues tier gate",
      "gh auth status",
    ].forEach((command) =>
      expect(supervisedDecisionOf(command)).toBeUndefined(),
    );
  });

  it("asks for a gh command it doesn't know to be a read", () => {
    expect(
      supervisedDecisionOf("gh release create v1")?.permissionDecision,
    ).toBe("ask");
    expect(
      supervisedDecisionOf("gh label delete bug")?.permissionDecision,
    ).toBe("ask");
  });

  it("decides the same writes as today in a session that isn't supervising", () => {
    writes.forEach((command) => {
      expect(
        gateDecision({ command, mode: "interactive", dryRuns: [] }),
      ).toBeUndefined();
    });
  });

  it("still asks in a compound command beside an allowed one", () => {
    expect(
      supervisedDecisionOf('git commit -m wip && gh issue comment 3 -b "x"')
        ?.permissionDecision,
    ).toBe("ask");
  });
});

describe("callsGh", () => {
  it("is true only when a command's text could run gh", () => {
    expect(callsGh("gh issue view 341")).toBe(true);
    expect(callsGh("bash -c 'gh issue close 3'")).toBe(true);
    expect(callsGh("npm test")).toBe(false);
    expect(callsGh("git log --oneline highlight")).toBe(false);
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

describe("runnerStep mode", () => {
  const asks = ["git push origin master", "npx clasp push", "npm publish"];

  it("turns every ask into a deny that says to record a blocker", () => {
    asks.forEach((command) => {
      const ask = gateDecision({ command, mode: "interactive", dryRuns: [] });
      const decision = gateDecision({
        command,
        mode: "runnerStep",
        dryRuns: [],
      });
      expect(ask?.permissionDecision).toBe("ask");
      expect(decision?.permissionDecision).toBe("deny");
      expect(decision?.reason).toContain(ask?.reason);
      expect(decision?.reason).toContain("`denied-tool` blocker");
    });
  });

  it("leaves allow and deny alone", () => {
    ['git commit -m "wip"', "npm run app:chore fixRents -- --send"].forEach(
      (command) => {
        expect(
          gateDecision({ command, mode: "runnerStep", dryRuns: [] }),
        ).toEqual(gateDecision({ command, mode: "interactive", dryRuns: [] }));
      },
    );
  });

  it("turns a gworkspace ask into a deny too", () => {
    const decision = decisionInMode(
      { permissionDecision: "ask", reason: "Tier gate: a share needs a yes." },
      "runnerStep",
    );
    expect(decision.permissionDecision).toBe("deny");
  });

  it("is the mode only when the runner's mark is set", () => {
    expect(sessionModeOf({})).toBe("interactive");
    expect(sessionModeOf({ BYRO_RUNNER_STEP: "1" })).toBe("runnerStep");
  });
});
