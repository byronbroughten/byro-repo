# Moving a Piece between Markdown and its Doc without claude (#583)

Researched 2026-11-06 for byronbroughten/byro-repo#583. The sources are primary only: Google's developer docs, the workspace-mcp source at pinned tags, and the MCP spec and TypeScript SDK source. Citations to workspace-mcp `v1.28.0` point at tag commit `8475cec`. I diffed the PyPI wheel `workspace_mcp-1.28.0-py3-none-any.whl` (sha256 `2b28682…02c1`) against that tag: every `gdocs/*.py` file is identical. "Inferred" marks a conclusion I drew from reading code but did not run. "Unverified" marks a claim no source I read confirms.

## Short answer

- **Pull is easy on every route; push in place is the hard part.** Only the Docs REST API (Route 2) can replace one Section while leaving the rest of the Doc alone and keeping comments where they are. It can do that because it allows edits at the level of single paragraphs.
- **workspace-mcp 1.28.0 cannot replace a Section from Markdown.** Its only Markdown writer replaces a whole tab (`manage_doc_tab` with `populate_from_markdown`). A "replace the body under this heading as Markdown" mode first appeared in v2.2.0. Even that mode deletes and rewrites the whole body, and refuses when the Section contains footnotes.
- **Drive's Markdown import replaces the whole document.** Drive does export `text/markdown` and import Markdown, but Google's guide says an update with conversion means "the full contents of the document are replaced". That rules it out for push.
- **`get_doc_as_markdown` uses its own converter.** It is not a Drive export: it converts `documents.get` JSON with its own Python code (`gdocs/docs_markdown.py`). So the pull can match it byte for byte by calling the same tool, or by porting that pure function to TypeScript and running it on the same JSON.

**Recommendation: Route 2, a Node "Docs host" calling the Docs REST API, for push and eventually for pull.**
- **Push:**
  1. `documents.get`, with comment anchors included.
  2. Find the Section by its heading.
  3. Diff the Section's paragraphs against the Markdown.
  4. Send one `batchUpdate` that touches only the changed paragraphs, guarded by `requiredRevisionId`.
- **Pull:** a TypeScript port of workspace-mcp 1.28.0's `convert_doc_to_markdown`, golden-tested against `get_doc_as_markdown` output.
- **Fallback (Route 1):** until the port byte-matches, the pull calls `get_doc_as_markdown` (with `comment_mode: "none"`) over an MCP stdio client. If the Route 2 writer stalls, push could use `modify_doc_text` heading mode after bumping the pin to ≥ 2.2.0. That accepts losing comments anchored in the rewritten Section and having no footnote support.
- **Route 3 (Drive):** suitable only for creating a Doc from Markdown the first time, or as a cross-check.

A finding that affects the repo whichever route is chosen: `/to-writing-style` (`.claude/skills/to-writing-style/pair-mode.md:17`) and `/implement-piece` (`.claude/skills/implement-piece/SKILL.md:26`) call `get_doc_as_markdown` without `comment_mode`. The default is `include_comments=True, comment_mode="inline"` (`gdocs/docs_tools.py:2609-2610`). Their reads therefore carry `[^cN]` comment markers and footnote lines, and unmatched comments land in a `## Comments` appendix. A comment-free pull would differ on exactly those lines. Either the diff read passes `comment_mode: "none"`, or the diff strips those lines.

## Route 1: workspace-mcp as an MCP client

### How `get_doc_as_markdown` builds its Markdown (v1.28.0)

**The steps:**
- The tool needs a Drive read scope and a Docs read scope (`gdocs/docs_tools.py:2584-2603`, [permalink](https://github.com/taylorwilsdon/google_workspace_mcp/blob/8475cecf936d76282c580614eb7d6823f5b4e851/gdocs/docs_tools.py#L2584-L2733)).
- It calls the Docs API, not a Drive export: `docs_service.documents().get(documentId=…, includeTabsContent=True, suggestionsViewMode=…)` (`docs_tools.py:2663-2676`).
- It converts the result with `markdown = convert_doc_to_markdown(doc)` (`docs_tools.py:2693`).
- Comments come from a separate call, Drive `comments.list` (`docs_tools.py:2698-2719`). They are merged in by *text matching*: `if anchor and anchor in markdown: markdown = markdown.replace(anchor, anchor + ref, 1)` (`gdocs/docs_markdown.py:576-606`). They are not placed by anchor position.
- The converter, `gdocs/docs_markdown.py` (672 lines, [permalink](https://github.com/taylorwilsdon/google_workspace_mcp/blob/8475cecf936d76282c580614eb7d6823f5b4e851/gdocs/docs_markdown.py)), is a pure function of the `documents.get` JSON. That is what makes a faithful TypeScript port feasible.

**What it emits, from the code:**

| Element | Output (v1.28.0) | Lines |
| --- | --- | --- |
| Headings | `TITLE`→`#`, `SUBTITLE`→`##`, `HEADING_1..6`→`#`..`######`, then a blank line | 29-38, 159-168 |
| Empty paragraphs | Dropped entirely | 118-121 |
| Bullets | `"  " * nesting + "- "` | 150-152 |
| Ordered lists | `"   " * nesting + "N. "`. An item is ordered when the level's `glyphType` is not `""` or `GLYPH_TYPE_UNSPECIFIED`. Counters reset after a non-list paragraph. | 144-149, 154-156, 475-483 |
| Checklists | `- [ ]` / `- [x]`; "checked" means the first run is struck through | 128-143, 486-514 |
| Bold/italic/strike | `**`, `*`, `***`, `~~` per text run. Underline is not rendered. | 418-451 |
| Inline code | A run in Courier New, Consolas, Roboto Mono or Source Code Pro becomes a backtick span. There is no fenced-block output. | 27, 421-433 |
| Links | URL links become `[text](url)`. Links to a heading or bookmark become `text [heading: id]` / `text [bookmark: id]`. | 454-472 |
| Tables | A pipe table. Row 1 is the header. A cell's paragraphs are joined with spaces, and `\|` is escaped. | 517-573 |
| Footnotes | `[^<footnoteId>]` inline (for example `[^kix.abc123]`), with `[^id]: text` definitions at the end of the body | 334-364, 190-193 |
| Section breaks, page breaks, equations, chips | `[Section Break]`, `[Page Break]`, `[Equation]`; a person chip becomes a `mailto:` link; a date chip shows its display text | 184-188, 220-249 |
| Multiple tabs | One `# <tab title>` per tab. A single-tab Doc has no tab heading. | 63-77 |

- **Escaping (inferred):** `_convert_text_run` (`docs_markdown.py:253-267`) does no Markdown escaping. A literal `*`, `_`, `#` or `[` in the Doc comes through raw.
- **Paragraph text (inferred):** each paragraph's text is `.strip()`ed (`docs_markdown.py:250`).
- **Blockquotes:** indentation is never read, so a blockquote written into the Doc reads back as a plain paragraph.

### What its write tools can do for "replace this Section in place" (v1.28.0)

- **The Markdown writer replaces whole tabs only.** `gdocs/docs_markdown_writer.py` ([permalink](https://github.com/taylorwilsdon/google_workspace_mcp/blob/8475cecf936d76282c580614eb7d6823f5b4e851/gdocs/docs_markdown_writer.py)) is called from one place, `manage_doc_tab` with `action="populate_from_markdown"` (`docs_tools.py:2930-3008`). There it either deletes the whole tab body, `deleteContentRange` from index 1 to `tab_end - 1` (`docs_tools.py:2952-2968`), or appends to the end of the tab.
- **What the writer leaves out:** its docstring says GFM-only features are not enabled: "GFM-only features (tables, strikethrough, task lists, autolinks) are not enabled" (`docs_markdown_writer.py:7-11`). It parses with `MarkdownIt("commonmark")` (line 41), so footnotes are not parsed either.
- **Blank paragraphs:** after every heading, paragraph, list, code block and blockquote, the writer inserts a "Blank spacer paragraph between top-level blocks" (lines 73, 128, 154, 208, 231). The reader drops empty paragraphs, so Markdown→Doc→Markdown stays stable, but the Doc gains empty paragraphs.
- **Nested lists (inferred):** the writer emits one `createParagraphBullets` per list and no leading tabs (lines 79-131). Google documents that nesting depth comes from "counting leading tabs" ([CreateParagraphBulletsRequest](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/request)), so nested Markdown lists come out flat.
- **Other write tools work by index, not by Markdown.** `modify_doc_text` (line 520) takes `start_index`/`end_index` plus formatting flags. `batch_update_doc` (line 1140) offers typed operations: `insert_text`, `delete_text`, `replace_text`, `update_paragraph_style`, `create_bullet_list`, `insert_table`, `find_replace` and so on (docstring lines 1147-1300). Semantic anchors (`after_heading`, `before_heading`, `anchor_text`) are offered for insertions only (lines 1193-1203; `gdocs/docs_anchors.py:65-83`). No v1.28.0 tool deletes "the body under heading X".
- **Tool results are text.** The tools return strings; `inspect_doc_structure` returns a text summary (line 1470). A runner that wants indices would parse prose, or fall back to calling the API itself.

### Newer releases add a Section-replace mode

Checked by reading `gdocs/docs_tools.py` at each tag:
- v2.1.2 (2026-10-21) adds GFM pipe tables to the writer.
- v2.2.0 (2026-10-23, `b5cf07e`) adds `modify_doc_text(heading=…, text=…)`. The v2.3.0 docstring reads: "HEADING MODE: Pass heading instead of start_index to edit the body below a heading, up to the next heading of equal or shallower level. text is rendered as Markdown and replaces that body; end_of_segment=true appends instead." ([v2.3.0 `docs_tools.py:730-733`](https://github.com/taylorwilsdon/google_workspace_mcp/blob/395d881d246fc9ef3f8f8c299b08e7d9f1359b89/gdocs/docs_tools.py#L611-L685)).

How heading mode works in v2.3.0:
- `find_heading_section` finds exactly one matching body heading, matched case-insensitively. The Section runs to the next `TITLE` or equal-or-shallower heading ([`docs_structure.py:488-562`](https://github.com/taylorwilsdon/google_workspace_mcp/blob/395d881d246fc9ef3f8f8c299b08e7d9f1359b89/gdocs/docs_structure.py#L488-L562)).
- `build_section_markdown_requests` emits one `deleteContentRange` over the whole body, then the Markdown inserts ([`docs_markdown_writer.py:563-590`](https://github.com/taylorwilsdon/google_workspace_mcp/blob/395d881d246fc9ef3f8f8c299b08e7d9f1359b89/gdocs/docs_markdown_writer.py#L563-L590)).
- It refuses when footnotes are present: "contains … footnote reference(s); replacing it would detach them" (`docs_tools.py:663-668`).
- It sends `writeControl.requiredRevisionId` (`docs_tools.py:678-679`).
- Between 1.28.0 and 2.3.0 the reader `docs_markdown.py` changed only by opt-in additions (dropdown chips, and `include_colors` defaulting to off). That is from diffing the two files; I did not verify that output is byte-identical.

### Running it outside Claude Code

- **Launching:** the MCP spec says that in stdio "The client launches the MCP server as a subprocess. The server reads JSON-RPC messages from its standard input…" ([MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)). A tool call is a JSON-RPC `tools/call` whose result carries `content: [{type:"text", text:…}]` ([MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)).
- **Environment:** the TypeScript SDK's `StdioClientTransport` passes only `HOME, LOGNAME, PATH, SHELL, TERM, USER`, plus whatever `env` the caller gives ([`src/client/stdio.ts:53-73, 129-139`](https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/client/stdio.ts#L53-L139)). So the runner must forward the env block from the `~/.claude.json` entry it already loads (`scripts/runner/runnerConfig.ts:155-163`): `GOOGLE_CLIENT_SECRET_PATH`, `WORKSPACE_MCP_CREDENTIALS_DIR` and `USER_GOOGLE_EMAIL`, set at `scripts/setup-agent-account-mcp.sh:320-323`. Otherwise the server falls back to `~/.google_workspace_mcp/credentials` (`main.py:378-387`) and finds no token.
- **Credentials:** `--single-user` means "use any credentials from the credentials directory" (`main.py:456-458`). Stored credentials are JSON files holding `refresh_token`, `client_id`, `client_secret` and `scopes` (`auth/credential_store.py:219-236`), and the server refreshes them itself (`auth/google_auth.py:988-997`). Nothing else Claude-specific is needed.
- **Callback port (unverified):** in stdio mode the server also resolves a local OAuth callback port (`main.py:131-152`). Whether two instances at once (a Claude session and the runner) collide on that port is unverified; its resolver has a "fallback range" (docstring, `main.py:136-137`).
- **Which account (repo fact):** the server acts as the *agent* account, `byronbroughtenai@gmail.com` (the gworkspace server's instructions in this session). The Doc must be shared with that account as an editor, and edits are attributed to it.
- **Google's own MCP servers are a different thing.** Google now offers a Docs MCP server in Developer Preview. From 2026-11-11 it requires OAuth clients marked "Use this client for an AI-powered agent". Google adds: "Apps and integrations that are not AI agents, like those that only call Google Workspace REST APIs, are not affected" ([Docs release notes, 2026-10-12](https://developers.google.com/workspace/docs/release-notes)). That server's `read_doc` returns JSON, not Markdown ([read_doc](https://developers.google.com/workspace/docs/api/reference/mcp/tools_list/read_doc)), so it offers the runner nothing beyond REST. workspace-mcp calls the REST APIs itself, so the announcement does not obviously apply to it (inferred).

### Judgement

**Strengths:**
- The pull matches exactly, by construction.
- There is no new auth: the agent account's existing token already has the Docs scopes (`auth/scopes.py:29-30, 145-147`).
- Setup is cheap: one `@modelcontextprotocol/sdk` dependency plus a spawn of `uvx`.

**Weaknesses:**
- At 1.28.0 there is no Section push.
- At ≥ 2.2.0, heading mode rewrites the whole body under the heading. Comments anchored there are at risk (see Route 2), and there are no footnotes.
- Writer fidelity is lower than reader fidelity: no strikethrough, nested lists flattened, blank spacer paragraphs.
- Every call is a Python subprocess, and results come back as prose strings.
- **Fit for the real-estate app is poor.** That app runs in Apps Script and in the Node host. An MCP subprocess and an agent-account identity don't carry over.

## Route 2: the Docs REST API from Node

### Scopes and auth

- **Scopes:** `documents.get` accepts `documents`, `documents.readonly`, `drive`, `drive.readonly` or `drive.file` ([Docs scopes](https://developers.google.com/workspace/docs/api/auth)). `batchUpdate` takes `documents`, `drive` or `drive.file` ([batchUpdate](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/batchUpdate)). `documents` is listed as "Sensitive"; `drive.file` is "Recommended Non-sensitive" but covers only "the specific Google Drive files you use with this app" ([Docs scopes](https://developers.google.com/workspace/docs/api/auth)). Whether a Doc the developer created and shared with the app counts for `drive.file` is unverified, so `documents` is the safe choice.
- **The current clasp token has no Docs scope (repo fact).** The framework refreshes `desktop-clasp-run` from `~/.clasprc.json` (`packages/framework/scripts/nodeHost.ts:16-19, 79-131`). That credential is minted with `clasp login --use-project-scopes` (`packages/framework/scripts/setup-clasp-run-auth.sh:424, 436`). Both manifests request only `spreadsheets` and `script.scriptapp` (`packages/framework/appsscript.json:12-15`; `packages/real-estate/appsscript.json:22-25`).

Getting a Docs token therefore takes one of these:

| Option | What it takes | Trade-off |
| --- | --- | --- |
| (a) Add the scope to the manifest | Add `https://www.googleapis.com/auth/documents` to the manifest and re-run setup-auth | Simple, and the real-estate app will need the scope anyway once it touches Docs. It also widens the Apps Script project's grant. |
| (b) Mint a separate Docs credential | Same refresh-token pattern as clasp's | More setup |
| (c) Read the agent account's token | Read the workspace-mcp credentials file (fields above) | Same identity as `get_doc_as_markdown`, but couples the runner to another tool's private file format. The runner is unsandboxed, so it can read the file. |

### Locating a Section from its headings

- **Indices:** `documents.get` returns `body.content[]` elements with `startIndex`/`endIndex`, and "Indexes are measured in UTF-16 code units. This means surrogate pairs consume two indexes" ([structure](https://developers.google.com/workspace/docs/api/concepts/structure)). JavaScript string `.length` is also UTF-16, so the arithmetic carries over directly.
- **Headings:** a heading is a paragraph whose `paragraphStyle.namedStyleType` is `HEADING_n` (or `TITLE`). The Section runs to the next heading of equal or shallower level. That is the same rule workspace-mcp v2.2+ uses (`docs_structure.py:488-562`), so it can be reused as the definition.
- **Named ranges are an alternative.** One per Section, so a renamed heading doesn't break lookup. Google: "The indexes of the named range are automatically updated as content is added to and removed from the document", but "Named ranges are not private. Anyone using the Docs API to access the document can see the named range definition" ([named ranges](https://developers.google.com/workspace/docs/api/how-tos/named-ranges)). `ReplaceNamedRangeContentRequest` replaces with plain `text` only ([request reference](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/request)), so styles must be reapplied afterwards. A heading match is simpler, and the Snapshot already keys Sections by heading text.

### Replacing a range with `batchUpdate`

**Atomic:** "All subrequests in the batch update are applied atomically. That is, if any request is not valid then the entire update is unsuccessful" ([batch](https://developers.google.com/workspace/docs/api/how-tos/batch)).

**Concurrency:** with `writeControl.requiredRevisionId`, "If this is not the latest revision of the document, the request is not processed and returns a 400 bad request error" ([batchUpdate](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/batchUpdate)). That guards against the developer editing between the push's `get` and its write.

**Building the new content:**
- `deleteContentRange`: "Deleting text that crosses a paragraph boundary may result in changes to paragraph styles, lists, positioned objects and bookmarks as the two paragraphs are merged". It cannot delete "the last newline character of a Body…" or "the newline character before a Table … without deleting the entire element" ([request reference](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/request)).
- `insertText`: "The paragraph style of the new paragraph will be copied from the paragraph at the current insertion index, including lists and bullets". Every inserted paragraph therefore needs an explicit `updateParagraphStyle` `namedStyleType` (`NORMAL_TEXT` or `HEADING_n`), plus `deleteParagraphBullets` where needed, or it inherits a heading or list style (same source).
- Inline styles use `updateTextStyle` (bold, italic, strikethrough, `link.url`; same source).
- Lists use `createParagraphBullets`, with nesting from leading tabs (same source).
- Tables use `insertTable`, which inserts "a newline character … before the inserted table", and then text inserted into each cell by index (same source).
- Footnotes use `createFootnote`; "The new Footnote segment will contain a space followed by a newline character", so the note text is inserted with that footnote's `segmentId` (same source).
- Write backwards (descending index) or recompute indices between requests. Google's own named-range sample sorts the ranges "by startIndex, in descending order" ([named ranges](https://developers.google.com/workspace/docs/api/how-tos/named-ranges)).

### Comments anchored inside a replaced range

- **The Docs API now exposes comments (GA 2026-09-30).** "Reading comment threads and anchors by setting commentsViewMode in documents.get. Creating comment threads … using InsertCommentRequest…" ([Docs release notes](https://developers.google.com/workspace/docs/release-notes)).
  - Each tab gets `commentAnchors` (map of `anchorId` → `ranges[]`), and each `CommentThread` has `anchorId`, `headPost`, `replies`, `status` and `plainTextQuote` ([Document resource](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents)).
  - `InsertCommentRequest` takes `content` and a `range` ([request reference](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/request)).
  - So before writing, a push can list every comment anchored inside the Section.
- **The `commentsViewMode` docs contradict themselves.** One sentence says that with `COMMENTS_VIEW_MODE_INCLUDED` "you can only set suggestionsViewMode to PREVIEW_WITHOUT_SUGGESTIONS or PREVIEW_SUGGESTIONS_ACCEPTED". The enum's own text says "When set, suggestionsViewMode must also be set to SUGGESTIONS_INLINE" ([Document resource, CommentsViewMode](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents)). The probe has to settle which applies.
- **Drive-API comments don't anchor in the editor.** "Google Workspace editor apps (such as Docs, Sheets, and Slides) don't render comments created with the Drive API anchored to content; they treat these comments as unanchored comments" ([Drive comments](https://developers.google.com/workspace/drive/api/guides/manage-comments)). Re-creating a lost anchor therefore has to go through the Docs API's `insertComment`, not Drive. Even then the original author, replies and timestamps are not carried over: a new thread belongs to the caller (inferred from the request shape).
- **Unverified:** what happens to a comment whose anchored text is deleted by `deleteContentRange`. That includes whether it survives with a `plainTextQuote` but no range, or is removed, and whether text inserted at the same index re-attaches it. No page I read documents this. It is the probe's most important question.
- **The design consequence (inferred):** a push should diff paragraphs and rewrite only those that changed, leaving unchanged paragraphs, and the comments on them, untouched. Before writing it should report any comment whose anchor overlaps a paragraph it will rewrite.

### The Apps Script counterpart

- The Advanced Docs Service is the same API: "Like all advanced services in Apps Script, the advanced Docs service uses the same objects, methods, and parameters as the public API", and it "is an advanced service that you must enable before use" ([Advanced Docs Service](https://developers.google.com/apps-script/advanced/docs)).
- So a request-builder written once in TypeScript can emit the same `batchUpdate` JSON for the Node host (over `fetch`) and for Apps Script (`Docs.Documents.batchUpdate`). That fits the framework's existing split between a Node host and an Apps Script host (inferred from the repo's architecture). Neither `DocumentApp` nor `DriveApp` mentions Markdown (no hits on their reference pages).

### Judgement

**Strengths:**
- The only route that edits a Section in place and can keep comments.
- Full fidelity is available for headings, links, lists including nesting, tables and footnotes, provided we write it.
- The same JSON works on Node and on Apps Script.

**Costs:**
- Our own Markdown→requests writer and Doc→Markdown reader: the reader is a port of workspace-mcp's 672-line converter, the writer a subset sized to what Pieces use.
- One new scope grant.

**Markdown match:** exact only if the port is faithful, so the golden test is mandatory.

## Route 3: Drive's Markdown export and import

**Export:**
- Docs export lists "Markdown | text/markdown | .md" ([export formats](https://developers.google.com/workspace/drive/api/guides/ref-export-formats)).
- `files.export`: "Note that the exported content is limited to 10 MB" ([files.export](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/export)).
- How Google's exporter renders footnotes, tables, nested lists, internal links or escaping is not documented on these pages (unverified).
- It is a different converter from workspace-mcp's, so its output will not byte-match `get_doc_as_markdown`. For example, workspace-mcp writes footnotes as `[^kix.…]` ids (`docs_markdown.py:364`); whatever Google emits for footnotes is unlikely to use internal kix ids (inferred).

**Import:**
- Markdown is a listed source for Google Docs: "Microsoft Word, OpenDocument Text, HTML, RTF, plain text, Markdown → Google Docs". Convert by setting the target Workspace `mimeType` when creating the file ([manage uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads)).
- "Supported conversions are available dynamically" in `about.importFormats` (same page).

**Update:** "When you upload and convert media during an update request to a Docs, Sheets, or Slides file, the full contents of the document are replaced" (same page). What becomes of existing comments after a full replacement is unverified. Their anchors cannot survive a whole-body swap in any meaningful sense (inferred).

**Judgement:**
- Pull is cheap: one GET, using the Drive scope.
- Push in place is impossible.
- It doesn't match `get_doc_as_markdown`.
- Useful for one-time Doc creation from a draft, and as an independent cross-check of fidelity.

## Comparison

| | Route 1: workspace-mcp via MCP client | Route 2: Docs REST API from Node | Route 3: Drive export/import |
| --- | --- | --- | --- |
| Pull fidelity: headings, links, lists, tables, footnotes | All five read (see table above); internal links become `[heading: id]` notes; no escaping; multi-paragraph cells joined | Whatever our port does; target = identical to Route 1 | Unverified (exporter undocumented) |
| Push fidelity | 1.28.0: whole tab only, no tables, strike or footnotes, nested lists flat, spacer paragraphs. ≥2.2.0: Section body, GFM tables, still no footnotes or strike | Full API: headings, links, nested lists, tables, footnotes; we write it | Whole-doc replace; fidelity unverified |
| Update one Section in place | 1.28.0: no. ≥2.2.0: yes, by rewriting the whole body under a heading | Yes, down to single paragraphs; revision-guarded | No ("full contents … replaced") |
| Doc comments | Body rewrite deletes anchored text; outcome unverified | Can read anchors first and leave unchanged paragraphs untouched; lost anchors recreatable via `insertComment` (new thread) | Whole-body replace; outcome unverified |
| Auth and setup | None new: agent account's token, forward 3 env vars; Python subprocess per run | One new grant (documents scope) or reuse an existing token; plain `fetch` | Drive scope; plain `fetch` |
| Matches `get_doc_as_markdown` | Exactly (same code), if the diff read uses the same `comment_mode` | Only through a faithful port, golden-tested | No |
| Reuse by a shared Docs host / real-estate app | Poor: subprocess, agent identity, Node only | Good: same request JSON on Node and Apps Script Advanced Docs | Fine for creating whole Docs, poor for updates |

## Probe checklist

The probe is a throwaway Node script, run from the developer's shell against a scratch Doc that is a copy of a real Piece. It reads and writes the scratch Doc only.

1. **Match the converter.** Call `documents.get(includeTabsContent=true)`, save the JSON, then call `get_doc_as_markdown(comment_mode="none")` over an MCP stdio client using the forwarded env. Confirm the runner can launch `uvx workspace-mcp==1.28.0 --single-user --tools docs drive` with that env. Note whether a concurrent Claude session's instance collides on the callback port. Save both outputs as the golden pair for the TypeScript port.
2. **Check comment markers.** Call `get_doc_as_markdown` with defaults versus `comment_mode="none"` on a Doc with a comment. Confirm the `[^cN]` lines are the only difference.
3. **Settle the scope.** Find which scopes the chosen token has: tokeninfo, or try a `documents.get` and a no-op `batchUpdate`. Confirm whether `drive.file` suffices for a Doc the developer created, or `documents` is needed.
4. **Settle comment reads.** Call `documents.get` with `commentsViewMode=COMMENTS_VIEW_MODE_INCLUDED`, trying both `suggestionsViewMode` values the docs disagree on. Record which is accepted and what `commentAnchors` and `comments[]` look like.
5. **Find out what deletion does to comments (the key test).** Put comments on (a) a whole paragraph, (b) a phrase inside a paragraph and (c) a span crossing two paragraphs, all in one Section.
   - Test 1: `deleteContentRange` over the whole Section body, then `insertText` of identical text. Re-read comments through both the Docs API and Drive `comments.list` (`quotedFileContent`, anchors). Check whether they survive, re-anchor, become orphaned or vanish, and how the Docs UI shows them.
   - Test 2: a minimal edit that changes one word inside (b)'s paragraph but outside its anchor.
6. **Heading-located replace.** Replace one H2 Section that has an H3 inside it and is followed by another H2. Confirm the next Section, the Doc title and the other tabs are byte-identical before and after (diff the `documents.get` JSON outside the range).
7. **Style inheritance.** Insert after a heading and inside a list. Confirm explicit `namedStyleType` and `deleteParagraphBullets` stop inherited heading and list styles.
8. **Fidelity round trip.** Use a Section with a link, a bold-italic run, a 3-level mixed ordered/bulleted list, a 3×3 table with a multi-paragraph cell, two footnotes, an internal heading link, an emoji (UTF-16 index math), and literal `*` and `#`. Push it from Markdown, pull it back, and diff.
9. **Revision guard.** Run `get`, edit the Doc by hand, then `batchUpdate` with the stale `requiredRevisionId`. Expect a 400.
10. **Heading-mode comparison (if Route 1 push is considered).** Run `uvx workspace-mcp==2.3.0` `modify_doc_text(heading=…, text=…)` on the same Section. Record what it does to comments, footnotes and blank spacer paragraphs.
11. **Drive cross-check.** Export `text/markdown` and diff it against `get_doc_as_markdown`, to measure how far apart the two converters are. Optionally read `about.importFormats` and confirm `text/markdown` is listed.

## Sources

**Google: Docs API**
- Scopes: https://developers.google.com/workspace/docs/api/auth (last updated 2026-09-03)
- Request types (deleteContentRange, insertText, createParagraphBullets, insertTable, createFootnote, named ranges, insertComment): https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/request (2026-10-09)
- batchUpdate and WriteControl: https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/batchUpdate (2026-10-09)
- Document resource (CommentThread, CommentAnchor, CommentsViewMode): https://developers.google.com/workspace/docs/api/reference/rest/v1/documents (2026-10-09)
- Batch atomicity: https://developers.google.com/workspace/docs/api/how-tos/batch (2026-09-03)
- Document structure and UTF-16 indices: https://developers.google.com/workspace/docs/api/concepts/structure (2026-09-03)
- Named ranges: https://developers.google.com/workspace/docs/api/how-tos/named-ranges (2026-09-03)
- Comments and suggestions: https://developers.google.com/workspace/docs/api/how-tos/suggestions (2026-09-30)
- Edit rules: https://developers.google.com/workspace/docs/api/concepts/rules-behavior (2026-09-03)
- Release notes (comments GA, Docs MCP server, agentic clients): https://developers.google.com/workspace/docs/release-notes (2026-09-03 page stamp; entries through 2026-10-12)
- Google Docs MCP `read_doc`: https://developers.google.com/workspace/docs/api/reference/mcp/tools_list/read_doc

**Google: Drive API and Apps Script**
- Export formats: https://developers.google.com/workspace/drive/api/guides/ref-export-formats (2026-09-03)
- files.export: https://developers.google.com/workspace/drive/api/reference/rest/v3/files/export (2025-08-26)
- Uploads and imports: https://developers.google.com/workspace/drive/api/guides/manage-uploads (2026-09-03)
- Comments: https://developers.google.com/workspace/drive/api/guides/manage-comments (2026-09-10)
- Apps Script Advanced Docs Service: https://developers.google.com/apps-script/advanced/docs (2026-09-03)

**workspace-mcp (taylorwilsdon/google_workspace_mcp)**
- v1.28.0 (`8475cecf936d76282c580614eb7d6823f5b4e851`): `gdocs/docs_tools.py`, `gdocs/docs_markdown.py`, `gdocs/docs_markdown_writer.py`, `gdocs/docs_anchors.py`, `main.py`, `auth/credential_store.py`, `auth/google_auth.py`, `auth/scopes.py`. Base URL: https://github.com/taylorwilsdon/google_workspace_mcp/tree/8475cecf936d76282c580614eb7d6823f5b4e851
- PyPI 1.28.0 release files: https://pypi.org/project/workspace-mcp/1.28.0/
- v2.2.0 (`b5cf07e6078ae10a596710d77569e9430e01ebd4`) and v2.3.0 (`395d881d246fc9ef3f8f8c299b08e7d9f1359b89`): `gdocs/docs_tools.py`, `gdocs/docs_structure.py`, `gdocs/docs_markdown_writer.py`

**MCP**
- Spec, transports: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- Spec, tools: https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- TypeScript SDK stdio client: https://github.com/modelcontextprotocol/typescript-sdk/blob/3b73021a0a2272c0c04c3917bcdb03398b3ec63f/src/client/stdio.ts

**Repo files read (facts about this repo, not claims about Google)**
- `scripts/setup-agent-account-mcp.sh:189-193, 320-323`
- `scripts/runner/runnerConfig.ts:155-163`
- `packages/framework/scripts/nodeHost.ts:16-19, 79-131`
- `packages/framework/scripts/setup-clasp-run-auth.sh:424, 436`
- `packages/framework/appsscript.json:12-15`
- `packages/real-estate/appsscript.json:22-25`
- `.claude/skills/to-writing-style/pair-mode.md:17`
- `.claude/skills/implement-piece/SKILL.md:26`
- `runner/src/targetTools.ts:49`
