---
name: review-piece
description: "Review a writing Piece's Agent draft on three axes, in parallel sub-agents: spec (facts, Outline, length, copied wording), standards (the Voice and Craft sheets, then garden paths) and reader (what it says to someone without the spec). Reports each finding with its suggested verdict. Invoked as /review-piece <repo> <n>."
argument-hint: "<repo> <n>"
disable-model-invocation: true
---

Three-axis review of a Piece's Agent draft, read as it is now. There is no diff and no fixed point, and the review changes nothing.

- **spec**: does the text hold to the spec's facts, Outline and length limit, and copy no wording from what its drafter read?
- **standards**: does it follow the Voice and Craft sheets and the spec's overrides, and can a reader parse each sentence on the first pass?
- **reader**: does what it says to a reader who never saw the spec match each Section's Outline claim?

Each axis runs in a **fresh-context sub-agent** that never wrote the Piece, so the axes judge the text rather than the author's intent. The Piece rules live in the root's `docs/pieces/`: [`rules.md`](../../../docs/pieces/rules.md) (its "Implementing a piece spec" and "Done checks" sections), [`agent-draft.md`](../../../docs/pieces/agent-draft.md) and [`GLOSSARY.md`](../../../docs/pieces/GLOSSARY.md). Point the sub-agents there; never restate them here.

An interactive session and the runner's review step read this file alike, so its one draft input is the same in both: the Agent draft and the passages folder. The Deliverable's Doc is never read.

## 1. Pin the issue and its scope

The input is `/review-piece <repo> <n>`, an issue in `<repo>`. Fetch it with `npm run issue:read -- <repo> <n> --body --comments`, adding `--hide-others` when your caller says to, and state its title. If the reference is ambiguous, or the issue is Research rather than a Piece, stop and say so.

When your caller names the issue's spec, that is its parent; otherwise run `gh api repos/<owner>/<repo>/issues/<n>/parent`, resolving `<repo>` to `<owner>/<repo>`; a 404 means no parent. Fetch a parent the same way as the issue when there is one: it is the spec, and its facts join the fact list. With no parent, the issue is its own spec. Then set the **scope**:

- **Sections**: the issue has a parent and is not the final pass. The scope is the Sections it names, matched by their exact heading text in the Agent draft.
- **Whole**: the issue has no parent, or it carries the `final-pass` label. The scope is the whole Agent draft.

Done when the title is stated, the scope is one of the two, and for Sections every named heading is found in the Agent draft. A heading that isn't found fails here, before any sub-agent runs.

## 2. Gather the inputs

**The draft input is two paths in the issue workspace**: the Agent draft at the path [`agent-draft.md`](../../../docs/pieces/agent-draft.md) gives, in `<repo>`'s clone, and the passages folder, `.runner/passages/<repo>-<n>` under the workspace root, which holds each passage the drafter read, one file per source and range. Read the spec, the Research comment it links and the sheets as below; read no Drive file and no web page.

Write each other input to its own file in the scratchpad, so each sub-agent gets only its own files:

- **Reader**: the spec's Reader field, verbatim, and nothing else. With no Reader field, use the spec's lines on who the Piece is for and mark them a stand-in.
- **Fact list**: the closed list the drafter had: the issue's facts, the spec's facts, the facts of any Research comment the spec links, never its `## Unverified` section, and any of the developer's own text the spec names as given.
- **Unverified**: each linked Research comment's `## Unverified` section, verbatim; facts set aside, outside the fact list.
- **Outline**: the spec's Outline field, verbatim.
- **Length limit**: the spec's, verbatim.
- **Overlap**: the output of `npm run overlap -- --deliverable <Agent draft> --passages <passages folder> --allow <file>`, its allow file listing the proper names and fixed terms the Piece can't reword.
- **Style**: the spec's Evidence and Formality values, whether the Piece is Academic, and its Style field's overrides, Form and Order sections, verbatim, in the Style file shape in [the Jev agent doc](../../../docs/agents/jev.md#the-style-check).

Done when every file exists, or the spec has no such field and you say so. Note each **gap**: an input that is missing, a stand-in, or only partly loaded; an empty passages folder, or a fact's cited range the folder lacks, is a gap, never a Drive read.

## 3. Spawn the three sub-agents in parallel

Issue all three Agent calls together, in the foreground. Each prompt names the scope, the Section headings or "the whole Agent draft", and asks for each finding as `where` (its `file:line` in the Agent draft), `claim` (one line, quoting the sentence), a suggested verdict and its reason. Each brief ends with the same verdict line: "Give each finding a suggested verdict and its reason under `docs/agents/verdicts.md`: Fix, Dismiss with its reason, Propose `decision` or `ticket`, or Halt."

**spec** sub-agent, the session's model. Its prompt gives the Agent draft, the fact list, Unverified, Outline, length limit and Overlap files and the passages folder, points at done checks 1, 2 and 4 in `docs/pieces/rules.md`, and the brief: "For the in-scope text only, report every factual claim that doesn't trace to the fact list, or that is drafted from the Unverified file, which is outside it, or that contradicts a fact or another part of the draft. Report how the text describes a source where it overstates, narrows or misattributes it. Judge each in-scope Overlap hit: report it as copied wording, or list it under Dismissed overlaps with a one-line reason. Add any sentence structure copied from the passages folder, which the Overlap list can't see. Report each in-scope Section that doesn't make its Outline claim or set out the facts the Outline assigns it. Report whether the whole draft meets the length limit. Quote the spec line or the copied passage for each finding. Under 400 words."

**standards** sub-agent, the session's model. Its prompt gives the Agent draft and Style files, points at the style rules under "Implementing a piece spec" in `docs/pieces/rules.md`, plus `docs/academic-writing-style.md` for an Academic Piece, and the brief: "Read `docs/writing-voice.md` and `docs/writing-craft.md` in full. Review the in-scope text in two passes. First, the sheets' rules: report every place it breaks a Voice rule, applied with the rules tagged for these Evidence and Formality values, or a Craft rule. Second, a first-pass read: report every sentence that reads one way on the first pass and turns out to mean another (a garden path). The spec's overrides and the academic sheet win where they conflict with a sheet's rule. Cite the rule for each finding and quote the sentence. Under 400 words."

**reader** sub-agent, the session's model. Its prompt gives only the Agent draft and Reader files. Never give it the facts, the passages, the style sheets, the Outline or the spec. The brief: "You are the reader described. Read the whole Agent draft, then for each in-scope Section report what you took it to say, in a sentence or two, and each place you got lost, quoting it. Under 400 words."

## 4. Turn the reader's report into findings

The reader's summary is never a finding itself. Compare each in-scope Section's summary with that Section's Outline claim: where they don't match, file one `reader` finding, its `where` the Outline line in the spec, its `claim` the mismatch with the sentence that misled, and its suggested verdict and reason. Each place the reader got lost is a `reader` finding at its `file:line`.

## 5. Report

Report the findings under `## spec`, `## standards` and `## reader`, each in its reviewer's order, never merged or reranked: one axis's findings must never bury another's. Open each with that axis's gaps from step 2 and the check each one weakened. Each finding gives its `where`, `claim`, suggested verdict and reason. End with `## Dismissed overlaps`: each Overlap hit the spec sub-agent judged no copy, as the overlap command printed it, with its one-line reason.

Pick no winner across axes. The runner's review step returns the same report as its record; an interactive session prints it.
