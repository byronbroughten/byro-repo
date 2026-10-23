# Prose style

How developer-facing prose ([defined in `prose-files.md`](./agents/prose-files.md#terms)) is shaped, beside [`writing-for-agents`](../.claude/skills/writing-for-agents/SKILL.md), which holds context pointers and the two loads; which file a fact goes in is [`prose-files.md`'s map](./agents/prose-files.md#map).

One line per rule. The reasoning and worked examples are one file away. Open a reasoning file only when you're changing the rule, or the rule's line doesn't decide your case.

## Reasoning files

| When | File |
| --- | --- |
| A fact in two files, a pointer, a cache of the environment, a cross-repo link | [`docs/prose-style/one-home.md`](./prose-style/one-home.md) |
| A rule line, a reasoning file, a mechanics doc's lead and headings | [`docs/prose-style/file-shapes.md`](./prose-style/file-shapes.md) |
| Which rung a rule goes on | [`agent-behavior-design.md`](./agent-behavior-design.md#put-each-rule-where-it-gets-followed-and-its-reasoning-one-pointer-away) |
| An addition to AGENTS.md | [`prose-files.md`](./agents/prose-files.md#what-an-addition-to-agentsmd-costs) |
| A prose smell: what it looks like, derived prose | [`docs/prose-style/smells.md`](./prose-style/smells.md) |

## One home per fact

- **Each file has one job, and each fact lives in exactly one file; everywhere else points to it.** The one exception is a behavior-changing rule, repeated on purpose where it gets followed.
- **A fact the environment already states (`package.json`, a config file, `--help`) stays there; a doc never restates it.**
- **A library repo may point at a repo that uses it, for cases relevant to the library, but never at a private one**; from a published doc that pointer is a github.com URL.

## File shapes

- **A rule line is the bolded rule plus at most a short clause of scope or its one exception**, brief and clear at once, with no length cap standing in for either.
- **Examples, instances, citations and the why go in the rules file's reasoning folder, which is never auto-loaded**; a rules-file section with anything beyond its rules gets a reasoning file.
- **A mechanics doc opens with a lead of 5 lines and 800 bytes or fewer, and over 4 KB it needs `##` headings**; lint checks both.
- **A mechanics doc's headings are specific enough to grep; a rule found in one moves up to a rules file or nested AGENTS.md, leaving a pointer.**
- **A mechanics doc covering subjects that share nothing is split and indexed.**

## Placement

- **A rule goes on the highest rung of the enforcement ladder it can reach** ([ladder](./agents/prose-files.md#terms)).
- **Add to the root AGENTS.md only a fact that changes what an agent does on nearly every task, or whose miss is costly and can't be cheaply undone.**
- **When you add to the root AGENTS.md, shorten or drop a line that no longer earns its place, and state the net bytes in your reply.**

## Smells

Each smell reads *what it is* → *how to fix*. Whether a smell is fixed or kept: [`docs/agents/verdicts.md`](./agents/verdicts.md).

- **Duplicated Fact**: one fact stated in two files. → keep it in its home and point there from the other.
- **Shotgun Surgery**: one change forces edits across many docs. → gather the fact into one home the others point at.
- **Divergent Doc**: one file covering unrelated subjects. → split it by subject and index the parts.
- **Stale Fact**: a statement the diff made untrue. → fix it, or delete it.
- **Mysterious Heading**: a heading too vague to grep. → rename it for what the section holds.
- **Speculative Rule**: a rule for a case nothing has. → delete it until the case turns up.
- **Middle Man Pointer**: a pointer to a pointer. → point at the target directly.
- **Bloated Rule Line**: why or examples inside a rule line. → cut the line to the rule and move the rest to its reasoning file.
- **Weak Pointer**: pointer wording that won't trigger when its case comes up. → front-load the leading word and name each branch that should reach it.
- **Derived prose restates only the facts its mirror table lists, and Duplicated Fact never applies to those**; a fact missing from the table is a Duplicated Fact.
- **Stale Fact applies to derived prose in full.**
