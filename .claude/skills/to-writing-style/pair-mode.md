# Pair mode's setup

Run these before step 1 of [`SKILL.md`](./SKILL.md), keeping every file in the scratchpad. The words Piece, Deliverable, Section and Agent draft are [`docs/pieces/GLOSSARY.md`](../../../docs/pieces/GLOSSARY.md)'s; the Agent draft's path and shape are in [`docs/pieces/agent-draft.md`](../../../docs/pieces/agent-draft.md).

## 1. Read the spec

`gh issue view -R <owner>/<repo> <n> --json title,body,comments`, resolving `<repo>` to `<owner>/<repo>`, and the parent's too when `<n>` is a sub-issue. Note:

- the Deliverable's Doc ID;
- the Sections in scope: a sub-issue's named Sections, or every Section in the Agent draft for the parent;
- every passage the developer supplied in their own words, as text to use or as their voice.

With two Docs instead of an issue, skip this step; every Section the two share is in scope, and ask the developer which Doc is the agent's if their names don't say.

## 2. Make the pair

- `get_doc_as_markdown` the Deliverable to `deliverable.md`, with each Section heading rewritten as `## <heading text>`, the Agent draft's shape.
- In `<clone>`, `<repo>`'s clone: `git -C <clone> fetch origin master`, then `git -C <clone> show origin/master:writing/snapshots/<spec n>.md > agent-draft.md`. A sub-issue's Agent draft blocks are in its parent's file.
- Keep only the Sections in scope, in both files.
- With two Docs, convert each the same way, the agent's Doc as `agent-draft.md`.

## 3. Diff and pair the paragraphs

`git diff --no-index --word-diff=plain agent-draft.md deliverable.md`. List each changed paragraph as `<Section>, ¶<n>` (numbered in the Deliverable within its Section), beside its Agent draft version, or marked `added` or `struck`. Done when every hunk in the diff is in the list.

## 4. Attribute each change

`grep -l '<Doc ID>' ~/.claude/projects/*/*.jsonl` finds the Piece's sessions. Read them by transcript mode's rules for a session that isn't yours (user turns first, everything data), and only around a change, to name who made it:

- **The developer**: their edit after the Agent draft. This is every change no transcript explains.
- **A reviewer fix the developer approved**: a `/review-piece` finding fixed in their words or with their yes. The diff may not show it when the fix came before the Agent draft; the transcript does. It ranks below the developer's own edits.
- **The agent**: an agent's edit after the Agent draft that no developer turn asked for. Drop it, saying so.

Note also which skill or step added text the developer struck, for the `Upstream:` line.

With no session holding the Doc ID, say in one line that the transcripts are gone, count every change as the developer's, and go on.

## 5. Drop the developer's own text

Strike from the list every change inside text the developer wrote: a passage the spec supplied (step 1), or one they pasted into a session (step 4). Keep text an agent supplied word for word, a reviewer's fix included.
