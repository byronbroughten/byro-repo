# Prose smells

What each prose smell looks like in this repo, and why derived prose gets its own two rules. The baseline mirrors the code smells `/code-review` carries, renamed for prose; how any smell is judged is [`verdicts.md`](../agents/verdicts.md).

## What each smell looks like

- **Duplicated Fact**: the layout of vendored skills stated in the root README and nowhere an agent reads (#233).
- **Shotgun Surgery**: renaming one command means editing AGENTS.md, a skill and two docs, because each restates how to run it.
- **Divergent Doc**: `prose-files.md` holding rules, a file map and README mirror tables together, until its rules moved to `prose-style.md`.
- **Stale Fact**: a map row still naming "the voice" after the writing package gained a second style sheet (#313).
- **Mysterious Heading**: `## Notes`, which no grep for the subject finds.
- **Speculative Rule**: a verdict exception for prose written before any prose-only case had come up.
- **Middle Man Pointer**: a router row pointing at a doc whose only line on the subject points at a third file.
- **Bloated Rule Line**: a rule line padded with its reason and an example to fill the old 300-character cap.
- **Weak Pointer**: a router row worded for the file it points at, not for the task that should reach it, so the agent never opens it.

## Derived prose

A README restates facts on purpose, for onlookers on GitHub who never open the docs, so Duplicated Fact would flag its whole job. Its mirror table in `prose-files.md` names each fact it may restate and where that fact lives; a fact outside the table has no such licence, so the exemption can't grow on its own. A README that no longer matches the fact it mirrors misleads its reader exactly as any other stale doc does, so Stale Fact applies in full.
