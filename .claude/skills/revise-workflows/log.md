# Log mode

Log mode triages the open [Friction notes](../../../runner/GLOSSARY.md#language) in place of [`SKILL.md`](./SKILL.md)'s step 1; its causes go on to step 2. Both logs live in the primary root's gitignored `.runner/` folder, the primary root found as [`/note-friction`](../note-friction/SKILL.md) finds it:

- **The friction folder**, `.runner/friction/`: one `<id>.md` per note, with [`/note-friction`'s fields](../note-friction/SKILL.md). A note is **open** when its `status:` line is blank.
- **The outcome log**, `.runner/outcomes/<spec repo>-<spec n>/<repo>-<n>.md`: one row file per landed ticket.

**The last triage's date is the newest status change in the folder**: the newest date opening a non-blank `status:` line, never a file's modification time, which a restore moves. With none, no triage has run, and every note counts as since.

## 1. Report notes per ticket

For each spec whose `filed-by: judge-findings` notes are dated after the last triage, count its notes, by the `<repo>#<spec>` of their `source:`, and its tickets, the row files in its outcome folder. Report notes per ticket, grouped by spec, each spec with its ticket count. This is the measure of whether review is producing fewer findings over time.

## 2. List the notes already solved

Drop each open note whose problem a change since its date has fixed, checked against the docs and code as they are now (`git log --since <date>` over the files it names). List each with the commit, issue or doc that solved it; step 5 of `SKILL.md` marks it `addressed <link>`.

## 3. Read

- **Every open note in full.** At 300 or more open notes, fan out first.
- **Every addressed or dismissed note by its `status:` line and its body's first line only.** A new note matching an addressed cause shows the fix didn't hold; say so in its question.
- **The outcome log's outliers since the last triage**: `npm run outcome:summary -- --outliers --since <date>`. Each outlier's What review caught is evidence for a cause, and each outlier with a transcript gets a question of its own: whether to run `/revise-workflows` on its session.

## 4. Fan out at 300 open notes

When 300 or more notes are open, split them by `workflow`, then by id range, across read-only `repo-explorer` sub-agents, by [`delegation.md`](../../../docs/agents/delegation.md). Name each one's notes by path. Each returns its slice's causes, one per line, each with its note ids and one note's body verbatim. Merge causes worded differently, then go on to step 5. The 300 is a starting value, tuned from use.

## 5. Group into causes

Group the notes into **causes**: the one problem several notes are instances of. **A cause is proposable when its notes come from two or more different sessions, or one of them was filed by the developer.** A `/judge-findings` sitting counts as one session, however many notes it filed. Drop the rest on the `Dropped:` line as `one session`.

## 6. Draft each proposal

Each proposal names one concrete change and the note ids it would have prevented: **the broadest change that is still concrete**, so one change fixes a class of problems rather than one instance. Follow a note's `source:` link (`npm run issue:read -- <repo> <spec> --comments`) only to draft a proposal's exact wording, for one note per cause.

The round's message opens with step 1's report and step 2's list, before its `Dropped:` line.
