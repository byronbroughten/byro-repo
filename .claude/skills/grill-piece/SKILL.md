---
name: grill-piece
description: "Grill the developer on a writing Piece: read its Supporting Material first, ask grilling.md's questions in rounds with drafted answers, then end with the calibration paragraph and an Outline for approval. /piece-spec files the result."
disable-model-invocation: true
---

Grill the developer on one Piece by [`packages/writing/docs/grilling.md`](../../../packages/writing/docs/grilling.md); read it in full first. Its questions, rounds rule and done criterion are the grill's; this skill adds how to read the files and draft each recommendation. The Piece words (Piece, Deliverable, Section, Outline, Supporting Material, Reference) are the writing [`GLOSSARY.md`](../../../packages/writing/GLOSSARY.md)'s.

## 1. Opening round

Ask for two things, in one message:

- **The Deliverable**: the Google Doc's title and Doc ID.
- **The Supporting Material**: Drive file IDs, or a Drive folder to search.

An ID is always asked for, never guessed. For a folder, list it with the gworkspace tools and read the files found back to the developer, who strikes any that don't belong. Done when both are answered and the file list is confirmed.

## 2. Read the files

**Short** is under about 10 pages. A Google Doc is sized by its Drive metadata: under about 30 KB is short. A PDF is downloaded and its pages counted, by [`docs/pdf-pages.md`](../../../docs/pdf-pages.md); one that can't be counted is long.

- **The short files go to one sub-agent together**, which reads each in full and returns, per file by title: what it is, every fact bearing on grilling.md's questions, and any of the developer's own text, quoted verbatim with where it lives.
- **Each long file gets its own sub-agent**, which reads only its table of contents and front matter and returns its chapters and sections with page ranges. A long PDF's sub-agent gets its local path and `docs/pdf-pages.md`, reads the first 20 PDF pages and more only while the contents run on, and gives each range as PDF pages with the printed pages beside them. One that finds the file short after all reads it whole and returns what a short-file sub-agent would.

Dispatch them all at once, reads only, each told the file IDs and to cite by title and page. Done when every file has its report: its facts and own text, or its chapter list.

## 3. Ask in rounds

Call the Skill tool with "grilling" for its round format; grilling.md's rounds rule and done criterion win over that skill's. Ask the Long reads question against step 2's chapter lists: "which of these matter?"

Every question carries a recommendation:

- **A factual question's** is drafted from the files and cites the file it came from.
- **A voice question's**, one of those grilling.md asks alone, quotes the developer's own text from Drive when one exists, cited. Otherwise it is labelled _draft, reword it_, so agent wording reaches the spec only once the developer rewords it. A bare "yes" to a draft is no answer yet: ask the developer to reword it or waive the question.

**Write a term settled in the grill into the writing `GLOSSARY.md` at once**, in its existing entry shape; that is the only file written before `/piece-spec`.

## 4. End

1. **The calibration paragraph**, by grilling.md. Keep each Piece-only difference for the Style field.
2. **The Outline.** Read [`packages/writing/docs/outlining.md`](../../../packages/writing/docs/outlining.md), then draft it from the settled facts for the developer's approval.
3. **The `/to-writing-style` candidates**: list each difference that holds for every Piece in chat, unwritten, for that skill's approval.

4. **Delete the PDFs step 2 downloaded**, by the paths it got back; each later stage downloads the ranges it reads.

Done when grilling.md's done criterion holds, the candidates are listed and the downloads are gone. End by recommending `/piece-spec`.
