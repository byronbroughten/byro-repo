---
name: research-piece
description: "Research a writing Piece's Supporting Material: download its PDFs, have one sub-agent per source read its listed passages, verify every quote against the text, and post the fact list as a comment on the Research issue. Writes nothing to the Deliverable."
disable-model-invocation: true
---

Research the Research issue described in `byronbroughten/personal`. Its output is a verified fact list posted as a comment on the issue; it writes nothing to the Deliverable and has no branch.

Fetch the issue with `npm run issue:read -- personal <n> --body` and state its title before starting. If the reference is ambiguous, ask. If the issue is a Piece rather than Research, stop and point the developer to `/implement-piece`.

**Work at the primary root or in a session workspace.** Research edits no files in a repo, so no issue workspace is needed. Scratch files go in the scratchpad.

## Steps

1. **Read the sources the spec lists.** Each Drive file ID is one source. For a short text, read it with `get_drive_file_content`. For a PDF, download it with `get_drive_file_download_url`, then dump its text once per [`docs/pdf-pages.md`](../../../docs/pdf-pages.md): `npm run pdf:text -- "<path>" "<scratchpad>/<name>.txt"`. Its page markers are what quotes cite.
2. **Give each source to one sub-agent**, a `general-purpose` agent on `sonnet`. Each reads only its own text file and the passages the spec lists, and returns facts with their page numbers. Each quoted passage is copied word for word from the text, punctuation included, never paraphrased. A quote is one contiguous passage: never join two passages with `...`, and quote each one separately. Each agent gets the text file's full path and the list of passages to read.
3. **Assemble the fact list** in the scratchpad as `comment.md`: one numbered fact per line, each with a source and page, and each quoted passage in double quotes.
4. **Verify the quotes.** Run `npm run verify:quotes -- --comment "<scratchpad>/comment.md" --texts "<scratchpad>/texts"`, with the dumped text files in the `texts` folder. Fix every `NOT FOUND` by copying the passage from the text, or by dropping the quotation marks and writing the fact as a paraphrase with its page. Fix every `JOINED` by splitting it into one quote per passage. Rerun until it exits 0. Punctuation and wording must match exactly; letter case and line breaks may differ.
5. **Post the comment** with `gh issue comment -R byronbroughten/personal <n> --body-file "<scratchpad>/comment.md"`.
6. **Delete the downloads**: `rm` each path that `get_drive_file_download_url` returned, once the comment is posted.

## Done when

Every fact in the posted comment has a source and a page, `verify:quotes` exits 0 on the posted file, and the downloads are deleted.

## Wrap-up

Research wraps up per [`packages/personal/writing/docs/wrap-up.md`](../../../packages/personal/writing/docs/wrap-up.md): the developer is given the prompt there, and nothing is committed, pushed or closed here.
