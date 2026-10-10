---
name: review-piece
description: "Review a writing Piece's Deliverable as it is now, in three parallel sub-agents: Spec (facts, length, Reference reuse), Style (the style sheets and the spec's overrides) and Reader (what it says to someone without the spec). Reports them side by side."
disable-model-invocation: true
---

Three-axis review of a Piece's Deliverable, read as it is now. There is no diff and no fixed point.

- **Spec**: does the text hold to the spec's facts, length limit and References?
- **Style**: does it follow the style sheets and the spec's overrides?
- **Reader**: what does it say to a reader who never saw the spec?

Each axis runs in a **fresh-context sub-agent** that never wrote the Piece, so the axes judge the text rather than the author's intent. The Piece rules live in the writing package: [`packages/writing/AGENTS.md`](../../../packages/writing/AGENTS.md) (its "Implementing a piece spec" and "Done checks" sections) and its `GLOSSARY.md`. Point the sub-agents there; never restate them here.

## 1. Pin the issue and its scope

The input is an issue in `byronbroughten/writing`. Fetch it with `gh issue view -R byronbroughten/writing <n> --json title,body,comments --jq '{title, body, comments: [.comments[].body]}'` and state its title. If the reference is ambiguous, or the issue is Research rather than a Piece, stop and say so.

Run `gh api repos/byronbroughten/writing/issues/<n>/parent`; a 404 means no parent. Fetch a parent when there is one, since its facts join the fact list. Then set the **scope**:

- **Sections**: the issue has a parent and is not the final pass. The scope is the Sections it names, matched by their exact heading text in the Deliverable.
- **Whole**: the issue has no parent, or it carries the `final-pass` label. The scope is the whole Deliverable.

Done when the title is stated, the scope is one of the two, and for Sections every named heading is found in the Deliverable. A heading that isn't found fails here, before any sub-agent runs.

## 2. Gather the inputs

Write each to its own file in the scratchpad, so each sub-agent gets only its own files:

- **Deliverable**: the Google Doc the spec names, read now as Markdown with the gworkspace tools.
- **Reader**: the spec's Reader field, verbatim, and nothing else. With no Reader field, use the spec's lines on who the Piece is for and mark them a stand-in.
- **Fact list**: the closed list the implementer had: the issue's facts, the parent's facts, any verified source list a Research issue produced and the spec links, and any of the developer's own text the spec names as given.
- **Length limit**: the spec's, verbatim.
- **References**: each Reference's text, read from Drive by the file ID the spec lists. For one too long to read whole, read the passages the spec lists by page range; with none listed, use the passages a Research issue quoted.
- **Style**: the spec's Evidence and Formality values, whether the Piece is Academic, and its style overrides, verbatim.

Done when every file exists, or the spec has no such field and you say so. A missing Drive ID or Reference is asked for, never guessed. Note each **gap**: an input that is missing, a stand-in, or only partly loaded.

## 3. Spawn the three sub-agents in parallel

Issue all three Agent calls together, in the foreground. Each prompt names the scope: the Section headings or "the whole Deliverable".

**Spec** sub-agent, `model: "sonnet"`. Its prompt gives the Deliverable, fact list, length limit and References files, points at done checks 1, 2 and 4 in `packages/writing/AGENTS.md`, and the brief: "For the in-scope text only, report every factual claim that doesn't trace to the fact list and every sentence reused from a Reference. Report whether the whole Deliverable meets the length limit. Quote the spec line or the Reference sentence for each finding. Label hard only a claim missing from the fact list, a reused sentence or a missed length limit; label how the text describes a source (overstated, narrowed, misattributed) a judgement call. Under 400 words."

**Style** sub-agent, the session's model. Its prompt gives the Deliverable and Style files, points at the "Voice" rule under "Implementing a piece spec" in `packages/writing/AGENTS.md`, plus `docs/academic-writing-style.md` for an Academic Piece, and the brief: "For the in-scope text only, report every place it breaks `docs/writing-style.md`'s rules, read in full and applied with the rules tagged for these Evidence and Formality values, or the spec's overrides, which win where they conflict. Cite the rule for each finding and quote the sentence. Every finding is a judgement call. Under 400 words."

**Reader** sub-agent, the session's model. Its prompt gives only the Deliverable and Reader files. Never give it the facts, the References, the style sheets or the spec. The brief: "You are the reader described. Read the whole Deliverable, then for the in-scope part only report: (a) what you took it to say, in a few sentences; (b) each place you got lost, quoting it; (c) what you would ask the author. Under 400 words."

## 4. Aggregate

Present the three reports under `## Spec`, `## Style` and `## Reader`, verbatim or lightly cleaned. Open each with that axis's gaps from step 2 and the check each one weakened. Keep the axes unmerged and unranked: one axis's findings must never bury another's.

End with one line per axis: its finding count and its worst finding. Pick no winner across axes.
