# A piece spec's judgement

Read this when the spec's `Labels:` line in `issue:read`'s output holds `piece`. Its rules replace steps 3 to 5 of [`SKILL.md`](./SKILL.md) where they differ; the rounds, the order and writing a decision stay as that file has them. The words Piece, Deliverable, Section, Agent draft and Edit gate are [`docs/pieces/GLOSSARY.md`](../../../docs/pieces/GLOSSARY.md)'s.

## The answers

- **Offer only Accept, Dismiss or Fix**, never a Decision: a piece spec files no grilling ticket.
- **A fix is "now" when it adds no new Section and any reading it needs is small and well-scoped**; file it otherwise. Pre-fill "now or file?" by that rule.
- **A fact the developer supplies goes into the Agent draft and into the item's `Decided:` line, never into the spec**, which stays unedited. A filed drafting ticket copies the fact into its `## Facts`.

## Making a "now" fix

- **Write the fix in the Agent draft, at the path [`agent-draft.md`](../../../docs/pieces/agent-draft.md#file-format) gives, never in the Deliverable**, in the `judge-<spec>` session workspace in the spec's repo, one commit per item as step 4 says.
- **Draft it under the Voice, Craft and academic sheets as [`rules.md`'s Implementing a piece spec](../../../docs/pieces/rules.md#implementing-a-piece-spec) says**: read them in full first, the academic sheet for an Academic Piece only.
- **Then rerun `npm run overlap -- --deliverable <Agent draft> --passages <folder> --allow <file>`** and judge each new hit in the fixed text before committing. `<folder>` is the passages folder of the ticket that drafted the Section ([the passages folder's format](../../../docs/agents/workflows.md#the-shared-formats)); `<file>` lists the proper names and fixed terms the Piece can't reword.

## Filing a larger fix

- **File it with `/piece-tickets`' piece-ticket template ([`SKILL.md`](../../../.claude/skills/piece-tickets/SKILL.md#3-file-the-tickets)) as a drafting ticket**: `ready-for-agent`, its `## Model fit` included, its Sections named by exact heading text.
- **It always blocks the spec**: make it a sub-issue of the spec, and add it to the Edit gate's blockers by [`issue-tracker.md`'s blocking operation](../../../docs/agents/issue-tracker.md#wayfinding-operations), so the rerun drafts it before the push.

## The ending

- **Never close a piece spec, and give no `/to-code-style` reminder**: the Edit gate's wrap-up ends it.
- **End by naming the runner's rerun command, the `npm run runner -- <owner>/<repo> <spec>` its "judge, then rerun" message printed**, launched detached as `npm run runner:tmux -- <owner>/<repo> <spec>` or supervised with `/runner <owner>/<repo> <spec>`, whose push writes the decided fixes into the Deliverable once no item is undecided. Before it, say what is left: undecided items, and open sub-issues by number.
