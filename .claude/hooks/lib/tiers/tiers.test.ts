import { describe, expect, it } from "vitest";

import { fakePlaces } from "./fakePlaces.ts";
import {
  blockerInstead,
  decisionInMode,
  dryRunChoresOf,
  gateDecision,
  type SessionMode,
  sessionModeOf,
} from "./tiers.ts";

function decisionOf(command: string, dryRuns: string[] = []) {
  return gateDecision({ command, mode: "interactive", dryRuns })
    ?.permissionDecision;
}

function placedDecisionOf(
  command: string,
  mode: SessionMode = "interactive",
  cwd = "/ws",
) {
  return gateDecision({
    command,
    mode,
    dryRuns: [],
    places: fakePlaces(cwd),
  });
}

function runnerStepDecisionOf(command: string) {
  return gateDecision({ command, mode: "runnerStep", dryRuns: [] })
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
      gateDecision({
        command: "npm run issue:remove -- --session glossary-fix --force",
        mode: "runnerStep",
        dryRuns: [],
      })?.permissionDecision,
    ).toBe("deny");
  });

  it("has no opinion on a command it doesn't list, alone or beside an allowed one", () => {
    expect(decisionOf("make build")).toBeUndefined();
    expect(decisionOf("npm run app:gen:configs")).toBeUndefined();
    expect(decisionOf("git commit -m wip && make build")).toBeUndefined();
  });

  it("asks for a file write when it has no places to check the path against", () => {
    expect(decisionOf("rm -rf dist")).toBe("ask");
    expect(decisionOf("git commit -m wip && rm -rf dist")).toBe("ask");
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

describe("reads and git add", () => {
  const gitForms = [
    "git",
    "git -C packages/framework",
    "git --git-dir=.git --work-tree=.",
    "git --git-dir .git --work-tree .",
  ];
  const gitReads = [
    "log --oneline -5",
    "show HEAD:AGENTS.md",
    "status --short",
    "diff master...HEAD",
    "rev-parse HEAD",
    "ls-files .claude",
    "blame -L 1,20 AGENTS.md",
    "branch",
    "branch --show-current",
    "branch -avv",
    "branch --list 'issue-*'",
  ];

  const reads = [
    "grep -rn verdictOf .claude/hooks",
    "rg -n freeScripts",
    "cat AGENTS.md",
    "head -20 AGENTS.md",
    "tail -n 5 AGENTS.md",
    "wc -l AGENTS.md",
    "ls -la .claude",
    "sed -n '1,40p' AGENTS.md",
    "sed -n -e '12p' -e '/^## /p' AGENTS.md",
    "sed -n 's/verdict/Verdict/gp' AGENTS.md",
    "sed -n '$=' AGENTS.md",
    "sed -n '/^## /,/^## /p' AGENTS.md",
    "sed -n '1,3l;5q' AGENTS.md",
    "find . -name '*.ts' -not -path './node_modules/*'",
  ];
  const everyRead = [
    ...reads,
    ...gitForms.flatMap((git) => gitReads.map((read) => `${git} ${read}`)),
    "git add docs/adr/0009-x.md",
  ];

  it("allows each read", () => {
    reads.forEach((command) => expect(decisionOf(command)).toBe("allow"));
  });

  it("allows each read that sends output to a descriptor or /dev/null, in a runner step too", () => {
    const redirects = [
      "2>&1",
      "1>&2",
      ">&2",
      ">/dev/null",
      "2>/dev/null",
      "&>/dev/null",
      ">> /dev/null",
    ];
    everyRead.forEach((read) =>
      redirects.forEach((redirect) => {
        const command = `${read} ${redirect}`;
        expect(decisionOf(command)).toBe("allow");
        expect(runnerStepDecisionOf(command)).toBe("allow");
      }),
    );
  });

  it("allows a chain of reads with a descriptor redirect", () => {
    [
      "git status 2>&1 | head -5",
      "grep -n x AGENTS.md 2>/dev/null; ls docs/adr 2>&1",
    ].forEach((command) => expect(decisionOf(command)).toBe("allow"));
  });

  it("allows no read that redirects to any other file", () => {
    const redirects = [
      "> out.txt",
      ">> out.txt",
      "2> err.txt",
      ">&out.txt",
      "&> 2",
      "> 2",
      "<> f",
      "<>/dev/null",
      "2>&1 > out.txt",
      ">",
    ];
    everyRead.forEach((read) =>
      redirects.forEach((redirect) =>
        expect(decisionOf(`${read} ${redirect}`)).not.toBe("allow"),
      ),
    );
  });

  it("allows each git read in each form", () => {
    gitForms.forEach((git) =>
      gitReads.forEach((read) =>
        expect(decisionOf(`${git} ${read}`)).toBe("allow"),
      ),
    );
  });

  it("allows a branch create, copy, rename or upstream change in each form, as git can undo it", () => {
    gitForms.forEach((git) =>
      [
        "branch issue-400-x",
        "branch issue-400-x master",
        "branch -c old copy",
        "branch -m old new",
        "branch --move old new",
        "branch -u origin/master",
        "branch --unset-upstream",
        "branch --merged master",
      ].forEach((change) =>
        expect(decisionOf(`${git} ${change}`)).toBe("allow"),
      ),
    );
  });

  it("allows git add in each form, as git can undo it", () => {
    gitForms.forEach((git) =>
      expect(decisionOf(`${git} add docs/adr/0009-x.md`)).toBe("allow"),
    );
  });

  it("gives the same allows in a runner step", () => {
    [
      "cat AGENTS.md",
      "git -C packages/framework log -3",
      "git add docs/adr/0009-x.md",
    ].forEach((command) => expect(runnerStepDecisionOf(command)).toBe("allow"));
  });

  it("allows chained reads and a read after cd", () => {
    [
      "git status && git diff",
      "git log --oneline | head -5",
      "ls; wc -l AGENTS.md",
      "cd packages/framework && git log -3",
      "cd packages/framework && git add src/x.ts && git commit -m wip",
    ].forEach((command) => expect(decisionOf(command)).toBe("allow"));
  });

  it("allows no read that edits, runs a command or writes a file", () => {
    [
      "sed -i '' 's/a/b/' AGENTS.md",
      "sed -ni '1p' AGENTS.md",
      "sed --in-place -n 1p AGENTS.md",
      "sed -n '1w out.txt' AGENTS.md",
      "sed -n '1e rm -rf dist' AGENTS.md",
      "sed -n -f script.sed AGENTS.md",
      "sed -n 's/a/b/w out.txt' AGENTS.md",
      "sed -n 's/a/b/e' AGENTS.md",
      "sed -n '1{p;w out.txt' -e '}' AGENTS.md",
      "find . -exec rm {} ;",
      "find . -execdir rm {} +",
      "find . -ok rm {} ;",
      "find . -name '*.tmp' -delete",
      "find . -fprint out.txt",
      "find . -fprint0 out.txt",
      "find . -fprintf out.txt %p",
      "find . -fls out.txt",
      "find . -okdir rm {} ;",
      "rg --pre ./run.sh x",
      "rg --pre=./run.sh x",
      "rg --hostname-bin=./run.sh --hyperlink-format=default x",
      "git branch -d old",
      "git branch -D old",
      "git branch --delete old",
      "git branch -df old",
      "git branch -f master HEAD~3",
      "git branch --force master HEAD~3",
      "git branch -M old master",
      "git branch -C old master",
      "git branch -m --force old master",
      "git branch issue-400-x <<EOF\nrm -rf dist\nEOF",
      "git diff --output=patch.diff",
      "git log -p --output patch.diff",
      "git -c core.fsmonitor='rm -rf dist' status",
      "git -c core.pager=less log",
      "cat AGENTS.md > copy.md",
      "git log >> log.txt",
      "ls >/dev/null 2>err.txt",
      "cat AGENTS.md; > AGENTS.md",
      "PAGER=./run.sh git log",
      "sudo cat /etc/hosts",
      "/tmp/cat AGENTS.md",
    ].forEach((command) => expect(decisionOf(command)).not.toBe("allow"));
  });

  it("allows no chain holding an unallowed part, nor a hidden substitution", () => {
    [
      "cat AGENTS.md && rm -rf dist",
      "git log | xargs rm",
      "cd dist && rm -rf .",
      "cat $(rm -rf dist)",
      "cat `rm -rf dist`",
      "cat <(rm -rf dist)",
      "git log | tee >(cat)",
      "grep '<<EOF' AGENTS.md\nrm -rf dist\nEOF",
      "cat $'\\'' ; rm -rf dist ; echo '",
    ].forEach((command) => expect(decisionOf(command)).not.toBe("allow"));
  });

  it("allows no git verb that changes anything, and git add only plain", () => {
    [
      "git checkout master",
      "git restore AGENTS.md",
      "git reset --hard",
      "git stash",
      "git rebase master",
      "git -c core.fsmonitor=./run.sh add x",
      "GIT_DIR=/tmp/x git add x",
    ].forEach((command) => expect(decisionOf(command)).not.toBe("allow"));
  });

  it("still denies a gh read in a runner step", () => {
    ["gh issue view 389", "gh issue list"].forEach((command) =>
      expect(runnerStepDecisionOf(command)).not.toBe("allow"),
    );
  });
});

describe("stdout filters and wrappers", () => {
  it("allows each filter alone", () => {
    [
      "sort AGENTS.md",
      "sort -u -k2 AGENTS.md",
      "uniq -c AGENTS.md",
      "cut -d, -f1 AGENTS.md",
      "tr a-z A-Z",
      "sed 's|a|b|' AGENTS.md",
      "sed -E 's/a+/b/g' AGENTS.md",
      "awk '{print $1}' AGENTS.md",
      "awk -F: '{print $2}' AGENTS.md",
      "echo hi",
      "printf '%s\\n' x",
      "pwd",
    ].forEach((command) => expect(decisionOf(command)).toBe("allow"));
  });

  it("allows each filter piped after a read", () => {
    [
      "cat AGENTS.md | sort | uniq -c",
      "git log --oneline | awk '{print $1}'",
      "grep -n x AGENTS.md | cut -d: -f1 | tr -d ' '",
      "ls | sed 's/a/b/'",
    ].forEach((command) => expect(decisionOf(command)).toBe("allow"));
  });

  it("decides `npm run -s` and `timeout` on what they wrap", () => {
    [
      "npm run -s check",
      "npm run -s issue:read -- byro-repo 447 --body --hide-others",
      "timeout 60 npm test",
      "timeout -k 5 60 grep -n x AGENTS.md",
    ].forEach((command) => expect(decisionOf(command)).toBe("allow"));
    expect(decisionOf("timeout 60 git push")).toBe("ask");
  });

  it("asks for sed with a write or exec, and awk with system or a redirect", () => {
    [
      "sed 's/a/b/w out.txt' AGENTS.md",
      "sed 's/a/b/e' AGENTS.md",
      "sed '1w out.txt' AGENTS.md",
      "sed '1e ls' AGENTS.md",
      "awk '{system(\"ls\")}' AGENTS.md",
      "awk '{print > \"out.txt\"}' AGENTS.md",
      "awk '{print | \"sh\"}' AGENTS.md",
      "sort -o out.txt AGENTS.md",
    ].forEach((command) => expect(decisionOf(command)).toBe("ask"));
  });

  it("asks for a macOS sed -i whose next word is a backup suffix rather than ''", () => {
    expect(
      placedDecisionOf("sed -i p 'w /outside/x' AGENTS.md")?.permissionDecision,
    ).toBe("ask");
    expect(
      placedDecisionOf("sed -Ei p 's/a/b/' AGENTS.md")?.permissionDecision,
    ).toBe("ask");
  });

  it("allows an npx check only with no flag that writes a file", () => {
    [
      "npx tsc --noEmit",
      "npx eslint .",
      "npx vitest run .claude/hooks",
    ].forEach((command) => expect(decisionOf(command)).toBe("allow"));
    [
      "npx tsc",
      "npx tsc --outDir /outside",
      "npx tsc -b --noEmit",
      "npx tsc --build --noEmit",
      "npx eslint --fix /outside/x",
      "npx eslint --fix-dry-run .",
      "npx eslint -o /outside/report .",
      "npx eslint --output-file=/outside/report .",
      "npx vitest run --outputFile=/outside/report",
      "npx vitest run --outputFile /outside/report",
    ].forEach((command) => expect(decisionOf(command)).not.toBe("allow"));
  });
});

describe("file writes by the step write rule", () => {
  it("allows rm, mkdir, cp, mv, sed -i and a redirect inside the workspace or $TMPDIR", () => {
    [
      "rm -rf dist",
      "rm /tmp/scratch.txt",
      "mkdir -p .scratch/a",
      "mkdir /tmp/work",
      "cp AGENTS.md /tmp/copy.md",
      "mv dist out",
      "mv /tmp/helper.mjs .scratch/helper.mjs",
      "sed -i '' 's/a/b/' AGENTS.md",
      "echo x > out.txt",
      "cat AGENTS.md > /tmp/copy.md",
      "git log >> .scratch/log.txt",
      "cd packages/framework && rm -rf src/old",
      "cd packages/framework && rm -rf src/old 2>&1",
      "rm $TMPDIR/scratch.txt",
      'rm "${TMPDIR}/scratch.txt"',
      "echo x > $TMPDIR/out.txt",
    ].forEach((command) =>
      expect(placedDecisionOf(command)?.permissionDecision).toBe("allow"),
    );
  });

  it("asks once a cd may not have carried on, or takes a flag for its target", () => {
    [
      "cd packages/framework; rm -rf src/old",
      "cd packages/framework || rm -rf src/old",
      "cd packages/framework & rm -rf src/old",
      "cd packages/framework\nrm -rf src/old",
      "cd -P packages/framework && rm -rf src/old",
      "cd -- packages/framework && rm -rf src/old",
    ].forEach((command) =>
      expect(placedDecisionOf(command)?.permissionDecision).toBe("ask"),
    );
  });

  it("follows only a leading $TMPDIR, by the value the gate knows", () => {
    [
      "rm $TMPDIR/claude-guardrails/chore-dry-runs.json",
      "rm $TMPDIRX/x",
      "rm /ws/$TMPDIR/x",
      "rm $OTHER/x",
    ].forEach((command) =>
      expect(placedDecisionOf(command)?.permissionDecision).toBe("ask"),
    );
  });

  it("asks for each with a path outside them, through `..` or a symlink included", () => {
    [
      "rm -rf /outside",
      "rm ../outside/x",
      "rm escape/x",
      "rm linkdir/../x",
      "rm dangling",
      "rm /ws",
      "mkdir /outside/new",
      "cp AGENTS.md /outside/",
      "mv AGENTS.md ../x",
      "sed -i '' 's/a/b/' /outside/x",
      "echo x > /outside/x",
      "echo x > escape/y",
      "cd /outside && rm x",
      "rm ~/x",
      "rm $HOME/x",
      "rm *.md",
      "rm /tmp/claude-guardrails/chore-dry-runs.json",
    ].forEach((command) =>
      expect(placedDecisionOf(command)?.permissionDecision).toBe("ask"),
    );
  });

  it("asks for a path into `.git` at the workspace root or in a package", () => {
    [
      "rm .git",
      "rm -rf .git/hooks",
      "echo x > packages/framework/.git",
      "mkdir packages/framework/.git/x",
      "cp AGENTS.md .git/config",
    ].forEach((command) =>
      expect(placedDecisionOf(command)?.permissionDecision).toBe("ask"),
    );
  });

  it("turns each ask into the blocker deny in a runner step", () => {
    const decision = placedDecisionOf("rm -rf /outside", "runnerStep");
    expect(decision?.permissionDecision).toBe("deny");
    expect(decision?.reason).toContain(blockerInstead);
  });
});

describe("interpreters", () => {
  it("allows node on a gitignored or $TMPDIR file", () => {
    [
      "node .runner/helper.ts",
      "node --experimental-strip-types .runner/helper.ts",
      "node /tmp/helper.mjs",
      "node $TMPDIR/helper.mjs",
    ].forEach((command) =>
      expect(placedDecisionOf(command)?.permissionDecision).toBe("allow"),
    );
  });

  it("asks for node on an installed package's file, though node_modules is gitignored", () => {
    const decision = placedDecisionOf("node node_modules/clasp/cli.js");
    expect(decision?.permissionDecision).toBe("ask");
    expect(decision?.reason).toContain("`node` runs only scratch helpers");
  });

  it("asks for node on a tracked file, new or committed, and for node -e or -p, saying node runs only scratch helpers", () => {
    [
      "node scripts/tool.ts",
      "node scripts/new.ts",
      "node -e 'console.log(1)'",
      "node -p 1",
      "node --require ./x.js .runner/helper.ts",
    ].forEach((command) => {
      const decision = placedDecisionOf(command);
      expect(decision?.permissionDecision).toBe("ask");
      expect(decision?.reason).toContain("`node` runs only scratch helpers");
      expect(decision?.reason).toContain(
        "a script being built runs through its tests or its `npm run` alias",
      );
    });
  });

  it("asks for python3 -c", () => {
    expect(placedDecisionOf("python3 -c 'print(1)'")?.permissionDecision).toBe(
      "ask",
    );
  });
});

describe("a runner step's unclassified call", () => {
  it("is denied with the blocker text in a runner step, and left undecided in an Interactive session", () => {
    const decision = placedDecisionOf("make build", "runnerStep");
    expect(decision?.permissionDecision).toBe("deny");
    expect(decision?.reason).toContain("`make build`");
    expect(decision?.reason).toContain(blockerInstead);
    expect(placedDecisionOf("make build")).toBeUndefined();
  });

  it("leaves a call naming gh or a live alias to Claude Code's allow rules in either mode", () => {
    [
      "gh issue edit 447 --body-file /tmp/body.md",
      "gh issue comment 447 -b done",
      "npm run app:gen:configs",
      "npm run -s dev:push",
    ].forEach((command) => {
      expect(placedDecisionOf(command)).toBeUndefined();
      expect(placedDecisionOf(command, "runnerStep")).toBeUndefined();
    });
  });

  it("allows git restore in a runner step's own workspace only", () => {
    [
      ["git restore AGENTS.md", "/ws"],
      ["git restore --staged src/x.ts", "/ws/packages/framework"],
    ].forEach(([command = "", cwd]) =>
      expect(
        placedDecisionOf(command, "runnerStep", cwd)?.permissionDecision,
      ).toBe("allow"),
    );
    expect(placedDecisionOf("git restore AGENTS.md")).toBeUndefined();
    [
      ["git restore x", "/outside"],
      ["git -C /outside restore x", "/ws"],
      ["git --work-tree=/outside restore x", "/ws"],
      ["git restore config", "/ws/.git"],
    ].forEach(([command = "", cwd]) =>
      expect(
        placedDecisionOf(command, "runnerStep", cwd)?.permissionDecision,
      ).toBe("deny"),
    );
  });
});

describe("a Supervisor's gh writes", () => {
  // The gate takes no supervision input, so a session holding a record gets the same call as one without.
  it("leaves a gh issue comment and edit to the allow rules, as for any interactive session", () => {
    [
      'gh issue comment 331 --body "Approved reply"',
      "gh issue edit 341 -R byronbroughten/byro-repo --add-label ready-for-agent",
    ].forEach((command) =>
      expect(
        gateDecision({ command, mode: "interactive", dryRuns: [] }),
      ).toBeUndefined(),
    );
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
