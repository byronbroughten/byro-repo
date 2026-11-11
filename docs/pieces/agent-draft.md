# Agent drafts

An Agent draft ([GLOSSARY.md](./GLOSSARY.md#language)) is the agents' last version of a Piece's Sections, beside the developer's as the Deliverable last showed them. A drafting ticket's runner pull writes it, its implement step drafts in it, an `/implement-piece` session does both, and `/to-writing-style` diffs it against the edited Deliverable.

## File format

- **A Piece's Agent draft is `writing/agent-drafts/<n>.md` at the root of the repo that files its spec, `<n>` being the Piece's spec number**: the parent's, for a split Piece.
- **It holds one block per Section of the Deliverable, in the Deliverable's order**: `## <Section heading>`, then its author mark on the next line, then the Section's body in the Docs module's Markdown dialect.
- **The author mark is `<!-- developer -->` or `<!-- agent -->`.** A Section an agent drafted is the agent's; every other Section is the developer's.
- **The file changes only by a pull or an implement step, a run's or an `/implement-piece` session's.** Its edits are never made by hand.

## Pull

Pull is the runner Step a piece spec's drafting ticket starts with, so a developer edit made in the Doc once the run is under way never enters the draft. An `/implement-piece` session pulls by these rules itself, recording no baseline.

- **It reads the Doc the spec's `## Deliverable` section names by its ID, through the Docs module.**
- **Each developer Section, and each Section the file doesn't hold yet, comes from the Doc, marked `<!-- developer -->`; each agent Section stays as the file has it.** An agent Section the Doc no longer holds stays too, after the Doc's.
- **It records every Section's text as the Doc showed it, agent Sections included, with the revision read, on the ticket's run state**: the baseline a later push compares the Doc against.
- **It commits the file on the ticket's branch in the spec's repo**, and commits nothing when the file already matched.
