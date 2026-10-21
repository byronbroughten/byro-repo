---
name: review-piece
description: "Review a writing Piece's Deliverable as it is now, in four parallel sub-agents: Spec (facts, Outline, length, copied wording), Voice (the Voice sheet and the spec's overrides), Clarity (the Clarity sheet: rules and garden paths) and Reader (what it says to someone without the spec). Reports them side by side, then runs Jev's style check as a trial."
disable-model-invocation: true
---

Four-axis review of a Piece's Deliverable, read as it is now. There is no diff and no fixed point.

- **Spec**: does the text hold to the spec's facts, Outline and length limit, and copy no wording from what its drafter read?
- **Voice**: does it follow the Voice sheet and the spec's overrides?
- **Clarity**: can a reader parse each sentence on the first pass, by the Clarity sheet's rules?
- **Reader**: what does it say to a reader who never saw the spec?

Jev's style check then runs on the same text as a trial beside them, logged against the Voice and Clarity axes.

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
- **Outline**: the spec's Outline field, verbatim.
- **Length limit**: the spec's, verbatim.
- **Read passages**: a folder with one file per passage: each Supporting Material file's text, read from Drive by the file ID the spec lists; for one too long to read whole, the passages the spec lists by page range. Add the passages a Research issue quoted, which stand for the References the drafter read.
- **Overlap**: the output of `npm run overlap -- --deliverable <Deliverable file> --passages <Read passages folder> --allow <file>`, its allow file listing the proper names and fixed terms the Piece can't reword.
- **Style**: the spec's Evidence and Formality values, whether the Piece is Academic, and its Style field's overrides, Form and Order sections, verbatim, in the Style file shape in [the Jev agent doc](../../../docs/agents/jev.md#the-style-check).

Done when every file exists, or the spec has no such field and you say so. A missing Drive ID or Supporting Material file is asked for, never guessed. Note each **gap**: an input that is missing, a stand-in, or only partly loaded.

## 3. Spawn the four sub-agents in parallel

Issue all four Agent calls together, in the foreground. Each prompt names the scope: the Section headings or "the whole Deliverable".

**Spec** sub-agent, `model: "sonnet"`. Its prompt gives the Deliverable, fact list, Outline, length limit, Read passages and Overlap files, points at done checks 1, 2 and 4 in `packages/writing/AGENTS.md`, and the brief: "For the in-scope text only, report every factual claim that doesn't trace to the fact list. Judge each in-scope Overlap hit, keeping it as copied wording or dismissing it with a one-line reason, and add any sentence structure copied from the Read passages, which the Overlap list can't see. Report each in-scope Section that doesn't make its Outline claim or set out the facts the Outline assigns it. Report whether the whole Deliverable meets the length limit. Quote the spec line or the copied passage for each finding. Label hard only a claim missing from the fact list, a fact the Outline assigns a Section that it leaves out, copied wording or a missed length limit; label how the text describes a source (overstated, narrowed, misattributed) and whether a Section makes its Outline claim a judgement call. Under 400 words."

**Voice** sub-agent, the session's model. Its prompt gives the Deliverable and Style files, points at the "Style" rule under "Implementing a piece spec" in `packages/writing/AGENTS.md`, plus `docs/academic-writing-style.md` for an Academic Piece, and the brief: "For the in-scope text only, report every place it breaks `docs/writing-voice.md`'s rules, read in full and applied with the rules tagged for these Evidence and Formality values, or the spec's overrides, which win where they conflict. Leave `docs/writing-clarity.md` to the Clarity axis. Cite the rule for each finding and quote the sentence. Every finding is a judgement call. Under 400 words."

**Clarity** sub-agent, the session's model. Its prompt gives the Deliverable and Style files, plus `docs/academic-writing-style.md` for an Academic Piece, and the brief: "Read `docs/writing-clarity.md` in full. Then, for the in-scope text only, report every sentence that breaks one of its rules, or that reads one way on the first pass and turns out to mean another (a garden path). The spec's overrides and the academic sheet win where they conflict with a Clarity rule. Quote the sentence and cite the rule for each finding. Every finding is a judgement call. Under 400 words."

**Reader** sub-agent, the session's model. Its prompt gives only the Deliverable and Reader files. Never give it the facts, the Read passages, the style sheets or the spec. The brief: "You are the reader described. Read the whole Deliverable, then for the in-scope part only report: (a) what you took it to say, in a few sentences; (b) each place you got lost, quoting it; (c) what you would ask the author. Under 400 words."

## 4. Run Jev's style check

After the four sub-agents return, run `npm run jev:style -- --deliverable <Deliverable file> --style <Style file>` on step 2's files, adding `--section "<heading>"` for each in-scope heading when the scope is Sections. It replaces no axis yet. Done when it has printed its `## Jev style` section or stopped; keep any stderr line for step 5.

## 5. Aggregate

Present the four reports under `## Spec`, `## Voice`, `## Clarity` and `## Reader`, verbatim or lightly cleaned. Open each with that axis's gaps from step 2 and the check each one weakened. Keep the axes unmerged and unranked: one axis's findings must never bury another's.

After them, show Jev's output as `## Jev style`, with its own count line, or the line it stopped on, plus any stderr line from step 4. It stays separate from the axes and unranked against them.

End with one line per axis, and one for Jev: its finding count and its worst finding. Pick no winner across axes.

## 6. Log the Jev trial

If `jev:style` stopped, skip this step and say so. Otherwise compare Jev's flags with the Voice and Clarity sub-agents' findings together, by the log's **Matches** column. List the disagreements (Jev's misses and its extra flags) and ask the developer to rule on each one.

Then add a row to the [Jev trial log](../../../docs/agents/jev-trial.md). **The row holds only counts, rule names and issue numbers, never a quoted sentence:** this repo is public and Pieces are private. Done when every disagreement has a ruling and the row is added.
