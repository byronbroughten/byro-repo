---
name: piece-tickets
description: "Split a piece spec into sub-issues chosen from Research, drafting and a final pass, ending at an Edit gate, confirm the split with the developer, then file them in the spec's repo with blocking edges. Invoked as /piece-tickets <repo> <n>."
argument-hint: "<repo> <n>"
disable-model-invocation: true
---

`/piece-tickets <repo> <n>` splits the piece spec `<repo>#<n>` into sub-issues in `<repo>`. The Piece rules live in the root's `docs/pieces/`: [`rules.md`](../../../docs/pieces/rules.md) and [`GLOSSARY.md`](../../../docs/pieces/GLOSSARY.md). Use their words (Piece, Deliverable, Section, Supporting Material, Reference); never restate them here.

## 1. Read the spec

Fetch it with `npm run issue:read -- <repo> <n> --body` and state its title. Read its Research, Final pass, Split, Form and Outline fields. Done when all five are found; a missing one is asked for, never inferred.

## 2. Propose the split

Choose the stages the fields call for, always with at least one drafting ticket and the Edit gate:

- **Research**, when the Research field says needed: verifies the sources and facts it names and posts its list as a comment. It writes nothing to the Deliverable, and revises the spec's Outline only as [`docs/pieces/outlining.md`](../../../docs/pieces/outlining.md#when-research-revises-it) allows.
- **Sections**, when Split names Sections: each ticket names its Sections by their exact heading text in the Deliverable. A Piece with no headings, such as a letter, gets no Section tickets; flag a Split that names Sections for one.
- **Final pass**, when the Final pass field says needed and there are Section tickets: covers the whole Deliverable, as that field describes, and checks that each short name coined in one Section is used the same way throughout.
- **Whole draft**, when Split is one session or the Piece has no headings: one drafting ticket for the whole Deliverable, final pass included, labelled like a final pass so it drafts every Section.
- **Edit gate**, always: the developer's ticket to edit the Deliverable once the run has pushed the draft, as the [writing glossary](../../../docs/pieces/GLOSSARY.md) defines it.

Every ticket but Research and the Edit gate is a drafting ticket.

Size each ticket to fit one session under the ticket budget (default ~150K) in [`docs/agents/planning.md`](../../../docs/agents/planning.md#ticket-size), estimated at its read rates from the Supporting Material and Reference passages it reads, the Outline, and the length it drafts. Count only the earlier Sections `rules.md` has its drafter open, not every one.

Order them Research first, drafting tickets in reading order with the final pass after them, each blocked by the one before, and the Edit gate last, blocked by every drafting ticket. Present a numbered list: title, stage, the Sections it names, blocked by, its rough size, and for each ticket but the Edit gate its model fit, one of the pairs in [`model-fit.md`](../../../docs/agents/model-fit.md) chosen with the Piece rows of its [outcome log](../../../docs/agents/model-fit.md#outcome-log). Ask whether the granularity, the order and the edges are right.

Done when the developer confirms the list. File nothing before that.

## 3. File the tickets

Before filing, run `gh label create <label> -R <owner>/<repo> --force` for `research` and `final-pass`. File them in order, blockers first, each but the Edit gate with `ready-for-agent`, using the piece-ticket template below. A Research ticket also gets `research`, and the final-pass or whole-draft ticket `final-pass`: the run picks each ticket's Steps and scope by them. File the Edit gate last with `ready-for-human`, never `ready-for-interactive`, which a run's Supervisor would take, using the Edit gate template. Make each ticket a sub-issue of the spec and set its blocking edges as GitHub's native issue dependencies, by the child-ticket and blocking operations in [`docs/agents/issue-tracker.md`](../../../docs/agents/issue-tracker.md#wayfinding-operations).

Copy in each ticket's facts and the parent's shared rules verbatim, so the implementer works from the ticket alone and opens the parent only when a criterion is ambiguous.

<piece-ticket-template>

## Parent

The spec's issue reference.

## What to write

The stage, and for a Section ticket its Sections by exact heading text.

## Shared rules

Copied from the parent: the Deliverable, the Supporting Material this ticket reads (with page ranges, a long PDF's read by the root's `docs/pdf-pages.md`), Reader, Style, Form and Outline.

## Facts

The facts this ticket uses, including any of the developer's own text named as given.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Model fit

<Model> <effort>
<one-line reason>

</piece-ticket-template>

`## Model fit` is the last section of every `ready-for-agent` piece ticket, by [`planning.md`'s Model fit rules](../../../docs/agents/planning.md#model-fit): the pair confirmed in step 2, then a one-line reason.

<edit-gate-template>

Title: `Edit gate: <the Deliverable's title>`

## Parent

The spec's issue reference.

## What to do

This is the developer's ticket; the runner never launches it. Once the run ends and has pushed the Agent draft into the Deliverable, edit the Deliverable in its Doc, then run `/start-issue <repo> <n>` on this issue and close it out with wrap-up.

</edit-gate-template>

The Edit gate has no `## Model fit`.

Leave the parent spec's body unchanged.

## 4. Read back the tickets

Print the filed tickets as one flat list in completion order, `#n Title: <Model> <effort> (reason)`, the read-back of each ticket's `## Model fit` section, with the Edit gate last as `#n Title: ready-for-human`. Done when every filed ticket appears; end by recommending `/runner` on the spec, or `/implement-piece <repo> <n>` on the first ticket for an interactive session.
