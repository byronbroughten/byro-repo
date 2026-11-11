# Agent drafts

An Agent draft ([GLOSSARY.md](./GLOSSARY.md#language)) is the agents' last version of a Piece's Sections, beside the developer's as the Deliverable last showed them. A drafting ticket's runner pull writes it, its implement step drafts in it, an `/implement-piece` session does both, `/judge-findings` makes its "now" fixes in it, the spec's push writes its agent Sections into the Deliverable, and `/to-writing-style` diffs it against the edited Deliverable.

## File format

- **A Piece's Agent draft is `writing/agent-drafts/<n>.md` at the root of the repo that files its spec, `<n>` being the Piece's spec number**: the parent's, for a split Piece.
- **It holds one block per Section of the Deliverable, in the Deliverable's order**: `## <Section heading>`, then its author mark on the next line, then the Section's body in the Docs module's Markdown dialect.
- **The author mark is `<!-- developer -->` or `<!-- agent -->`.** A Section an agent drafted is the agent's; every other Section is the developer's.
- **The file changes only by a pull, an implement step (a run's or an `/implement-piece` session's), or a `/judge-findings` "now" fix.** Its edits are never made by hand.

## Pull

Pull is the runner Step a piece spec's drafting ticket starts with, so a developer edit made in the Doc once the run is under way never enters the draft. An `/implement-piece` session pulls by these rules itself, recording no baseline.

- **It reads the Doc the spec's `## Deliverable` section names by its ID, through the Docs module.**
- **Each developer Section, and each Section the file doesn't hold yet, comes from the Doc, marked `<!-- developer -->`; each agent Section stays as the file has it.** An agent Section the Doc no longer holds stays too, after the Doc's.
- **It records every Section's text as the Doc showed it, agent Sections included, with the revision read, on the ticket's run state**: the baseline a later push compares the Doc against.
- **It commits the file on the ticket's branch in the spec's repo**, and commits nothing when the file already matched.

## Push

Push is the runner's last spec-end Step on a piece spec, after the gap check and the judge Step, so it runs only once no review-list item is undecided. The run then ends at the Edit gate, and no agent writes the Piece after it: a later agent round is a new piece spec with the developer's text as Given.

- **It writes each agent Section of the Agent draft on master into the Deliverable through the Docs module, under its revision guard, reading the Doc again before each write.**
- **A Section whose Doc text already matches the agent's is skipped**, so a rerun writes nothing twice; once every agent Section is written, the run state marks the push done and a rerun pushes nothing.
- **It never writes over the developer's edits unasked: a Section whose Doc text differs from the pull baseline, or that has no heading in the Doc, raises a push Halt on the spec issue naming it, answered `overwrite` or `keep mine`.** The push gathers every Halt before it writes anything, so it writes the Doc as one act. A missing Section's question says to add its heading, then answer `overwrite`; an agent Section the pull never saw counts as empty, so adding its heading lets the push write it.
- **The baseline is the newest one any of the spec's tickets recorded**, which holds every Section of the Doc. A spec with none, every drafting ticket worked in a session, treats every agent Section as changed since the pull.
- **`overwrite` writes the agent text over the Doc's; `keep mine` leaves the Doc alone and marks the Section as the developer's in the Agent draft**, in a runner commit landed as a session landing that closes no issue.
- **An open push Halt holds the spec-end Steps, as a gap-check Halt does**; the answers are delivered once the push completes.
- **On a stale revision the push reads the Doc and compares it against the pull baseline again, up to a bound, then stops the run.**
- **Pending suggestions the writer can't index around raise a push Halt naming the Doc**, answered `continue` once the developer has accepted or rejected them; suggestions still pending on the rerun raise it again.
