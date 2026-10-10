---
name: to-piece-spec
description: "Turn a grilled conversation about a writing Piece into a piece spec with its nine fields, and file it in the writing tracker."
disable-model-invocation: true
---

Synthesize the grilled conversation into a piece spec and file it in `byronbroughten/writing`. The Piece rules live in the writing package: [`packages/writing/AGENTS.md`](../../../packages/writing/AGENTS.md), its `GLOSSARY.md` and [`docs/grilling.md`](../../../packages/writing/docs/grilling.md). Use their words (Piece, Deliverable, Section, Reference) and cite them; never restate them here.

## 1. Fill the nine fields

Draw each field from the conversation, in the developer's words where they gave them:

- **Deliverable**: the Google Doc's title and Doc ID, and the standing yes to write to that one Doc.
- **References**: each by title and Drive ID, with what it is for. For one too long to read whole, such as a book, list the passages that count by page range.
- **Reader**: who reads the Piece, and what they already know.
- **Voice**: the Axes line (`Evidence: <value> · Formality: <value>`, or `Academic`), then the style overrides. A calibration paragraph the developer rewrote goes here, quoted, as the target voice.
- **Form**: the length limit, and the template or Section order if there is one.
- **Facts**: the closed list the Piece may use. Name any of the developer's own text the Piece keeps or revises (an earlier draft, a target-voice paragraph, a Reference entry already graded) as given, with where it lives.
- **Research**: needed or not, and on what.
- **Final pass**: needed or not, and what it covers.
- **Split**: one session, or the proposed Sections, each named by its heading text. A Piece with no headings, such as a letter, is one session.

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

## References

## Reader

## Voice

## Form

## Facts

## Research

## Final pass

## Split

## Out of Scope

## Further Notes

The Piece is done by the four done checks in the writing package's `AGENTS.md`.

</piece-spec-template>

End by recommending `/to-piece-tickets` when Research is needed or Split names Sections, and `/implement-piece` otherwise.
