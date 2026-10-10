---
name: to-piece-tickets
description: "Split a piece spec into sub-issues chosen from Research, Sections and a final pass, confirm the split with the developer, then file them in the writing tracker with blocking edges."
disable-model-invocation: true
---

Split a piece spec into sub-issues in `byronbroughten/writing`. The Piece rules live in the writing package: [`packages/writing/AGENTS.md`](../../../packages/writing/AGENTS.md) and its `GLOSSARY.md`. Use their words (Piece, Deliverable, Section, Reference); never restate them here.

## 1. Read the spec

Fetch it with `gh issue view -R byronbroughten/writing <n> --comments` and state its title. Read its Research, Final pass, Split and Form fields. Done when all four are found; a missing one is asked for, never inferred.

## 2. Propose the split

Choose only the stages the fields call for:

- **Research**, when the Research field says needed: verifies the sources and facts it names and posts its list as a comment. It writes nothing to the Deliverable.
- **Sections**, when Split names Sections: each ticket names its Sections by their exact heading text in the Deliverable. A Piece with no headings, such as a letter, gets no Section tickets; flag a Split that names Sections for one.
- **Final pass**, when the Final pass field says needed and there are Section tickets: covers the whole Deliverable, as that field describes.

With a one-session Split, the spec itself is the drafting ticket, final pass included: propose only Research, and say the spec is implemented once Research closes.

Size each ticket to fit one session under the ~150K context budget in [`docs/agents/planning.md`](../../../docs/agents/planning.md#ticket-size), estimated from the Reference text it reads and the length it drafts.

Order them Research first, Sections in reading order, the final pass last, each blocked by the one before. Present a numbered list: title, stage, the Sections it names, blocked by, and its rough size. Ask whether the granularity, the order and the edges are right.

Done when the developer confirms the list. File nothing before that.

## 3. File the tickets

File them in order, blockers first, each with `ready-for-agent`, using the template below. The final-pass ticket also gets `final-pass`; create that label in the writing tracker if it is missing. Make each ticket a sub-issue of the spec and set its blocking edges as GitHub's native issue dependencies, by the child-ticket and blocking operations in [`docs/agents/issue-tracker.md`](../../../docs/agents/issue-tracker.md#wayfinding-operations).

Copy in each ticket's facts and the parent's shared rules verbatim, so the implementer works from the ticket alone and opens the parent only when a criterion is ambiguous.

<piece-ticket-template>

## Parent

The spec's issue reference.

## What to write

The stage, and for a Section ticket its Sections by exact heading text.

## Shared rules

Copied from the parent: the Deliverable and its standing yes, the References this ticket reads (with page ranges), Reader, Voice and Form.

## Facts

The facts this ticket uses, including any of the developer's own text named as given.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

</piece-ticket-template>

Leave the parent spec's body unchanged.
