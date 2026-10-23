# One home per fact

Why each fact lives in one file, why a behavior-changing rule is the exception, and why the environment keeps what it already states. The principle's full argument is in [`agent-behavior-design.md`](../agent-behavior-design.md#put-each-rule-where-it-gets-followed-and-its-reasoning-one-pointer-away).

## One fact, one file

A fact stated in two files is changed in one of them and goes stale in the other, and an agent that reads the stale copy acts on it. A pointer costs one line and can't drift from its target. Past reviews show the pattern: a layout fact that lived only in a README moved to `upstream-skills.md` (#233), and stale rows in `prose-files.md`'s map were fixed in #253, #267 and #313.

## The behavior-changing exception

A rule an agent has to go looking for is a rule it skips. So a rule that changes what an agent does is repeated where the agent is when it acts: the root AGENTS.md says "Commit freely; push only through wrap-up", and `docs/agents/git-workflow.md` holds the full branch rules. Facts that only inform, like a file's job or a command's output, are never repeated.

## The environment is a home too

`package.json` scripts, config files and `--help` output are read by looking, and a doc that restates them is a cache that goes stale the next time they change. Cache only what can't be found by looking, as [`writing-for-agents`](../../.claude/skills/writing-for-agents/SKILL.md) says under Pruning.

## Pointers between repos

A library's docs ship in its own repo, so a pointer to a consumer helps a reader see the library in use. A pointer into a private repo is a dead link for everyone else, and a relative path breaks once the doc is published, so the pointer is a github.com URL.
