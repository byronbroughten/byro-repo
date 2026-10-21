---
name: piece-spec
description: "Turn a /grill-piece conversation about a writing Piece into a piece spec with its ten fields, and file it in the writing tracker."
disable-model-invocation: true
---

Synthesize the conversation `/grill-piece` ran, the step before this one, into a piece spec and file it in `byronbroughten/writing`. The Piece rules live in the writing package: [`packages/writing/AGENTS.md`](../../../packages/writing/AGENTS.md), its `GLOSSARY.md` and [`docs/grilling.md`](../../../packages/writing/docs/grilling.md). Use their words (Piece, Deliverable, Section, Supporting Material, Reference) and cite them; never restate them here.

## 1. Fill the ten fields

Draw each field from the conversation, in the developer's words where they gave them:

- **Deliverable**: the Google Doc's title and Doc ID.
- **Supporting Material**: each by title and Drive ID, with what it is for. For one too long to read whole, such as a book, list the passages that count by page range.
- **Reader**: who reads the Piece, and what they already know.
- **Style**: the Axes line (`Evidence: <value> · Formality: <value>`, or `Academic`), then the style overrides, to any sheet: Voice, Clarity or academic.
- **Form**: the length limit and its cut order, and the template if there is one.
- **Outline**: the Outline the developer approved at the end of the grill, the glossary's Outline, written by [`docs/outlining.md`](../../../packages/writing/docs/outlining.md), which also says how a template in Form fixes its Sections.
- **Facts**: the closed list the Piece may use. Name any of the developer's own text the Piece keeps or revises (the verdict, an earlier draft, the rewritten calibration paragraph, Supporting Material already graded) as given, quoted or with where it lives.
- **Research**: needed or not, and on what.
- **Final pass**: needed or not, and what it covers.
- **Split**: one session, or the Outline's Sections grouped into sessions, each named by its heading text. A Piece with no headings, such as a letter, is one session.

Done when every field holds an answer or the developer's waiver. Ask for any field the conversation left open, all in one message; a Drive or Doc ID is always asked for, never guessed.

## 2. Write and file

Write the spec with the template below, then file it with `gh issue create -R byronbroughten/writing --label ready-for-agent`. Drive and Doc IDs belong in it: the implementer reads by them.

<piece-spec-template>

## Problem Statement

What the developer needs this Piece for, from their perspective.

## Solution

The Piece, its Deliverable and how the work is staged, from the developer's perspective.

## User Stories

A short numbered list, only as long as the Piece needs: `As <actor>, I want <feature>, so that <benefit>`.

## Deliverable

## Supporting Material

## Reader

## Style

## Form

## Outline

## Facts

## Research

## Final pass

## Split

## Out of Scope

## Further Notes

The Piece is done by the done checks in the writing package's `AGENTS.md`.

</piece-spec-template>

End by recommending `/piece-tickets` when Research is needed or Split names Sections, and `/implement-piece` otherwise.
