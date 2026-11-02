import { describe, expect, it } from "vitest";

import { fakePlaces } from "./fakePlaces.ts";
import {
  blockerInstead,
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
    "jq -r '.tickets | keys[]' .runner/run.json",
    "jq --slurpfile prior old.json '.a' new.json",
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

  it("allows a plain git merge in each form, as git can undo it", () => {
    gitForms.forEach((git) =>
      expect(decisionOf(`${git} merge master`)).toBe("allow"),
    );
  });

  it("allows no merge that skips hooks or is chained with a push", () => {
    [
      "git merge --no-verify master",
      "git merge --no-veri master",
      "git -c core.hooksPath=/tmp merge master",
      "git merge master && git push",
    ].forEach((command) => {
      expect(decisionOf(command)).not.toBe("allow");
      expect(runnerStepDecisionOf(command)).not.toBe("allow");
    });
  });

  it("gives the same allows in a runner step", () => {
    [
      "cat AGENTS.md",
      "git -C packages/framework log -3",
      "git add docs/adr/0009-x.md",
      "git merge master",
    ].forEach((command) => expect(runnerStepDecisionOf(command)).toBe("allow"));
  });

  it("allows git's local reads in a session and a runner step, through a path option too", () => {
    [
      "git remote",
      "git remote -v",
      "git -C packages/framework remote get-url origin",
      "git --git-dir=.git remote get-url --push origin",
      "git cat-file -p HEAD",
      "git rev-list --count master..HEAD",
      "git for-each-ref refs/heads",
      "git describe --tags",
      "git shortlog -sn",
      "git reflog",
      "git reflog show issue-514-x",
      "git reflog -10",
      "git reflog -n 20 --date=iso",
      "git reflog HEAD",
      "git reflog HEAD@{2}",
      "git reflog issue-514-x",
      "git reflog exists HEAD",
      "git worktree list",
      "git --work-tree=. worktree list --porcelain",
      "git config --get user.name",
      "git config --get-all remote.origin.fetch",
      "git config --get-regexp '^remote'",
      "git config --list",
      "git config -l --show-origin",
      "git config user.email",
      "git config --global user.name",
      "git config --type=bool core.bare",
      "git config get user.name",
      "git config list --global",
      "git branch --list 'issue-*'",
      "git branch -l",
      "git tag",
      "git tag -l 'v*'",
      "git tag --list",
      "git tag --contains HEAD",
      "git tag -n5",
      "git tag --sort=-v:refname",
      "git stash list",
      "git stash show -p stash@{1}",
      "git symbolic-ref --short HEAD",
      "git symbolic-ref refs/remotes/origin/HEAD",
      "git ls-tree -r HEAD",
      "git show-ref --heads",
      "git name-rev HEAD",
      "git check-ignore -v .runner/x",
      "git check-attr -a AGENTS.md",
      "git cherry -v master",
      "git range-diff master...HEAD",
      "git count-objects -v",
      "git whatchanged -3",
      "git diff-tree --no-commit-id -r HEAD",
      "git diff-index --cached HEAD",
      "git diff-files",
      "git var GIT_EDITOR",
      "git version",
    ].forEach((command) => {
      expect(decisionOf(command)).toBe("allow");
      expect(runnerStepDecisionOf(command)).toBe("allow");
    });
  });

  it("allows no write or network form of the verbs git also reads with", () => {
    [
      "git remote add fork https://x",
      "git remote set-url origin https://x",
      "git remote remove origin",
      "git remote rename origin upstream",
      "git remote -v add fork https://x",
      "git remote show origin",
      "git remote update",
      "git remote prune origin",
      "git ls-remote origin",
      "git fetch",
      "git config user.name x",
      "git config --unset user.name",
      "git config --add remote.origin.fetch x",
      "git config --get-all x --add y",
      "git config set user.name x",
      "git config unset user.name",
      "git config edit",
      "git config --file get set user.name x",
      "git config --global --edit",
      "git tag v1",
      "git tag -a v1 -m x",
      "git tag -fa v1",
      "git tag -f v1",
      "git tag -d v1",
      "git tag -l -d v1",
      "git reflog expire --all",
      "git reflog delete HEAD@{1}",
      "git reflog -n1 expire --all",
      "git reflog drop",
      "git reflog master",
      "git stash",
      "git stash -p",
      "git stash push -m x",
      "git stash pop",
      "git stash drop",
      "git symbolic-ref HEAD refs/heads/x",
      "git symbolic-ref -d HEAD",
      "git symbolic-ref -m why HEAD",
      "git worktree add /tmp/w",
      "git worktree remove /tmp/w",
      "git reset --hard",
      "git clean -fd",
      "git checkout -- AGENTS.md",
    ].forEach((command) => {
      expect(decisionOf(command)).not.toBe("allow");
      expect(runnerStepDecisionOf(command)).not.toBe("allow");
    });
    ["git branch -d old", "git branch -l -D old"].forEach((command) => {
      expect(decisionOf(command)).not.toBe("allow");
      expect(runnerStepDecisionOf(command)).not.toBe("allow");
    });
  });

  it("allows chained reads and a read after cd", () => {
    [
      "git status && git diff",
      "git log --oneline | head -5",
      "ls; wc -l AGENTS.md",
      "cd packages/framework && git log -3",
      "cd packages/framework && git add src/x.ts && git commit -m wip",
      "git grep -n toISOString",
      "git -C packages/framework grep -nE 'a|b' -- src",
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
      "git grep -O x",
      "git grep -Ovim x",
      "git grep -nO x",
      "git grep --open-files-in-pager=./run.sh x",
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

  it("reads a heredoc behind a quoted delimiter as plain text, since bash expands nothing in its body", () => {
    [
      "cat > /tmp/s372/a.md <<'EOF'\nA `code` span, a | pipe and $(rm -rf dist)\nEOF",
      'cd /tmp/s372 && cat > a.md <<"EOF"\n# Title; with a ( paren\nEOF',
      "cat > /tmp/s372/a.md <<'EOF'\nx\nEOF\ngrep x /tmp/s372/a.md",
      "cat <<<'one line'",
    ].forEach((command) =>
      expect(placedDecisionOf(command)?.permissionDecision).toBe("allow"),
    );
  });

  it("allows no heredoc bash may expand, nor one its scan reads differently from the text match", () => {
    [
      "cat <<EOF\nhi\nEOF",
      "git commit -m x <<< y\ngit push",
      "git commit -m x <<< y\nrm -rf /outside",
      "git commit -m x # <<'EOF'\ngit push\nEOF",
      "echo '<<EOF'\nrm -rf /outside\nEOF",
      "cat <<'EOF' \\\n> /tmp/s372/a.md\nbody\nEOF",
      'echo "$(echo " <<\'X\'")"\nrm -rf /outside\nX',
      'echo "${a:-" <<\'X\'"}"\nrm -rf /outside\nX',
      'echo $((1<<"2"))\nrm -rf /outside\n2',
    ].forEach((command) =>
      expect(placedDecisionOf(command)?.permissionDecision).not.toBe("allow"),
    );
  });

  it("allows a free read whose substitutions hold only free reads, quoted or not", () => {
    [
      'echo "#488: $(cat AGENTS.md)"',
      "wc -l $(git ls-files)",
      'cat "$(git rev-parse --show-toplevel)/AGENTS.md"',
      "grep -n gate `git ls-files`",
      'echo "Branch: `git branch --show-current`"',
      "echo 'x' \"$(grep -c ')' AGENTS.md)\"",
    ].forEach((command) => expect(decisionOf(command)).toBe("allow"));
  });

  it("allows a substitution nested in another when every command in it is a free read", () => {
    [
      'cat "$(ls "$(git rev-parse --show-toplevel)")"',
      "cat $(head -1 `ls`)",
      'echo "`echo \\`ls\\``"',
    ].forEach((command) => expect(decisionOf(command)).toBe("allow"));
  });

  it("gives a call the tier of the strictest command in its substitutions", () => {
    [
      'echo "$(git push origin master)"',
      "cat `git push`",
      'cat "$(ls "$(git push)")"',
      "cat $(rm -rf dist)",
    ].forEach((command) => expect(decisionOf(command)).toBe("ask"));
    expect(decisionOf('echo "$(node -e 1)"')).toBe("deny");
    expect(decisionOf('echo "$(make notes)"')).toBeUndefined();
  });

  it("never takes a substitution's output for a known program or a checked path", () => {
    expect(decisionOf("$(echo cat) AGENTS.md")).toBeUndefined();
    expect(
      placedDecisionOf("cd $(git rev-parse --show-toplevel) && rm -f x")
        ?.permissionDecision,
    ).toBe("ask");
    expect(placedDecisionOf("rm -f $(ls)")?.permissionDecision).toBe("ask");
    expect(
      placedDecisionOf("cd /etc && ls `cd /ws` `rm -f passwd`")
        ?.permissionDecision,
    ).toBe("ask");
  });

  it("allows no call whose substitution it can't read", () => {
    [
      'cat "$(ls"',
      "cat `ls",
      'echo "$(cat AGENTS.md # )\nrm -rf dist\n)"',
      "git commit -F - <<EOF\n$(git push)\nEOF",
      "git commit -m $'\\'' $(git push) $'\\''",
      'echo "$(case a in a) rm -rf dist;; esac)"',
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
    ].forEach((command) => expect(decisionOf(command)).toBeUndefined());
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
      "awk '{print $1/2 > \"out\"; x = 3/4}' AGENTS.md",
      "awk '{x++ /2 > \"out\"/ 1}' AGENTS.md",
      "awk '/a|b/ {print > \"out\"}' AGENTS.md",
      'awk \'{print "|" | "sh"}\' AGENTS.md',
      "awk '/[/]|x/ {print}' AGENTS.md",
      "awk '{print \"open|}' AGENTS.md",
      "awk '/system|x/' AGENTS.md",
      "sort -o out.txt AGENTS.md",
    ].forEach((command) => expect(decisionOf(command)).toBe("ask"));
  });

  it("allows awk whose pipe or angle bracket sits inside a string or regex", () => {
    [
      "awk -F'|' '{r=$7; gsub(/^ +| +$/,\"\",r); print r \" :: pair=\" p}' AGENTS.md",
      "awk '/^- \\[[ x]\\] \\*\\*R/{p=1} p&&/^(- [^\\[]|###|\\*\\*)/&&!/^- \\[/{p=0} p' AGENTS.md",
      "awk '{print $1 \" -> \" $2}' AGENTS.md",
      "awk '$1 ~ /a|b/ && !/c>d/ {print $1/2}' AGENTS.md",
    ].forEach((command) => expect(decisionOf(command)).toBe("allow"));
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

  it("refuses a runner step's `npx tsc` without `--noEmit`, saying to add it", () => {
    ["npx tsc", "npx tsc -p tsconfig.json"].forEach((command) => {
      const decision = placedDecisionOf(command, "runnerStep");
      expect(decision?.permissionDecision).toBe("deny");
      expect(decision?.reason).toContain("add `--noEmit`");
      expect(decision?.reason).not.toContain(blockerInstead);
    });
  });
});

describe("file writes by the step write rule", () => {
  it("allows rm, mkdir, cp, mv, sed -i and a redirect inside the workspace, $TMPDIR or /tmp", () => {
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
      "mkdir -p /tmp/s372",
      "cat AGENTS.md > /tmp/s372/copy.md",
      "echo x > /private/tmp/out.txt",
    ].forEach((command) =>
      expect(placedDecisionOf(command)?.permissionDecision).toBe("allow"),
    );
  });

  it("allows a write after a cd that may not have carried on when it passes from every folder the call may be in", () => {
    [
      "cd packages/framework; rm -rf src/old",
      "cd packages/framework || rm -rf src/old",
      "cd packages/framework & rm -rf src/old",
      "cd packages/framework\nrm -rf src/old",
      "cd packages/framework | rm -rf src/old",
      "cd /outside; cat AGENTS.md > /tmp/copy.md",
      "cd /tmp/s372 && git status | head -2 && echo x > out.txt",
      "cd /tmp/s372 && jq -r '.[] | .a; .b' in.json > out.json",
      "cd /tmp/s372 && cat in.json > out.json",
      'cd /tmp/s372 && echo "a | b" > out.txt',
    ].forEach((command) =>
      expect(placedDecisionOf(command)?.permissionDecision).toBe("allow"),
    );
  });

  it("asks for a write after a cd that fails the write rule from any folder the call may be in, or a cd it can't follow", () => {
    [
      "cd /tmp/s372; rm ../x",
      "cd /tmp/s372 | rm ../x",
      "cd /tmp/s372 && cd /outside; rm x",
      'cd /tmp/s372 && echo "$(pwd)" && rm ../x',
      "cd -P packages/framework && rm -rf src/old",
      "cd -- packages/framework && rm -rf src/old",
      "cd -P packages/framework; rm -rf src/old",
    ].forEach((command) =>
      expect(placedDecisionOf(command)?.permissionDecision).toBe("ask"),
    );
    expect(
      placedDecisionOf("cd /tmp/s372 && rm ../x")?.permissionDecision,
    ).toBe("allow");
  });

  it("follows a cd into a leading $TMPDIR, by the value the gate knows", () => {
    [
      'cd "$TMPDIR/work" && echo x > out.txt',
      "cd ${TMPDIR}/work && rm ../helper.mjs",
    ].forEach((command) =>
      expect(placedDecisionOf(command)?.permissionDecision).toBe("allow"),
    );
    ["cd $TMPDIRX && echo x > out.txt", "cd $HOME && echo x > out.txt"].forEach(
      (command) =>
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
  it("allows node on a gitignored, $TMPDIR or /tmp file", () => {
    [
      "node .runner/helper.ts",
      "node --experimental-strip-types .runner/helper.ts",
      "node /var/T/helper.mjs",
      "node $TMPDIR/helper.mjs",
      "node /tmp/helper.mjs",
    ].forEach((command) =>
      expect(placedDecisionOf(command)?.permissionDecision).toBe("allow"),
    );
  });

  it("asks for node on an installed package's file, though node_modules is gitignored", () => {
    const decision = placedDecisionOf("node node_modules/clasp/cli.js");
    expect(decision?.permissionDecision).toBe("ask");
    expect(decision?.reason).toContain("`node` runs only scratch helpers");
  });

  it("asks for node on a tracked file, new or committed, naming where the free scripts are listed and that any other script asks", () => {
    [
      "node scripts/tool.ts",
      "node scripts/new.ts",
      "node --require ./x.js .runner/helper.ts",
    ].forEach((command) => {
      const decision = placedDecisionOf(command);
      expect(decision?.permissionDecision).toBe("ask");
      expect(decision?.reason).toContain("`node` runs only scratch helpers");
      expect(decision?.reason).toContain(
        "`freeScripts` in `.claude/hooks/lib/tiers/tiers/npmCommands.ts`",
      );
      expect(decision?.reason).toContain("any other script asks");
    });
  });

  it("denies inline code, naming jq and a scratch helper, the same in a runner step", () => {
    [
      "node -e 'console.log(1)'",
      "node -p 1",
      "node -pe 1",
      "node --eval 'console.log(1)'",
      "node --print=1",
      "node --no-warnings -e 1",
      "node",
      "node - < script.js",
      "cat x.json | node",
      "python3 -c 'print(1)'",
      "python -Ic 'print(1)'",
    ].forEach((command) => {
      (["interactive", "runnerStep"] as const).forEach((mode) => {
        const decision = placedDecisionOf(command, mode);
        expect(decision?.permissionDecision).toBe("deny");
        expect(decision?.reason).toContain("`jq`");
        expect(decision?.reason).toContain("scratch helper in `$TMPDIR`");
        expect(decision?.reason).not.toContain(blockerInstead);
      });
    });
  });

  it("leaves an argument after the script to the script", () => {
    expect(
      placedDecisionOf("node /tmp/helper.mjs -e")?.permissionDecision,
    ).toBe("allow");
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

  it("leaves a call naming gh or a live alias to Claude Code's allow rules in an Interactive session", () => {
    [
      "gh issue edit 447 --body-file /tmp/body.md",
      "gh issue close 447",
      "gh pr view 12",
      "npm run app:gen:configs",
      "npm run -s dev:push",
    ].forEach((command) => expect(placedDecisionOf(command)).toBeUndefined());
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

describe("a runner step's gh calls", () => {
  it("allows an issue edit or comment on any issue", () => {
    [
      "gh issue edit 447 --body-file /tmp/body.md",
      "gh issue edit 341 -R byronbroughten/byro-repo --add-label ready-for-agent",
      "gh issue comment 447 -b done",
    ].forEach((command) => expect(runnerStepDecisionOf(command)).toBe("allow"));
  });

  it("denies closing an issue with the blocker text", () => {
    const decision = placedDecisionOf("gh issue close 447", "runnerStep");
    expect(decision?.permissionDecision).toBe("deny");
    expect(decision?.reason).toContain(blockerInstead);
  });

  it("denies every other gh call as unclassified, reads included", () => {
    [
      "gh api repos/x/y/issues/1/comments",
      "gh pr create --fill",
      "gh issue view 389",
      "gh issue reopen 447",
    ].forEach((command) => {
      const decision = placedDecisionOf(command, "runnerStep");
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
      const decision = placedDecisionOf(command, "runnerStep");
      expect(decision?.permissionDecision).toBe("deny");
      expect(decision?.reason).toContain("--body-file");
      expect(decision?.reason).not.toContain(blockerInstead);
    });
  });

  it("leaves an Interactive session's write with a backtick to Claude Code", () => {
    expect(
      placedDecisionOf('gh issue comment 447 --body "Fails at `Api.ts`"'),
    ).toBeUndefined();
  });

  it("names no --body-file for another call with a backtick", () => {
    const decision = placedDecisionOf("git add `ls`", "runnerStep");
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

  it("allows a create whose body is a free read's output", () => {
    expect(
      decisionOf('gh issue create --title T --body "$(cat notes.md)"'),
    ).toBe("allow");
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
      "for f in a b\ndo\n  ls $f\ndone",
      "while git status; do ls; done",
      "until git status; do ls; done",
      "if git status; then ls; elif pwd; then ls; else pwd; fi",
      "! git status",
      "{ ls; pwd; }",
      "(ls; pwd)",
      "case x in a|b) ls;; *) pwd;; esac",
      "case x in\n  (a) ls ;;\n  b) pwd\nesac",
      "for f in $(ls); do echo $f; done",
      "for f in a; do echo done; done",
      "{ git status; } 2>&1 | head -5",
    ].forEach((command) => expect(decisionOf(command)).toBe("allow"));
  });

  it("asks for one holding a command that asks, a function's call included", () => {
    [
      "for i in 1; do git push; done",
      "{ git push; }",
      "if git status; then git push; fi",
      "ls(){ git push; }; ls",
      "e(){ ls; }; e; git push",
      "for f in $(git push); do ls; done",
      "for i do git push; done",
      "for i\ndo git push\ndone",
      "select i do git push; done",
      "f(){ for i do git push; done; }; f 1",
    ].forEach((command) => expect(decisionOf(command)).toBe("ask"));
  });

  it("asks for a loop's write to a variable path, as for one outside a loop", () => {
    expect(
      placedDecisionOf("for f in *.md; do rm $f; done")?.permissionDecision,
    ).toBe("ask");
  });

  it("checks a write after a cd inside one from every folder the call may be in", () => {
    [
      "{ cd /tmp/s372 && rm ../x; }",
      "if git status; then cd /tmp/s372; fi; rm ../x",
      "e(){ cd /tmp/s372; }; e; rm ../x",
      "! cd /tmp/s372 && rm ../x",
    ].forEach((command) =>
      expect(placedDecisionOf(command)?.permissionDecision).toBe("ask"),
    );
  });

  it("refuses a runner step's loop as it refuses the command inside", () => {
    const decision = placedDecisionOf(
      "for n in 1 2; do gh issue close $n; done",
      "runnerStep",
    );
    expect(decision?.permissionDecision).toBe("deny");
    expect(decision?.reason).toContain(blockerInstead);
  });

  it("leaves one it can't read as bash would unclassified", () => {
    [
      "for i in 1; do ls",
      "{ ls",
      "ls; }",
      "if ls; then pwd; done",
      "f(){ f; }; f",
      "f; f(){ ls; }",
      "e(){ ls; }; echo $(e)",
      "e(){ ls $1; }; e 'a b'",
      "f() ls",
      '"for" x in 1; do ls; done',
      "case x in a) ls;; esac; ;;",
      "for; do ls; done",
      "for i x; do ls; done",
      "f(){ shift; git $1; }; f status push",
    ].forEach((command) => expect(decisionOf(command)).toBeUndefined());
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

describe("a sandboxed call", () => {
  const entries = ["npm run app*", "npm run check"];
  const modes: SessionMode[] = ["interactive", "runnerStep"];

  function decisionUnder(command: string, mode: SessionMode, isOn: boolean) {
    return gateDecision({
      command,
      mode,
      dryRuns: [],
      places: fakePlaces("/ws"),
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

  it("still refuses a call keeping an excluded command in the box", () => {
    expect(
      sandboxedDecisionOf("npm run check | tail", "interactive")
        ?.permissionDecision,
    ).toBe("deny");
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
          gateDecision({
            command,
            mode: "runnerStep",
            dryRuns: [],
            spreadsheetTargets: ["app"],
          }),
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
