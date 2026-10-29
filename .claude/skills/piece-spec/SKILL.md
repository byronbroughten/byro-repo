---
name: piece-spec
description: "Turn a /grill-piece conversation about a writing Piece into a piece spec with its ten fields, and file it in the writing tracker."
disable-model-invocation: true
---

Synthesize the conversation `/grill-piece` ran, the step before this one, into a piece spec and file it in `byronbroughten/personal`. The Piece rules live in the writing package: [`packages/personal/writing/AGENTS.md`](../../../packages/personal/writing/AGENTS.md), its `GLOSSARY.md` and [`docs/grilling.md`](../../../packages/personal/writing/docs/grilling.md). Use their words (Piece, Deliverable, Section, Supporting Material, Reference) and cite them; never restate them here.

## 1. Fill the ten fields

Draw each field from the conversation, in the developer's words where they gave them:

- **Deliverable**: the Google Doc's title and Doc ID.
- **Supporting Material**: each by title and Drive ID, with what it is for. For one too long to read whole, such as a book, list the passages that count by page range, given as PDF pages with the printed pages beside them when they differ, such as `PDF pp. 45–60 (printed 31–46)`.
- **Reader**: who reads the Piece, and what they already know.
- **Style**: the Axes line grilling.md's Formality question gives, then the style overrides, to any sheet: Voice, Craft or academic.
- **Form**: the length limit and its cut order, and the template if there is one.
- **Outline**: the glossary's Outline as the developer approved it at the grill's end. [`docs/outlining.md`](../../../packages/personal/writing/docs/outlining.md) says how it is written and how a template in Form fixes its Sections.
- **Facts**: the closed list the Piece may use, with each answer to grilling.md's Your own text question named as given, quoted or with where it lives.
- **Research**, **Final pass** and **Split**: grilling.md's answers to the questions of those names.

Done when every field holds an answer or the developer's waiver. Ask for any field the conversation left open, all in one message; a Drive or Doc ID is always asked for, never guessed.

## 2. Write and file

Write the spec with the template below, then file it with `gh issue create -R byronbroughten/personal --label ready-for-agent`. Drive and Doc IDs belong in it: the implementer reads by them.

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

End by recommending `/piece-tickets` when Research is needed or Split names Sections, and `/implement-piece` otherwise, with its pair as one chat line, `/implement-piece #n: <Model> <effort> (reason)`, chosen by [model fit](../../../docs/agents/planning.md#model-fit) and the writing outcome log in [`docs/model-fit.md`](../../../packages/personal/writing/docs/model-fit.md). **`/piece-tickets` and `/piece-spec` stay chat only.**
