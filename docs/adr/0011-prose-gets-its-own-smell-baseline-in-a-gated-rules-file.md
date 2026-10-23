# Prose gets its own smell baseline in a gated rules file

Developer-facing prose was meant to stay as maintainable as code, but its rules reached an agent only when a search found them. Code had a gate and a fixed Fowler baseline in every review; prose had neither. So prose gets the same machinery, built for prose: a short rules file of one-line rules plus a fixed list of prose smells, a hook that holds a markdown edit until that file is read in full, and a drift step in the implementer for the docs a change makes untrue.

Source: byronbroughten/byro-repo#382

## Considered Options

- **Reuse the Fowler baseline for prose.** Rejected: its smells are about functions, classes and types, and the ways prose rots (a fact in two homes, a stale statement, a pointer that won't trigger) have no code equivalent to cite.
- **Reshape `prose-files.md` into the rules file.** Rejected: most of its bytes are the file map and the README mirror tables, which a full read before every doc edit would pay for no reason.
- **Paste the prose baseline into `/code-review`.** Rejected: the skill's code baseline lives there because it applies to any repo; the prose baseline is specific to this repo, so it stays in the repo's rules file with one home.
- **Leave READMEs under Duplicated Fact.** Rejected: a README restates facts by design, so they become derived prose, exempt from Duplicated Fact for the facts their mirror table lists but never from Stale Fact.
