import { describe, expect, it } from "vitest";

import {
  blockerInstead,
  type CallSandbox,
  decisionInMode,
  dryRunChoresOf,
  gateDecision,
  type SessionMode,
  sessionModeOf,
  spreadsheetTargetsOf,
} from "./tiers.ts";

function decisionOf(command: string, dryRuns: string[] = []) {
  return gateDecision({ command, mode: "interactive", dryRuns })
    ?.permissionDecision;
}

function modeDecisionOf(command: string, mode: SessionMode = "interactive") {
  return gateDecision({ command, mode, dryRuns: [] });
}

function runnerStepDecisionOf(command: string) {
  return modeDecisionOf(command, "runnerStep")?.permissionDecision;
}

describe("gateDecision", () => {
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

  it("allows releasing a workspace's lease, which issue:start takes back", () => {
    [
      "npm run issue:release -- byro-repo 484",
      "npm run issue:release -- --session glossary-fix",
    ].forEach((command) => expect(decisionOf(command)).toBe("allow"));
  });

  it("allows a backlink in a session and a runner step, beside gh issue edit", () => {
    const command =
      "npm run issue:backlink -- byro-repo 372 docs/adr/0007-issue-reader.md";

    expect(decisionOf(command)).toBe("allow");
    expect(runnerStepDecisionOf(command)).toBe("allow");
  });

  it("asks for a forced workspace remove, which discards work git can't bring back", () => {
    [
      "npm run issue:remove -- byro-repo 261 --force",
      "npm run issue:remove -- --session glossary-fix --force",
      "npm run issue:remove --force -- --session glossary-fix",
    ].forEach((command) => expect(decisionOf(command)).toBe("ask"));
    expect(
      runnerStepDecisionOf(
        "npm run issue:remove -- --session glossary-fix --force",
      ),
    ).toBe("deny");
  });

  it("asks for a sandbox check keeping excluded commands, which run outside the box with no hook", () => {
    const command =
      "npm run session:probe -- --sandbox-check --keep-excluded . /tmp/commands.txt";
    expect(decisionOf(command)).toBe("ask");
    expect(runnerStepDecisionOf(command)).toBe("deny");
  });

  it("has no opinion on a command it doesn't list, alone or beside an allowed one", () => {
    expect(decisionOf("make build")).toBeUndefined();
    expect(decisionOf("npm run app:gen:configs")).toBeUndefined();
    expect(decisionOf("git commit -m wip")).toBeUndefined();
    expect(decisionOf("npm run lint && make build")).toBeUndefined();
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

  it("asks for a raw push and a bare clasp or sheets-framework, naming the command", () => {
    [
      "git push origin issue-274-gate",
      "git -C packages/framework push",
      "clasp deploy",
      "npx clasp push",
      "npx sheets-framework gen:configs",
    ].forEach((command) => {
      const decision = modeDecisionOf(command);
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

  it("allows nothing whose words hide a command substitution", () => {
    expect(
      decisionOf(
        'gh issue create --title T --body "$(git push origin master)"',
      ),
    ).not.toBe("allow");
    expect(decisionOf('gh issue create --title "`git push`"')).not.toBe(
      "allow",
    );
  });

  it("has no opinion on an npm script named after an object built-in", () => {
    expect(decisionOf("npm run constructor")).toBeUndefined();
    expect(decisionOf("npm run toString")).toBeUndefined();
  });

  it("asks when any part of a compound command asks", () => {
    expect(decisionOf("npm run lint && git push")).toBe("ask");
  });

  it("decides `npm run -s` and `timeout` on what they wrap", () => {
    [
      "npm run -s check",
      "npm run -s issue:read -- byro-repo 447 --body --hide-others",
      "timeout 60 npm test",
    ].forEach((command) => expect(decisionOf(command)).toBe("allow"));
    expect(decisionOf("timeout 60 git push")).toBe("ask");
  });
});

describe("heredocs and substitutions", () => {
  it("reads a heredoc behind a quoted delimiter as plain text, since bash expands nothing in its body", () => {
    [
      "gh issue create --title T --body-file - <<'EOF'\nA `code` span, a | pipe and $(rm -rf dist)\nEOF",
      'gh issue create --title T --body-file - <<"EOF"\n# Title; with a ( paren\nEOF',
      "gh label list <<'EOF'\nx\nEOF\ngh label list",
    ].forEach((command) => expect(decisionOf(command)).toBe("allow"));
  });

  it("allows no heredoc bash may expand, nor one its scan reads differently from the text match", () => {
    [
      "gh label list <<EOF\nhi\nEOF",
      "gh issue create --title T --body-file - <<EOF\nok\nEOF",
      "gh label list <<< y\ngit push",
      "gh label list # <<'EOF'\ngit push\nEOF",
      "gh label list '<<EOF'\ngit push\nEOF",
      "gh label list <<'EOF' \\\n> /tmp/s372/a.md\nbody\nEOF",
      'gh label list "$(gh label list " <<\'X\'")"\ngit push\nX',
      'gh label list "${a:-" <<\'X\'"}"\ngit push\nX',
      'gh label list $((1<<"2"))\ngit push\n2',
    ].forEach((command) => expect(decisionOf(command)).not.toBe("allow"));
  });

  it("allows a free call whose substitutions hold only free calls, quoted or not", () => {
    [
      'gh issue create --title T --body "#488: $(gh label list)"',
      "gh issue create --title `gh label list`",
      'gh issue create --title "$(gh label list "$(gh label list)")"',
    ].forEach((command) => expect(decisionOf(command)).toBe("allow"));
  });

  it("gives a call the tier of the strictest command in its substitutions", () => {
    [
      'gh issue create --title "$(git push origin master)"',
      "gh label list `git push`",
      'gh label list "$(gh label list "$(git push)")"',
    ].forEach((command) => expect(decisionOf(command)).toBe("ask"));
    expect(decisionOf('gh label list "$(make notes)"')).toBeUndefined();
  });

  it("never takes a substitution's output for a known program", () => {
    expect(decisionOf("$(echo gh) label list")).toBeUndefined();
  });

  it("allows no call whose substitution it can't read", () => {
    [
      'gh label list "$(gh label list"',
      "gh label list `gh label list",
      'gh label list "$(gh label list # )\nrm -rf dist\n)"',
      "gh issue create --title T --body-file - <<EOF\n$(git push)\nEOF",
      "gh label list $'\\'' $(git push) $'\\''",
      'gh label list "$(case a in a) rm -rf dist;; esac)"',
    ].forEach((command) => expect(decisionOf(command)).not.toBe("allow"));
  });

  it("allows no substitution beside a `${…}` or a comment, which bash reads differently", () => {
    [
      "echo $(echo ${x#) #} ; git push)",
      "echo $(echo ${x#) #} ; rm -rf x)",
      'echo "$(echo "${x#")"}" ; git push)"',
      "echo ${y:-a #} $(git push)",
      "(( # )) ; $(git push)",
      'echo "$( (( #)) ; git push\n)))"',
      "echo $(( #))",
    ].forEach((command) => expect(decisionOf(command)).toBe("deny"));
  });
});

describe("a runner step's unclassified call", () => {
  it("is denied with the blocker text in a runner step, and left undecided in an Interactive session", () => {
    const decision = modeDecisionOf("make build", "runnerStep");
    expect(decision?.permissionDecision).toBe("deny");
    expect(decision?.reason).toContain("`make build`");
    expect(decision?.reason).toContain(blockerInstead);
    expect(modeDecisionOf("make build")).toBeUndefined();
  });

  it("leaves a call naming gh or a live alias to Claude Code's allow rules in an Interactive session", () => {
    [
      "gh issue edit 447 --body-file /tmp/body.md",
      "gh issue close 447",
      "gh pr view 12",
      "npm run app:gen:configs",
      "npm run -s dev:push",
    ].forEach((command) => expect(modeDecisionOf(command)).toBeUndefined());
  });
});

describe("a runner step's gh calls", () => {
  it("allows an issue edit or comment on any issue", () => {
    [
      "gh issue edit 447 --body-file /tmp/body.md",
      "gh issue edit 341 -R byronbroughten/byro-repo --add-label ready-for-agent",
      "gh issue comment 447 -b done",
    ].forEach((command) => expect(runnerStepDecisionOf(command)).toBe("allow"));
  });

  it("denies closing an issue with the blocker text", () => {
    const decision = modeDecisionOf("gh issue close 447", "runnerStep");
    expect(decision?.permissionDecision).toBe("deny");
    expect(decision?.reason).toContain(blockerInstead);
  });

  it("denies every other gh call as unclassified, reads included", () => {
    [
      "gh api repos/x/y/issues/1/comments",
      "gh pr create --fill",
      "gh issue view 389",
      "gh issue list",
      "gh issue reopen 447",
    ].forEach((command) => {
      const decision = modeDecisionOf(command, "runnerStep");
      expect(decision?.permissionDecision).toBe("deny");
      expect(decision?.reason).toContain("doesn't classify");
    });
  });

  it("denies a write whose body could hide a command, naming --body-file instead of a blocker", () => {
    [
      "gh issue comment 447 --body-file - <<EOF\nok\nEOF",
      "gh issue comment 447 --body-file - <<'EOF'\nok\nEOF",
      'gh issue comment 447 --body "Fails at `Api.ts`"',
      'gh issue edit 447 --body "$(cat notes.md)"',
      "gh issue comment 447 --body `cat notes.md`",
      'gh issue edit 447 --body "$(git push)"',
    ].forEach((command) => {
      const decision = modeDecisionOf(command, "runnerStep");
      expect(decision?.permissionDecision).toBe("deny");
      expect(decision?.reason).toContain("--body-file");
      expect(decision?.reason).not.toContain(blockerInstead);
    });
  });

  it("leaves an Interactive session's write with a backtick to Claude Code", () => {
    expect(
      modeDecisionOf('gh issue comment 447 --body "Fails at `Api.ts`"'),
    ).toBeUndefined();
  });

  it("names no --body-file for another call with a backtick", () => {
    const decision = modeDecisionOf("make `ls`", "runnerStep");
    expect(decision?.reason).not.toContain("--body-file");
  });
});

describe("an Interactive session's gh calls", () => {
  it("allows creating an issue, and refuses it in a runner step", () => {
    const command =
      "gh issue create -R ByronBroughten/byro-repo --title T --body-file /tmp/body.md --label ready-for-agent";
    expect(decisionOf(command)).toBe("allow");
    expect(runnerStepDecisionOf(command)).toBe("deny");
  });

  it("allows a gh api read, and refuses it in a runner step", () => {
    [
      "gh api repos/x/y/issues/475 --jq .id",
      "gh api -X GET search/issues -f q=repo:x/y",
      "gh api --method=get repos/x/y/issues/476/sub_issues --paginate",
      "gh api repos/x/y/issues/476/dependencies/blocked_by --jq '.[].number'",
    ].forEach((command) => {
      expect(decisionOf(command)).toBe("allow");
      expect(runnerStepDecisionOf(command)).toBe("deny");
    });
  });

  it("allows adding or removing a blocked-by link or a sub-issue, and refuses it in a runner step", () => {
    [
      "gh api --method POST repos/x/y/issues/477/dependencies/blocked_by -F issue_id=123",
      "gh api -X DELETE /repos/x/y/issues/477/dependencies/blocked_by/123",
      "gh api -XPOST repos/x/y/issues/476/sub_issues -F sub_issue_id=456",
      "gh api --method=DELETE repos/x/y/issues/476/sub_issue -F sub_issue_id=456",
    ].forEach((command) => {
      expect(decisionOf(command)).toBe("allow");
      expect(runnerStepDecisionOf(command)).toBe("deny");
    });
  });

  it("allows editing an issue comment, and refuses it in a runner step", () => {
    [
      "gh api --method PATCH repos/x/y/issues/comments/987 -F body=@/tmp/body.md",
      "gh api -X patch /repos/x/y/issues/comments/987 -f body=Fixed",
    ].forEach((command) => {
      expect(decisionOf(command)).toBe("allow");
      expect(runnerStepDecisionOf(command)).toBe("deny");
    });
  });

  it("allows a variable issue number or comment id, and refuses it in a runner step", () => {
    [
      "gh api --method POST repos/o/r/issues/$n/dependencies/blocked_by -F issue_id=$id",
      "gh api --method POST repos/o/r/issues/${n}/dependencies/blocked_by -F issue_id=$id",
      "gh api --method POST repos/o/r/issues/$1/dependencies/blocked_by -F issue_id=$2",
      "gh api -X DELETE repos/o/r/issues/$n/dependencies/blocked_by/$id",
      "gh api --method POST repos/o/r/issues/$n/sub_issues -F sub_issue_id=$id",
      "gh api --method PATCH repos/o/r/issues/comments/$c -f body=x",
      "e(){ gh api --method POST repos/o/r/issues/$1/dependencies/blocked_by -F issue_id=$2; }; e 547 1",
    ].forEach((command) => {
      expect(decisionOf(command)).toBe("allow");
      expect(runnerStepDecisionOf(command)).toBe("deny");
    });
  });

  it("leaves a variable owner or repo to Claude Code", () => {
    [
      "gh api --method POST repos/$o/r/issues/1/dependencies/blocked_by -F issue_id=2",
      "gh api --method POST repos/o/$r/issues/$n/sub_issues -F sub_issue_id=2",
    ].forEach((command) => expect(decisionOf(command)).toBeUndefined());
  });

  it("allows the runner's decide, and refuses it in a runner step", () => {
    [
      'npm run runner -- decide ByronBroughten/byro-repo 372 R159.1 "accepted"',
      'npm run runner -- decide ByronBroughten/byro-repo 372 R159.1 --handled "filed #490"',
    ].forEach((command) => {
      expect(decisionOf(command)).toBe("allow");
      expect(runnerStepDecisionOf(command)).toBe("deny");
    });
    expect(
      decisionOf("npm run runner -- ByronBroughten/byro-repo 372"),
    ).toBeUndefined();
  });

  it("allows the research push, and refuses it in a runner step", () => {
    expect(decisionOf("npm run research:push")).toBe("allow");
    const stepDecision = modeDecisionOf("npm run research:push", "runnerStep");
    expect(stepDecision?.permissionDecision).toBe("deny");
    expect(stepDecision?.reason).toContain("only an Interactive session");
    expect(decisionOf("npm --prefix x run research:push")).toBeUndefined();
    expect(decisionOf("git push -u origin research/x")).toBe("ask");
  });

  it("asks for the Google script route in a session, naming the box gap, and refuses it in a runner step", () => {
    const command = "npm run google:script -- /tmp/claude-501/probe.ts";
    const sessionDecision = modeDecisionOf(command);
    expect(sessionDecision?.permissionDecision).toBe("ask");
    expect(sessionDecision?.reason).toContain("agent account's access token");
    expect(sessionDecision?.reason).toContain("outside the box");
    expect(sessionDecision?.reason).toContain("credential files");
    const stepDecision = modeDecisionOf(command, "runnerStep");
    expect(stepDecision?.permissionDecision).toBe("deny");
    expect(stepDecision?.reason).toContain("only an Interactive session");
    expect(stepDecision?.reason).toContain(blockerInstead);
    expect(
      decisionOf("npm --prefix x run google:script -- probe.ts"),
    ).toBeUndefined();
  });

  it("leaves any other gh api write to Claude Code", () => {
    [
      "gh api -X DELETE repos/x/y/issues/comments/987",
      "gh api repos/x/y/issues/comments/987 -f body=Fixed",
      "gh api -X PATCH repos/x/y/pulls/comments/987 -f body=Fixed",
      // A field with no method named makes gh send a POST.
      "gh api repos/x/y/issues -f title=T",
      "gh api graphql --input /tmp/query.json",
      "gh api -X PATCH repos/x/y/issues/476 -f state=closed",
      "gh api -X DELETE repos/x/y/git/refs/heads/main",
      "gh api --method POST repos/x/y/issues/476/comments -f body=hi",
      // The issue-link path sits in a flag's value; the endpoint is the ref.
      "gh api -X DELETE -q repos/x/y/issues/1/sub_issue repos/x/y/git/refs/heads/main",
      "gh api -X DELETE repos/x/y/issues/1/sub_issue repos/x/y/git/refs/heads/main",
      "gh api --unknown-flag repos/x/y/issues/1",
      "gh api -iX DELETE repos/x/y/issues/1/sub_issue",
      "gh api -X",
    ].forEach((command) => expect(decisionOf(command)).toBeUndefined());
  });

  it("leaves a create or api call hiding a command to Claude Code", () => {
    [
      'gh issue create --title T --body "$(make notes)"',
      "gh issue create --title T --body-file - <<EOF\nok\nEOF",
      "gh api repos/x/y/issues/`id`",
    ].forEach((command) => expect(decisionOf(command)).toBeUndefined());
  });
});

describe("loops, conditionals, groups and functions", () => {
  it("allows one made only of free commands in an Interactive session", () => {
    [
      "for id in 1 2; do gh api --method POST repos/o/r/issues/519/sub_issues -F sub_issue_id=$id; done",
      "e(){ gh api --method POST repos/o/r/issues/519/sub_issues -F sub_issue_id=$1; }; e 1",
      "function e { gh api repos/o/r/issues/$1; }\ne 1\ne 2",
      "for f in a b\ndo\n  npm run lint\ndone",
      "while npm run lint; do npm run tsc; done",
      "until npm run lint; do npm run tsc; done",
      "if npm run lint; then npm run tsc; elif npm test; then npm run tsc; else npm test; fi",
      "! npm run lint",
      "{ npm run lint; npm run tsc; }",
      "(npm run lint; npm run tsc)",
      "case x in a|b) npm run lint;; *) npm run tsc;; esac",
      "case x in\n  (a) npm run lint ;;\n  b) npm run tsc\nesac",
      "for f in $(gh label list); do npm run lint; done",
      "for f in a; do gh label list done; done",
      "{ npm run lint; } 2>&1",
    ].forEach((command) => expect(decisionOf(command)).toBe("allow"));
  });

  it("asks for one holding a command that asks, a function's call included", () => {
    [
      "for i in 1; do git push; done",
      "{ git push; }",
      "if npm run lint; then git push; fi",
      "ls(){ git push; }; ls",
      "e(){ npm run lint; }; e; git push",
      "for f in $(git push); do npm run lint; done",
      "for i do git push; done",
      "for i\ndo git push\ndone",
      "select i do git push; done",
      "f(){ for i do git push; done; }; f 1",
    ].forEach((command) => expect(decisionOf(command)).toBe("ask"));
  });

  it("refuses a runner step's loop as it refuses the command inside", () => {
    const decision = modeDecisionOf(
      "for n in 1 2; do gh issue close $n; done",
      "runnerStep",
    );
    expect(decision?.permissionDecision).toBe("deny");
    expect(decision?.reason).toContain(blockerInstead);
  });

  it("refuses one it can't read as bash would", () => {
    [
      "for i in 1; do npm run lint",
      "{ npm run lint",
      "npm run lint; }",
      "if npm run lint; then npm run tsc; done",
      "f(){ f; }; f",
      "f; f(){ npm run lint; }",
      "e(){ npm run lint; }; echo $(e)",
      "e(){ gh label list $1; }; e 'a b'",
      "f() npm run lint",
      '"for" x in 1; do npm run lint; done',
      "case x in a) npm run lint;; esac; ;;",
      "for; do npm run lint; done",
      "for i x; do npm run lint; done",
    ].forEach((command) => expect(decisionOf(command)).toBe("deny"));
  });

  it("leaves a function whose argument it can't follow to Claude Code", () => {
    expect(decisionOf("f(){ shift; git $1; }; f status push")).toBeUndefined();
  });
});

describe("a call the gate can't parse", () => {
  const wayThrough =
    "put text in single quotes, write a body to a file under `/tmp` and pass it with `--body-file`, or run each part in a call of its own";
  const failures: [string, string, string][] = [
    ["an unbalanced quote", 'echo "unterminated', "a quote left open"],
    [
      "an unclosed substitution",
      "gh label list $(gh label list",
      "a command substitution left open",
    ],
    [
      "an unclosed backtick",
      "gh label list `gh label list",
      "a command substitution left open",
    ],
    [
      "a `${…}` beside a substitution",
      "echo ${y:-a #} $(git push)",
      "a comment or `${…}` beside a command substitution",
    ],
    [
      "a comment inside a substitution",
      'gh label list "$(gh label list # )\nrm -rf dist\n)"',
      "a comment or `${…}` beside a command substitution",
    ],
    [
      "compound syntax it can't read",
      "for i in 1; do npm run lint",
      "compound syntax the gate can't read as bash would",
    ],
    [
      "a function called across a substitution",
      "e(){ npm run lint; }; echo $(e)",
      "a function called across a substitution",
    ],
  ];

  it.each(failures)(
    "refuses %s in an Interactive session, naming it and the way through",
    (_kind, command, failure) => {
      const decision = modeDecisionOf(command);
      expect(decision?.permissionDecision).toBe("deny");
      expect(decision?.reason).toContain(failure);
      expect(decision?.reason).toContain(wayThrough);
    },
  );

  it.each(failures)(
    "still refuses %s in a runner step, as an unclassified call with a blocker",
    (_kind, command) => {
      const decision = modeDecisionOf(command, "runnerStep");
      expect(decision?.permissionDecision).toBe("deny");
      expect(decision?.reason).toContain("doesn't classify");
      expect(decision?.reason).toContain(blockerInstead);
    },
  );

  it("refuses it with the sandbox on or off, and before the sandbox-off ask", () => {
    const command = 'echo "unterminated';
    const sandboxes: CallSandbox[] = [
      { isOn: true, excludedCommands: [] },
      { isOn: false, excludedCommands: [] },
      {
        isOn: false,
        excludedCommands: [],
        off: {
          cause: "`sandbox.enabled` isn't true",
          fix: "turn it on",
          excludedCommands: [],
        },
      },
    ];
    sandboxes.forEach((sandbox) => {
      const decision = gateDecision({
        command,
        mode: "interactive",
        dryRuns: [],
        sandbox,
      });
      expect(decision?.permissionDecision).toBe("deny");
      expect(decision?.reason).toContain("a quote left open");
    });
  });

  it("leaves a call it parses to its tier", () => {
    expect(decisionOf("npm run check")).toBe("allow");
    expect(decisionOf("git push origin master")).toBe("ask");
  });
});

describe("free reads and standing yeses in both modes", () => {
  it("allows gh label list, Jev, the session probe and the outline in a session and a runner step", () => {
    [
      "gh label list -R ByronBroughten/byro-repo",
      "npm run jev -- /tmp/request.json",
      "npm run -s jev -- /tmp/request.json",
      "npm run jev:style -- writing/piece.md",
      "npm run session:probe -- /tmp/folder",
      "npm run session:probe -- --sandbox-check /tmp/folder /tmp/commands.txt",
      "npm run outline -- scripts/overlap/overlap.ts",
      "npm run ws:rm -- .claude/hooks/old.ts .claude/skills/old/SKILL.md",
    ].forEach((command) => {
      expect(decisionOf(command)).toBe("allow");
      expect(runnerStepDecisionOf(command)).toBe("allow");
    });
  });

  it("allows the outcome summary as a read", () => {
    [
      "npm run outcome:summary -- byro-repo-480",
      "npm run outcome:summary -- --recent 3",
      "npm run -s outcome:summary -- --all",
    ].forEach((command) => expect(decisionOf(command)).toBe("allow"));
  });

  it("allows the prompt scan as a read", () => {
    ["npm run prompt:scan", "npm run -s prompt:scan -- --sessions 20"].forEach(
      (command) => expect(decisionOf(command)).toBe("allow"),
    );
  });

  it("leaves other gh label calls to Claude Code", () => {
    expect(decisionOf("gh label create urgent")).toBeUndefined();
    expect(decisionOf("gh label delete urgent")).toBeUndefined();
  });
});

describe("a runner step's live aliases", () => {
  function targetedDecisionOf(command: string, spreadsheetTargets: string[]) {
    return gateDecision({
      command,
      mode: "runnerStep",
      dryRuns: [],
      spreadsheetTargets,
    });
  }

  it("allows the aliases a spreadsheet target gives", () => {
    [
      "npm run app:probe -- --sheet Units",
      "npm run -s app:configs:diff",
      "npm run app:chore fixRents",
      "npm run app:gen:configs",
    ].forEach((command) =>
      expect(targetedDecisionOf(command, ["app"])?.permissionDecision).toBe(
        "allow",
      ),
    );
    ["npm run dev:push", "npm run dev:run fixtures"].forEach((command) =>
      expect(targetedDecisionOf(command, ["dev"])?.permissionDecision).toBe(
        "allow",
      ),
    );
  });

  it("denies a spreadsheet the ticket doesn't target, with the blocker text", () => {
    const untargeted: [string, string[]][] = [
      ["npm run app:probe", []],
      ["npm run app:deploy", ["dev"]],
      ["npm run -s dev:push", ["app"]],
    ];
    untargeted.forEach(([command, targets]) => {
      const decision = targetedDecisionOf(command, targets);
      expect(decision?.permissionDecision).toBe("deny");
      expect(decision?.reason).toContain(blockerInstead);
    });
  });

  it("denies an alias no target gives", () => {
    ["npm run app:push", "npm run app:run x", "npm run dev:clean"].forEach(
      (command) =>
        expect(
          targetedDecisionOf(command, ["app", "dev"])?.permissionDecision,
        ).toBe("deny"),
    );
  });

  it("still needs a dry run before an app chore's send", () => {
    const send = "npm run app:chore fixRents -- --send";
    expect(targetedDecisionOf(send, ["app"])?.reason).toContain("no dry run");
    expect(
      gateDecision({
        command: send,
        mode: "runnerStep",
        dryRuns: ["fixRents"],
        spreadsheetTargets: ["app"],
      })?.permissionDecision,
    ).toBe("allow");
  });
});

describe("spreadsheetTargetsOf", () => {
  it("names each spreadsheet target, skipping Docs", () => {
    const targets = JSON.stringify([
      { kind: "spreadsheet", name: "app" },
      { kind: "doc", id: "1abc" },
      { kind: "spreadsheet", name: "dev" },
    ]);
    expect(spreadsheetTargetsOf(targets)).toEqual(["app", "dev"]);
  });

  it("names none when the variable is unset or unreadable", () => {
    expect(spreadsheetTargetsOf(undefined)).toEqual([]);
    expect(spreadsheetTargetsOf("not json")).toEqual([]);
    expect(spreadsheetTargetsOf('{"kind":"spreadsheet"}')).toEqual([]);
  });
});

describe("a Supervisor's gh writes", () => {
  // The gate takes no supervision input, so a session holding a record gets the same call as one without.
  it("leaves a gh issue comment and edit to the allow rules, as for any interactive session", () => {
    [
      'gh issue comment 331 --body "Approved reply"',
      "gh issue edit 341 -R byronbroughten/byro-repo --add-label ready-for-agent",
    ].forEach((command) => expect(modeDecisionOf(command)).toBeUndefined());
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

describe("a sandboxed call", () => {
  const entries = ["npm run app*", "npm run check"];
  const modes: SessionMode[] = ["interactive", "runnerStep"];

  function decisionUnder(command: string, mode: SessionMode, isOn: boolean) {
    return gateDecision({
      command,
      mode,
      dryRuns: [],
      sandbox: { isOn, excludedCommands: entries },
    });
  }

  function sandboxedDecisionOf(command: string, mode: SessionMode) {
    return decisionUnder(command, mode, true);
  }

  it("is allowed, naming the box, in both modes", () => {
    [
      "node .scratch/x.ts",
      "node -e 'console.log(1)'",
      "python3 -c 'print(1)'",
      "for n in 1 2; do echo $n > /tmp/x-$n.md; done",
      "git checkout -b x",
      "git reset --hard HEAD~1",
      "git commit -m x",
      "git status && grep -n x AGENTS.md | sort",
    ].forEach((command) =>
      modes.forEach((mode) => {
        const decision = sandboxedDecisionOf(command, mode);
        expect(decision?.permissionDecision).toBe("allow");
        expect(decision?.reason).toContain("sandbox");
      }),
    );
  });

  it("gets the tier rows' decision when it holds gh or a git push, or can't be parsed", () => {
    [
      "cd x && git push",
      "git -C x push",
      "git --git-dir=x/.git push",
      "git --work-tree x push origin",
      "echo $(gh api -X POST repos/o/r/issues)",
      "echo `gh api -X POST repos/o/r/issues`",
      "gh issue close 5",
      "gh issue view 5",
      "for i in 1; do git push; done",
      "if true; then gh issue close 5; fi",
      "{ git push; }",
      "e(){ gh issue close $1; }; e 5",
      "echo 5 | xargs gh issue close",
      "find . -name x -exec gh issue close 5 ;",
      "timeout 5 git push",
      "env -u X gh issue close 5",
      "nice -n 5 git push",
      "/usr/bin/gh issue close 5",
      "cat <<EOF\n$(gh issue close 5)\nEOF",
      "echo $'\\x67h'",
      "for i in 1; do ls",
      "npm run app:deploy",
      "{gh,issue} close 5",
      "git{,} push",
    ].forEach((command) =>
      modes.forEach((mode) =>
        expect(sandboxedDecisionOf(command, mode)).toEqual(
          decisionUnder(command, mode, false),
        ),
      ),
    );
  });

  it("keeps the asks and refusals the ticket names", () => {
    expect(
      sandboxedDecisionOf("cd x && git push", "interactive")
        ?.permissionDecision,
    ).toBe("ask");
    expect(sandboxedDecisionOf("gh issue view 5", "interactive")).toBe(
      undefined,
    );
    expect(
      sandboxedDecisionOf("gh issue view 5", "runnerStep")?.permissionDecision,
    ).toBe("deny");
    expect(
      sandboxedDecisionOf("npm run app:deploy", "interactive")?.reason,
    ).not.toContain("sandbox");
  });

  it("asks for the push in a commit chained with one", () => {
    const decision = sandboxedDecisionOf(
      "git commit -m x && git push",
      "interactive",
    );
    expect(decision?.permissionDecision).toBe("ask");
    expect(decision?.reason).toContain("pushes outside `npm run wrap-up`");
  });

  it("gives a free command piped into a gh call the gh row's decision", () => {
    const gh = "gh issue comment 5 --body-file b.md";
    modes.forEach((mode) =>
      expect(
        sandboxedDecisionOf(`grep x | ${gh}`, mode)?.permissionDecision,
      ).toBe(sandboxedDecisionOf(gh, mode)?.permissionDecision),
    );
    expect(
      sandboxedDecisionOf(`grep x | ${gh}`, "runnerStep")?.permissionDecision,
    ).toBe("allow");
  });

  it("is decided by its gh and git push rows alone, naming the box for the rest", () => {
    const loop =
      "for i in 1 2 3; do tail -n +2 $i.md > body$i.md; gh issue create --title t --body-file body$i.md; done";
    const decision = sandboxedDecisionOf(loop, "interactive");
    expect(decision).toEqual({
      ...sandboxedDecisionOf(
        "gh issue create --title t --body-file body$i.md",
        "interactive",
      ),
      reason: expect.stringContaining("The rest of"),
    });
    expect(decision?.permissionDecision).toBe("allow");
    expect(decision?.reason).toContain("runs in the sandbox");
    const view = sandboxedDecisionOf(
      "node x.ts && gh issue view 5",
      "interactive",
    );
    expect(view).toEqual(sandboxedDecisionOf("gh issue view 5", "interactive"));
  });

  it("denies a runner step's gh issue view even beside a free command", () => {
    expect(
      sandboxedDecisionOf("node x.ts && gh issue view 5", "runnerStep")
        ?.permissionDecision,
    ).toBe("deny");
  });

  it("allows a create whose body is a free command's output", () => {
    expect(
      sandboxedDecisionOf(
        'gh issue create --title T --body "$(cat notes.md)"',
        "interactive",
      )?.permissionDecision,
    ).toBe("allow");
  });

  it("still refuses a runner step's `$(…)` body, naming --body-file", () => {
    const decision = sandboxedDecisionOf(
      'tail -n +2 x.md > y.md && gh issue comment 5 --body "$(cat y.md)"',
      "runnerStep",
    );
    expect(decision?.permissionDecision).toBe("deny");
    expect(decision?.reason).toContain("--body-file");
  });

  it("still refuses a call keeping an excluded command in the box", () => {
    expect(
      sandboxedDecisionOf("npm run check | tail", "interactive")
        ?.permissionDecision,
    ).toBe("deny");
  });
});

// #594's misreads, each call as its session's transcript holds it, under settings.json's entries.
describe("a call the gate once misread", () => {
  const entries = [
    "npm run issue*",
    "npm run wrap-up *",
    "npm run check",
    "npm run check *",
    "ps",
    "ps *",
  ];

  function interactiveDecisionOf(command: string) {
    return gateDecision({
      command,
      mode: "interactive",
      dryRuns: [],
      sandbox: { isOn: true, excludedCommands: entries },
    });
  }

  it("refuses a wrap-up whose closing note holds an escaped `$(`, naming --closing-file", () => {
    const command =
      'npm run wrap-up -- byro-repo 554 --closing "A cd inside backticks now reads as nested, so the branch guard and the Bash read classifier keep the folder before it, with guard and read cases beside the \\$(cd …) ones; SegmentReader, HeredocScanner and SubstitutionScanner moved into tiers/ShellParser/ with every importer updated."';
    const decision = interactiveDecisionOf(command);
    expect(decision?.permissionDecision).toBe("deny");
    expect(decision?.reason).toContain(
      "A `$(` or backtick keeps it in the sandbox even quoted or escaped, so pass the closing note with `--closing-file <path>`",
    );
  });

  it("lets an excluded call holding a quoted `<<` out of the box", () => {
    expect(interactiveDecisionOf('ps -p 1 -o "comm=<<x"')).toEqual({
      permissionDecision: "allow",
      reason: "Tier gate: `ps` only reads the process list.",
    });
  });

  it('allows a loop writing relative to a `cd "$TMPDIR/…"` beside its `$(gh …)`, the rest in the sandbox', () => {
    const decision = interactiveDecisionOf(
      'cd "$TMPDIR/ct529" && for i in 1 2 3 4; do title=$(head -1 $i.md | sed \'s/^# //\'); tail -n +2 $i.md > body$i.md; url=$(gh issue create -R ByronBroughten/byro-repo --title "$title" --body-file body$i.md --label ready-for-agent); echo "$i $url"; done',
    );
    expect(decision?.permissionDecision).toBe("allow");
    expect(decision?.reason).toContain("`gh issue close` undoes it.");
    expect(decision?.reason).toContain("The rest of");
    expect(decision?.reason).toContain("runs in the sandbox");
  });
});

describe("a call with the sandbox off", () => {
  const entries = ["npm run issue*", "npm run check", "npm test", "npm test *"];
  const off = {
    cause: "`sandbox.enabled` isn't true",
    fix: 'set `"enabled": true` in the `sandbox` block',
  };
  const modes: SessionMode[] = ["interactive", "runnerStep"];

  // The entries go in beside `off` as tierGate.ts passes them for an enabled box.
  function offDecisionOf(command: string, mode: SessionMode) {
    return gateDecision({
      command,
      mode,
      dryRuns: [],
      sandbox: {
        isOn: false,
        excludedCommands: entries,
        off: { ...off, excludedCommands: entries },
      },
    });
  }

  function unreadableDecisionOf(command: string) {
    return gateDecision({
      command,
      mode: "interactive",
      dryRuns: [],
      sandbox: {
        isOn: false,
        excludedCommands: entries,
        off: {
          cause: "the settings layer `x` can't be parsed",
          fix: "fix that file's JSON",
          excludedCommands: [],
        },
      },
    });
  }

  const unsandboxed = [
    "node .scratch/x.ts",
    "node -e 'console.log(1)'",
    "python3 -c 'print(1)'",
    "grep x y",
    "git status",
    "for n in 1 2; do echo $n > /tmp/x-$n.md; done",
  ];

  it("asks for any other call in an Interactive session, naming the off state and its fix", () => {
    unsandboxed.forEach((command) => {
      const decision = offDecisionOf(command, "interactive");
      expect(decision?.permissionDecision).toBe("ask");
      expect(decision?.reason).toContain("the sandbox is off");
      expect(decision?.reason).toContain(off.cause);
      expect(decision?.reason).toContain(off.fix);
    });
  });

  it("refuses it in a runner step with the blocker text", () => {
    unsandboxed.forEach((command) => {
      const decision = offDecisionOf(command, "runnerStep");
      expect(decision?.permissionDecision).toBe("deny");
      expect(decision?.reason).toContain(off.cause);
      expect(decision?.reason).toContain("`denied-tool` blocker");
    });
  });

  it("gives a call of excluded commands only its tier rows", () => {
    [
      "npm test",
      "timeout 60 npm test",
      "npm run -s check",
      "npm run issue:start -- byro-repo 548",
      "npm test && npm run check",
    ].forEach((command) =>
      modes.forEach((mode) =>
        expect(offDecisionOf(command, mode)).toEqual(
          modeDecisionOf(command, mode),
        ),
      ),
    );
    expect(
      offDecisionOf("npm run issue:start -- byro-repo 548", "interactive")
        ?.permissionDecision,
    ).toBe("allow");
  });

  it("asks for a call mixing an excluded command with another", () => {
    ["npm test | tail", "cd x && npm test", "echo $(npm test)"].forEach(
      (command) =>
        expect(offDecisionOf(command, "interactive")?.permissionDecision).toBe(
          "ask",
        ),
    );
  });

  it("asks for every call when no entry is readable", () => {
    [
      "npm test",
      "npm run check",
      "ls",
      "git status",
      "npm test | tail",
      "timeout 60 npm test",
    ].forEach((command) =>
      expect(unreadableDecisionOf(command)?.permissionDecision).toBe("ask"),
    );
  });
});

describe("runnerStep mode", () => {
  const asks = ["git push origin master", "npx clasp push"];

  it("turns every ask into a deny that says to record a blocker", () => {
    asks.forEach((command) => {
      const ask = modeDecisionOf(command);
      const decision = modeDecisionOf(command, "runnerStep");
      expect(ask?.permissionDecision).toBe("ask");
      expect(decision?.permissionDecision).toBe("deny");
      expect(decision?.reason).toContain(ask?.reason);
      expect(decision?.reason).toContain("`denied-tool` blocker");
    });
  });

  it("leaves allow and deny alone", () => {
    ["npm run lint", "npm run app:chore fixRents -- --send"].forEach(
      (command) => {
        expect(
          gateDecision({
            command,
            mode: "runnerStep",
            dryRuns: [],
            spreadsheetTargets: ["app"],
          }),
        ).toEqual(modeDecisionOf(command));
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
