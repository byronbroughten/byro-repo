# Google Docs behaviour

An [observation index](./agents/prose-files.md#terms) of how Google Docs behaves (the Docs REST API, Drive's comments on a Doc, the auth that reaches them, and the gworkspace MCP's Docs tools), never the runner's or the gates' own behaviour. It is grouped by subject and follows the [observation-index rules](./prose-style.md#observation-indexes). Sheets and Apps Script observations are in [`sheets-behaviour.md`](../packages/framework/docs/sheets-behaviour.md).

Whoever settles or overturns an observation adds or updates its line in the same change as the finding. A new one is probed with `scripts/runner/docsProbe.ts` on the Docs module scratch Doc.

Write-ups sourced from Google's docs live on `research/*` branches; the Doc and Markdown routes are on `research/doc-markdown-routes`.

## Auth

- Observed: A clasp login with `--creds` naming the framework's own OAuth client file, `--use-project-scopes` and `--extra-scopes https://www.googleapis.com/auth/documents,https://www.googleapis.com/auth/drive.readonly`, from `packages/framework` into `~/.clasprc-docs.json`, authorized both manifest scopes plus both extra scopes, and `npm run doc:print` then read a Doc the account owns; byronbroughten@gmail.com; 2026-11-11; [closing comment on #653](https://github.com/byronbroughten/byro-repo/issues/653#issuecomment-6795781105).
- Observed: A clasp login without `--creds`, with `--use-project-scopes` from `packages/real-estate`, was refused in the browser with `This app tried to access some sensitive info in your Google Account. To keep your account safe, Google blocked this access.`, both with `--extra-scopes` of `documents` and `drive.readonly` and with `documents` alone; byronbroughten@gmail.com; 2026-11-11; [closing comment on #653](https://github.com/byronbroughten/byro-repo/issues/653#issuecomment-6795781105).
- Observed: A clasp login with `--use-project-scopes --extra-scopes https://www.googleapis.com/auth/documents,https://www.googleapis.com/auth/drive.readonly` gave a token carrying the manifest's `spreadsheets` and `script.scriptapp` scopes plus both extra scopes, with `appsscript.json` unedited, and with it `documents.get` and a no-op `batchUpdate` succeeded; byronbroughten@gmail.com, the scratch Doc's owner, from the developer's shell; 2026-11-07; [resolution on #584](https://github.com/byronbroughten/byro-repo/issues/584#issuecomment-6727999386).
- Observed: The agent account's token minted by `npm run google:script` carried `documents` and `drive` among its scopes, and with it `documents.get` and a no-op `batchUpdate` succeeded on a Doc shared with that account as a writer; byronbroughtenai@gmail.com; 2026-11-08; [resolution on #584](https://github.com/byronbroughten/byro-repo/issues/584#issuecomment-6727999386).

## Reading comments

- Observed: `documents.get` with `commentsViewMode=COMMENTS_VIEW_MODE_INCLUDED` returned 200 only with `suggestionsViewMode=SUGGESTIONS_INLINE`; unset and `DEFAULT_FOR_CURRENT_ACCESS` returned 400 `Comments may only be explicitly included if inline suggestions are also explicitly requested.`, and `PREVIEW_SUGGESTIONS_ACCEPTED` and `PREVIEW_WITHOUT_SUGGESTIONS` returned 400 `Comments may not be requested when previewing suggestions.`; scratch Doc; 2026-11-07, rerun 2026-11-08; [resolution on #584](https://github.com/byronbroughten/byro-repo/issues/584#issuecomment-6727999386).
- Observed: With comments included, `documents.get` returned a top-level `comments[]` of threads, each with `commentId`, `anchorId`, `headPost` (`content`, `author`, `createTime`), `status` and `plainTextQuote`, and each tab's `documentTab.commentAnchors` mapped an `anchorId` to `{anchorId, ranges: [{startIndex, endIndex}]}`; scratch Doc; 2026-11-08; [resolution on #584](https://github.com/byronbroughten/byro-repo/issues/584#issuecomment-6727999386).
- Observed: After an edit removed a comment's anchor from `commentAnchors`, Drive `comments.list` still returned that comment with its `anchor` field set; scratch Doc; 2026-11-08; [resolution on #584](https://github.com/byronbroughten/byro-repo/issues/584#issuecomment-6727999386).

## Making comments

- Observed: A `batchUpdate` of three `insertComment` requests (`content` and a `range`) on a whole paragraph, a phrase and a span across two paragraphs returned each new thread, authored by the calling account; `documents.get` listed all three in `commentAnchors` at the requested ranges, and Drive `comments.list` listed them with their quoted text; scratch Doc; 2026-11-08; [resolution on #584](https://github.com/byronbroughten/byro-repo/issues/584#issuecomment-6727999386).

## What edits do to comment anchors

- Observed: A `deleteContentRange` and `insertText` of one word inside a paragraph, outside a phrase comment's range, left all three comments in `commentAnchors`, the span comment's range moved by the length change; scratch Doc; 2026-11-08; [resolution on #584](https://github.com/byronbroughten/byro-repo/issues/584#issuecomment-6727999386).
- Observed: A `deleteContentRange` of a Section's whole body followed by an `insertText` of identical text at the same index removed all three comments' anchors from `commentAnchors`, while each thread stayed in `comments[]` with `status` `OPEN`, its `anchorId` and its `plainTextQuote`; scratch Doc; 2026-11-08; [resolution on #584](https://github.com/byronbroughten/byro-repo/issues/584#issuecomment-6727999386).
- Observed: A `deleteContentRange` and identical `insertText` of only the second of two paragraphs a comment spanned shrank that comment's range to its part in the first paragraph, its `plainTextQuote` still quoting both; comments on the paragraphs before it kept their ranges; scratch Doc; 2026-11-08; [resolution on #584](https://github.com/byronbroughten/byro-repo/issues/584#issuecomment-6727999386).

## Replacing a Section

- Observed: A `deleteContentRange` of one H2 Section's body (an H3 inside it, another H2 after it) and an `insertText` of new text left the body before the range, the body after it once indices shifted by the length change, the title, `footnotes`, `documentStyle`, `namedStyles`, `lists` and `inlineObjects` byte-identical in `documents.get`; a one-tab scratch Doc; 2026-11-08; [resolution on #584](https://github.com/byronbroughten/byro-repo/issues/584#issuecomment-6727999386).
- Observed: The H3 rewritten in that replace came back with a new `headingId` (`h.wrlz947x13mi` to `h.q3kqnlqum542`); scratch Doc; 2026-11-08; [resolution on #584](https://github.com/byronbroughten/byro-repo/issues/584#issuecomment-6727999386).

## Style of inserted paragraphs

- Observed: An `insertText` of `\n<text>` at the end of a `HEADING_2` made the new paragraph a `HEADING_2`; with an `updateParagraphStyle` setting `namedStyleType: NORMAL_TEXT` in the same batch, it was `NORMAL_TEXT` and the heading stayed `HEADING_2`; scratch Doc; 2026-11-08; [resolution on #584](https://github.com/byronbroughten/byro-repo/issues/584#issuecomment-6727999386).
- Observed: An `insertText` of `"\nX"` at `endOfSegmentLocation` with a `HEADING_2` last in the body left the heading's `headingId` on the heading's text and gave the new `HEADING_2` paragraph a new `headingId`; so did an `insertText` of `"\n<text>"` just before a heading's newline and of `"<text>\n"` at a heading's start, each new paragraph taking the new ID; byronbroughtenai@gmail.com; 2026-11-11; [handoff on #717](https://github.com/byronbroughten/byro-repo/issues/717#issuecomment-6799331474).
- Observed: An `insertText` of `\n<text>` at the end of a bulleted item made the new paragraph a bulleted item at the same level; with `deleteParagraphBullets` and an `updateParagraphStyle` of `NORMAL_TEXT` and zero indent in the same batch, it was a plain paragraph and the next item kept its bullet; scratch Doc; 2026-11-08; [resolution on #584](https://github.com/byronbroughten/byro-repo/issues/584#issuecomment-6727999386).

## Document structure

- Observed: `documents.get` returned a table cell's two paragraphs as two `paragraph` elements in the cell's `content`, a footnote as a `footnoteReference` with its text under the tab's `footnotes`, an internal heading link as a `link.heading` with the heading's `id` and `tabId`, and indices that count an emoji as two UTF-16 code units; scratch Doc; 2026-11-08; [resolution on #584](https://github.com/byronbroughten/byro-repo/issues/584#issuecomment-6727999386).
- Observed: After `createParagraphBullets` with `NUMBERED_DECIMAL_ALPHA_ROMAN` and with `BULLET_DISC_CIRCLE_SQUARE` over tab-indented paragraphs, `documents.get` returned each item's `bullet` with its `listId`, no `nestingLevel` on first-level items and `nestingLevel` 1 and 2 below them; the numbered list's levels had `glyphType` `DECIMAL`, `ALPHA` and `ROMAN`, and the bulleted list's had `glyphSymbol` `●`, `○` and `■` with no `glyphType`; byronbroughtenai@gmail.com; 2026-11-11; [probe results on #717](https://github.com/byronbroughten/byro-repo/issues/717#issuecomment-6800689141).

## Pending suggestions in a read

- Observed: With `suggestionsViewMode=SUGGESTIONS_INLINE`, `documents.get` returned suggested text as text runs with `suggestedInsertionIds`, text suggested for deletion as runs with `suggestedDeletionIds`, a suggested paragraph split as a `\n` run with `suggestedInsertionIds` ending the first paragraph, and a suggested footnote with `suggestedInsertionIds` on its `footnoteReference` and on its entry's text run under `footnotes`; byronbroughtenai@gmail.com reading byronbroughten@gmail.com's suggestions; 2026-11-11; [probe results on #717](https://github.com/byronbroughten/byro-repo/issues/717#issuecomment-6800689141).
- Observed: A paragraph and a table suggested by typing at a paragraph's end came back as that paragraph ending in a `\n` run with `suggestedInsertionIds`, the new paragraphs' runs wholly suggested, `suggestedInsertionIds` on the table, its row, its cell and its text run, and a `\n` paragraph with none after the table; byronbroughtenai@gmail.com reading byronbroughten@gmail.com's suggestions; 2026-11-11; [probe results on #717](https://github.com/byronbroughten/byro-repo/issues/717#issuecomment-6800689141).

## Indices under pending suggestions

- Observed: One `batchUpdate` of `insertText` requests at indices from a `SUGGESTIONS_INLINE` read, each after a suggested insertion, deletion, paragraph split or footnote, put each text right before the text it was aimed at in the next such read, with no `suggestedInsertionIds`; a `deleteContentRange` of each brought the read back to its indices and text before; byronbroughtenai@gmail.com; 2026-11-11; [probe results on #717](https://github.com/byronbroughten/byro-repo/issues/717#issuecomment-6800689141).

## Revision guard

- Observed: A `batchUpdate` whose `writeControl.requiredRevisionId` was read before another client's write returned 400 `INVALID_ARGUMENT` `The required revision ID '…' does not match the latest revision.`, and the same request with the fresh `revisionId` returned 200; scratch Doc; 2026-11-08; [resolution on #584](https://github.com/byronbroughten/byro-repo/issues/584#issuecomment-6727999386).

## The gworkspace MCP's Docs tools

- Observed: In a headless runner step with the Doc among the ticket's targets, `get_doc_as_markdown`, `modify_doc_text`, `find_and_replace_doc` and `batch_update_doc` each succeeded on a Doc created by byronbroughtenai@gmail.com, and a second `get_doc_as_markdown` showed all three writes; 2026-11-06; [resolution on #575](https://github.com/byronbroughten/byro-repo/issues/575#issuecomment-6693639661).
