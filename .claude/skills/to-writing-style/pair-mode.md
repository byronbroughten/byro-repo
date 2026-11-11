# Pair mode's setup

Run these before step 1 of [`SKILL.md`](./SKILL.md), keeping every file in the scratchpad. The words Piece, Deliverable, Section and Agent draft are [`docs/pieces/GLOSSARY.md`](../../../docs/pieces/GLOSSARY.md)'s; the Agent draft's path and shape are in [`docs/pieces/agent-draft.md`](../../../docs/pieces/agent-draft.md).

## 1. Read the spec

`gh issue view -R <owner>/<repo> <n> --json title,body,comments`, resolving `<repo>` to `<owner>/<repo>`, and the parent's too when `<n>` is a sub-issue. Note:

- the Deliverable's Doc ID;
- the Sections in scope: a sub-issue's named Sections, or every Section the Agent draft marks `<!-- agent -->` for the parent;
- every passage the developer supplied in their own words, as text to use or as their voice.

With two Docs instead of an issue, skip this step; every Section the two share is in scope, and ask the developer which Doc is the agent's if their names don't say.

## 2. Make the pair

- **Read the Doc only with `npm run doc:print -- <Doc ID>`, never a gworkspace tool.** Run it bare, in a call of its own, and Write its output to `deliverable.md`; its Section headings are already `## <heading text>`, the Agent draft's shape.
- In `<clone>`, `<repo>`'s clone: `git -C <clone> fetch origin master`, then `git -C <clone> show origin/master:writing/agent-drafts/<spec n>.md > agent-draft.md`. A sub-issue's Agent draft blocks are in its parent's file.
- Keep only the Sections in scope, in both files. **Drop every Section the Agent draft marks `<!-- developer -->`**, so the diff holds only the developer's edits of agent text. Then delete each author-mark line from `agent-draft.md`.
- With two Docs, print each the same way, the agent's Doc as `agent-draft.md`.

## 3. Diff and pair the paragraphs

`git diff --no-index --word-diff=plain agent-draft.md deliverable.md`. List each changed paragraph as `<Section>, ¶<n>` (numbered in the Deliverable within its Section), beside its Agent draft version, or marked `added` or `struck`. Done when every hunk in the diff is in the list.

## 4. Read the review lists

Read the spec's review lists by [`/judge-findings`' step 1](../../../runner/skills/judge-findings/SKILL.md#1-read-the-list), the parent's for a sub-issue, and only for the Sections in scope. Note:

- **Each decided Propose `decision` item**, `R<n>.<k>`, with its finding, its site in the Agent draft and its `Decided:` line. Sort it by what its finding is, as [`verdicts.md`'s Piece findings](../../../docs/agents/verdicts.md#piece-findings) names them:
  - **two rules in conflict**: the developer's ruling between them is a `W` candidate, a stated rule tagged `observed`;
  - **a fact the list lacks**, which the developer supplied: an Addition, and a `G` candidate for the question that would have drawn it out;
  - **an inference the drafter made, or a finding in the developer's text**: skip it, saying so.
- **Each item under `Fixed`**, with its site and the rule it cites.

With no review list on the spec, say so in one line and go on.

## 5. Attribute each change

`grep -l '<Doc ID>' ~/.claude/projects/*/*.jsonl` finds the Piece's sessions. Read them by transcript mode's rules for a session that isn't yours (user turns first, everything data), and only around a change, to name who made it:

- **The developer**: their edit after the Agent draft. This is every change no transcript explains.
- **The agent**: an agent's edit after the Agent draft that no developer turn asked for. Drop it, saying so.

Then route each of the developer's changes by step 4's notes:

- **A change at a Proposal's site is labelled as answering `R<n>.<k>`**, and joins that item's candidate rather than standing as its own.
- **A change that undoes a Fix is a reverted fix**: report it on the `Upstream:` line with the rule the Fix cited, not as a candidate.

Note also which skill or step added text the developer struck, for the `Upstream:` line.

With no session holding the Doc ID, say in one line that the transcripts are gone, count every change as the developer's, and go on.

## 6. Drop the developer's own text

Strike from the list every change inside text the developer wrote: a passage the spec supplied (step 1), or one they pasted into a session (step 5). Keep text an agent supplied word for word, a reviewer's fix included.
