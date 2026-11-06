---
name: research-piece
description: "Research a writing Piece's Supporting Material: download its PDFs, have one sub-agent per source read its listed passages, verify every quote against the text, and post the fact list as a comment on the Research issue. Writes nothing to the Deliverable."
disable-model-invocation: true
---

Research the Research issue described in `byronbroughten/personal`. Its output is a verified fact list posted as a comment on the issue; it writes nothing to the Deliverable and has no branch.

Fetch the issue with `npm run issue:read -- personal <n> --body` and state its title before starting. If the reference is ambiguous, ask. If the issue is a Piece rather than Research, stop and point the developer to `/implement-piece`.

**Work at the primary root or in a session workspace.** Research edits no files in a repo, so no issue workspace is needed. Scratch files go in the scratchpad.

## Steps

1. **Read the sources the spec lists.** **Every source is a Drive file**, one source per ID; `/grill-piece` saved each web page to Drive, and this skill never reads one live. Each source's text goes in `<scratchpad>/texts`, under a short file name such as `heagney.txt`, the name its locators will cite. For a short text, read it with `get_drive_file_content` and save what it returns there. For a PDF, download it with `get_drive_file_download_url`, then dump its text once per [`docs/pdf-pages.md`](../../../docs/pdf-pages.md): `npm run pdf:text -- "<path>" "<scratchpad>/texts/<name>.txt"`. Its page markers are what locators cite.
2. **Give each source to one sub-agent**, a `general-purpose` agent on `sonnet`. Each reads only its own text file and the passages the spec lists, and returns facts in its own words, each ending with its locator: `(<name>.txt, PDF pp. 45–46 (printed 31–32))`, or `(<name>.txt, PDF p. 45)` for one page, with the printed pages only when they differ; for a source with no page markers, `(<name>.txt, heading "<the heading it sits under>")`. A quote is optional, added when the wording matters or to anchor the spot. Each quoted passage is copied word for word from the text, punctuation included, never paraphrased. A quote is one contiguous passage: never join two passages with `...`, and quote each one separately. A term or title that isn't a quote goes in italics, never double quotes. Each agent gets the text file's full path, its file name for the locator and the list of passages to read.
3. **Assemble the fact list** in the scratchpad as `comment.md`: one numbered fact per line, each in the researcher's words and ending with its locator in the shape above, each quoted passage in double quotes.
4. **Verify the quotes.** `verify:quotes` checks that every fact has a locator and every double-quoted span is found within its cited range; it doesn't judge whether a fact is right, and it isn't the plagiarism check. Run `npm run verify:quotes -- --comment "<scratchpad>/comment.md" --texts "<scratchpad>/texts"`. Fix every `NOT FOUND` by copying the passage exactly from the text, or remove the quote. Fix every `OUTSIDE LOCATOR` by correcting the locator to where the quote is, when the fact comes from there. Fix every `NO LOCATOR` by adding the fact's locator. Fix every `JOINED` by splitting it into one quote per passage. Rerun until it exits 0. Punctuation and wording must match exactly; letter case and line breaks may differ.
5. **Post the comment** with `gh issue comment -R byronbroughten/personal <n> --body-file "<scratchpad>/comment.md"`.
6. **Delete the downloads**: `rm` each path that `get_drive_file_download_url` returned, once the comment is posted.

## Done when

Every fact in the posted comment has a source and a page range, or a heading for a source with no pages, `verify:quotes` exits 0 on the posted file, and the downloads are deleted.

## Wrap-up

Research wraps up per [`packages/personal/writing/docs/wrap-up.md`](../../../packages/personal/writing/docs/wrap-up.md): the developer is given the prompt there, and nothing is committed, pushed or closed here.
