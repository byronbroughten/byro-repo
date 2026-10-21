---
name: grill-piece
description: "Grill the developer on a writing Piece: read its Supporting Material first, ask grilling.md's questions in rounds with drafted answers, then end with the calibration paragraph and an Outline for approval. /piece-spec files the result."
disable-model-invocation: true
---

Grill the developer on one Piece until [`packages/writing/docs/grilling.md`](../../../packages/writing/docs/grilling.md) is done, then draft its Outline. Read that doc in full first: it holds the questions, the rounds rule and the calibration paragraph. The Piece words (Piece, Deliverable, Section, Outline, Supporting Material, Reference) are the writing [`GLOSSARY.md`](../../../packages/writing/GLOSSARY.md)'s. This skill only grills; `/piece-spec` files the spec after it.

## 1. Opening round

Ask for two things only, in one message:

- **The Deliverable**: the Google Doc's title and Doc ID.
- **The Supporting Material**: Drive file IDs, or a Drive folder to search.

Done when both are answered. An ID is always asked for, never guessed. For a folder, list it with the gworkspace tools and read the files found back to the developer, who strikes any that don't belong.

## 2. Read the files

Size each file from its Drive metadata. **Short** is under about 10 pages; a file you can't size is long.

- **The short files go to one sub-agent together**, which reads each in full and returns, per file by title: what it is, every fact bearing on grilling.md's questions, and any of the developer's own text, quoted verbatim with where it lives.
- **Each long file gets its own sub-agent**, which reads only its table of contents and front matter and returns its chapters and sections with page ranges. One that finds the file short after all reads it whole and returns what a short-file sub-agent would.

Dispatch them all at once, reads only, each told the file IDs and to cite by title and page. Done when every file has come back one way or the other.

## 3. Ask in rounds

Call the Skill tool with "grilling" for its round format, and ask grilling.md's questions by its rounds rule. Its Long reads question goes first, put against step 2's chapter lists: "which of these matter?"

Every question carries a recommendation:

- **A factual question's** is drafted from the files and cites the file it came from.
- **A voice question's** (verdict, stakes, before and after, Temperature, Reach) quotes the developer's own text from Drive when one exists, cited. Otherwise it is labelled _draft, reword it_, so agent wording reaches the spec only once the developer rewords it.

**A term settled in the grill goes into the writing `GLOSSARY.md` at once**, in its existing entry shape. Nothing else is written until `/piece-spec`.

Done when every grilling.md question has an answer in the developer's words, or their waiver.

## 4. End

1. **The calibration paragraph**, by grilling.md. A difference that holds for this Piece alone becomes a style override; note it for the Style field.
2. **The Outline.** Read [`packages/writing/docs/outlining.md`](../../../packages/writing/docs/outlining.md), then draft the Outline from the settled facts and put it to the developer. Done when the developer approves it.
3. **The `/to-writing-style` candidates**: each calibration difference that holds for every Piece, listed in chat, not written; that skill's approval is where they land.

End by recommending `/piece-spec`.
