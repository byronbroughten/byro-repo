---
name: note-friction
description: "Record a Friction note, one problem with a Workflow or the machinery they share. Use when the developer runs /note-friction \"<quote>\", or when the sandbox or a gate refused a routine command, you made a Hand-back, a doc you followed turned out stale or wrong, or you retracted a claim."
---

Write one file with the Write tool, which carries the note's text into the file; the text never goes in a shell argument.

**The folder**: `.runner/friction/` in the primary root, the folder above the path `git rev-parse --path-format=absolute --git-common-dir` prints.

**The file**: `<id>.md`. The id is `<date>-<session>-<k>`, or `<date>-<k>` with no session, `<k>` one past the highest that date and session already hold in the folder, starting at 1.

**The fields**, then the note:

```
---
id: <id>
date: <today, YYYY-MM-DD, local>
session: <this session's id, from the SessionStart hook's `session:` line; blank with none>
workflow: <code | piece | shared>
filed-by: <developer when they ran /note-friction, otherwise agent>
source:
status:
---

<the developer's quote, verbatim; or what you hit, in a sentence or two, naming the command, step or doc>
```

Write it and say done.
