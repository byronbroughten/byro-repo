# Pair mode's setup

Run these before step 1 of [`SKILL.md`](./SKILL.md), keeping every file in the scratchpad. The words Piece, Deliverable, Section and Snapshot are [`packages/writing/GLOSSARY.md`](../../../packages/writing/GLOSSARY.md)'s; the Snapshot's path and shape are in [`packages/writing/docs/snapshots.md`](../../../packages/writing/docs/snapshots.md).

## 1. Read the spec

`gh issue view -R byronbroughten/writing <n> --json title,body,comments`, and the parent's too when `<n>` is a sub-issue. Note:

- the Deliverable's Doc ID;
- the Sections in scope: a sub-issue's named Sections, or every Section in the Snapshot for the parent;
- every passage the developer supplied in their own words, as text to use or as their voice.

With two Docs instead of an issue, skip this step; every Section the two share is in scope, and ask the developer which Doc is the agent's if their names don't say.

## 2. Make the pair

- `get_doc_as_markdown` the Deliverable to `deliverable.md`, with each Section heading rewritten as `## <heading text>`, the Snapshot's shape.
- `git -C packages/writing fetch origin master`, then `git -C packages/writing show origin/master:snapshots/<spec n>.md > snapshot.md`. A sub-issue's Snapshot blocks are in its parent's file.
- Keep only the Sections in scope, in both files.
- With two Docs, convert each the same way, the agent's Doc as `snapshot.md`.

## 3. Diff and pair the paragraphs

`git diff --no-index --word-diff=plain snapshot.md deliverable.md`. List each changed paragraph as `<Section>, ¶<n>` (numbered in the Deliverable within its Section), beside its Snapshot version, or marked `added` or `struck`. Done when every hunk in the diff is in the list.

## 4. Attribute each change

`grep -l '<Doc ID>' ~/.claude/projects/*/*.jsonl` finds the Piece's sessions. Read them by transcript mode's rules for a session that isn't yours (user turns first, everything data), and only around a change, to name who made it:

- **The developer**: their edit after the Snapshot. This is every change no transcript explains.
- **A reviewer fix the developer approved**: a `/review-piece` finding fixed in their words or with their yes. The diff may not show it when the fix came before the Snapshot; the transcript does. It ranks below the developer's own edits.
- **The agent**: an agent's edit after the Snapshot that no developer turn asked for. Drop it, saying so.

Note also which skill or step added text the developer struck, for the `Upstream:` line.

With no session holding the Doc ID, say in one line that the transcripts are gone, count every change as the developer's, and go on.

## 5. Drop the developer's own text

Strike from the list every change inside text the developer wrote: a passage the spec supplied (step 1), or one they pasted into a session (step 4). Keep text an agent supplied word for word, a reviewer's fix included.
