---
name: implement-piece
description: "Implement a writing Piece spec into its Deliverable, then review it with /review-piece, fix the hard findings and report the rest."
disable-model-invocation: true
---

Implement the Piece described by the spec or sub-issue in `byronbroughten/writing`.

Fetch it with `gh issue view -R byronbroughten/writing <n> --json title,body,comments --jq '{title, body, comments: [.comments[].body]}'` and state its title before starting. If the reference is ambiguous, ask. If the issue is Research, stop: it has its own path.

Typing `/implement-piece <n>` is what grants the standing yes: `docGrantGuard.ts` records the Doc ID from the spec's Deliverable (a ticket's Shared rules), and the grant lasts while the spec is open. Any later session, a cleanup agent included, inherits it without retyping; retype it only if the grant is lost (a cleared `$TMPDIR`, say).

Draft by the rules under "Implementing a piece spec" in [`packages/writing/AGENTS.md`](../../../packages/writing/AGENTS.md): its text, its supporting material, its standing yes and its voice. On a sub-issue, write only the Sections it names.

Once drafted, read [`.claude/skills/review-piece/SKILL.md`](../review-piece/SKILL.md) and follow it on the same issue. It is user-invoked, so the Skill tool can't reach it.

Then:

- **Fix every hard Spec finding** in the Deliverable, under the spec's standing yes. Without one, ask before writing.
- **Report the Spec judgement calls, the Style and Reader findings and Jev's style flags to the developer, unfixed.** They are judgement calls, and the developer's own edits are what `/to-writing-style` learns from. Jev's flags are a trial: report them, never fix them.

Done when no hard finding is left, or each one left is reported with why.

End with the wrap-up prompt in [`packages/writing/docs/wrap-up.md`](../../../packages/writing/docs/wrap-up.md). Commit nothing.
