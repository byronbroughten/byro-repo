# Rules for writing Pieces

The rules every piece spec follows, in whichever repo files it as a GitHub issue. The words Piece, Deliverable, Section, Outline, Agent draft, Supporting Material and Reference are [GLOSSARY.md](./GLOSSARY.md)'s.

## Grilling a piece spec

- **Grill the developer on a Piece with `/grill-piece`**, which asks [grilling.md](./grilling.md)'s questions, then ends with the calibration paragraph and the Outline.
- **Before writing or revising a spec's Outline, read [outlining.md](./outlining.md).**

## Implementing a piece spec

- **Write the Piece's text in its Deliverable**, the Google Doc the spec names. Its only copy in a repo is its Agent draft, saved by `/implement-piece` per [agent-draft.md](./agent-draft.md); a run's implement step writes to the Agent draft instead.
- **Read Supporting Material from Drive by the file IDs the spec lists.** Reach for those IDs only; ask the developer if one is missing. A long PDF's listed passages are read from a download by [`pdf-pages.md`](../pdf-pages.md), never through the Drive content tool.
- **Write to the Deliverable without asking when one of the developer's accounts owns it, and create files freely.** Sharing any file still needs the developer's yes, as do the other gates in [`targets-and-gates.md`](../targets-and-gates.md).
- **Before drafting, read [`writing-voice.md`](../writing-voice.md) and [`writing-craft.md`](../writing-craft.md) with a Read that has no offset or limit, or a whole-file `cat`.**
- **For an Academic Piece, also read [`academic-writing-style.md`](../academic-writing-style.md).**
- **Apply the Voice rules tagged with the spec's Evidence and Formality values, every Craft rule, then the spec's Style overrides on top.** An override wins where it conflicts.
- **Draft from a Research comment's facts, never their quoted passages**; `## Unverified` is outside the fact list, per `/research-piece`.
- **Before drafting a Section, read the spec's Outline, and open an earlier Section in the Deliverable only for a fact or term the Outline says it sets out.**
- **A Piece has an `issue-<n>-<slug>` branch, because its Agent draft is a repo file.** It is implemented in an issue workspace (`npm run issue:start -- <repo> <n>`) and lands as code does, per [`git-workflow.md`](../agents/git-workflow.md#landing-a-spec).
- **A Research spec is run with `/research-piece`.** It has no branch, and lands as [`git-workflow.md`](../agents/git-workflow.md#landing-a-spec) says.

## Done checks

A Piece is done when all four hold:

1. Every factual claim traces to a fact listed in the spec, with nothing invented.
2. The Piece meets the spec's length limit.
3. It follows [`writing-voice.md`](../writing-voice.md) and [`writing-craft.md`](../writing-craft.md), apart from the style overrides the spec lists.
4. It copies no wording from the Reference or Supporting Material passages read for it, per [`writing-voice.md`](../writing-voice.md), apart from the developer's own text the spec names. `npm run overlap` lists the shared four-word runs; judge each one.
