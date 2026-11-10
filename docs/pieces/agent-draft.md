# Agent drafts

An Agent draft ([GLOSSARY.md](./GLOSSARY.md#language)) is the agents' last version of a Piece's Sections, saved before the developer edits them. `/implement-piece` writes it and `/to-writing-style` diffs it against the edited Deliverable.

- **A Piece's Agent draft is `writing/snapshots/<n>.md` in the repo that files its spec, `<n>` being the Piece's spec number**: the parent's, for a split Piece.
- **It holds one `## <Section heading>` block per Section an agent wrote, in the Deliverable's order**: the heading's text at level 2, then the Section's body as `get_doc_as_markdown` returns it. A Section the developer wrote or pre-filled stays out.
- **A save replaces only the blocks of the Sections it covers, adding any that are new, and leaves the rest alone.** Git keeps each earlier version.
- **The file changes only by a save.** Its edits are never made by hand.
