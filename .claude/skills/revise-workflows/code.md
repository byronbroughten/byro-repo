# The code branch

The code Workflow's friction kinds, inference signals and routes, beside [`SKILL.md`](./SKILL.md)'s steps.

## Hunt

Add these kinds to step 1's:

- **Misdirection**: a doc line that was read and acted on and pointed wrong. Usually not false: stale, or written in a tense that implies a live defect the code already handles, or precise about a mechanism and silent about whether it bites now.
- **Rediscovery**: a fact derived by reading source, probing or measuring. Measurements are the richest kind, because they can't be looked up at all.
- **Stated rule**: a preference or rule the developer articulated that no doc holds. Scan their turns for "I prefer", "as a general rule", "always", or a correction of an approach the agent proposed.
- **Style ruling**: a shape of code the developer objected to and had changed, stated as a rule or not. Read the session's diff as well as the conversation: each refactor the developer directed is a candidate. The rule is the generalization of the change ("named accessors, never inline lookups"), not the change itself. A ruling counts even when it cost the session nothing, and even when a style doc already gestures at it; a rule the docs hold but the agent or the codebase broke goes in as a sharpened line.
- **Review miss**: a shape the developer had changed after `/code-review` passed it. Name the standard the reviewer lacked, or the line it had and skipped; the second goes in as a sharpened line.

**A ruling on reader-facing prose ([`prose-files.md`](../../../docs/agents/prose-files.md#terms)) is `piece.md`'s**; read that branch too when one turns up.

In another agent's session, infer friction from:

- a developer turn correcting the agent;
- the agent retracting itself ("actually", "I was wrong");
- three or more reads or greps around one question, ending in a conclusion (a rediscovery);
- a doc read followed by an action that contradicts it (misdirection).

## Routes

- **A mechanical ruling becomes a check**: an entry in `styleSyntax` in `config/eslint.js`, or a `config/docLint.js` rule for docs. Propose the selector and the message.
- **[`config/docs/code-style.md`](../../../config/docs/code-style.md) and [`packages/framework/docs/code-style.md`](../../../packages/framework/docs/code-style.md)**: code shape, as one line, for judgement calls only. Their charter is rules distilled from the developer's own refactors, so a stated rule or style ruling almost always lands in one: the framework's when it names Sheets, a tier, `Val` or a framework path, otherwise `config/`'s. Reasoning and worked examples go under each file's `docs/code-style/`; for a ruling, the before and after from the session's diff is the example.
- **[`packages/framework/docs/vocabulary.md`](../../../packages/framework/docs/vocabulary.md) and [`packages/framework/src/AGENTS.md`](../../../packages/framework/src/AGENTS.md)**: the architecture words and the tiers. A design principle is one line in `packages/framework/docs/design.md` plus its reasoning under `docs/design/`. A README is derived prose for people, never a fact's home.
- **[`docs/prose-style.md`](../../../docs/prose-style.md)**: how developer-facing prose is shaped. A ruling on the shape of a doc, a skill or an AGENTS.md lands here as one line, its reasoning under `docs/prose-style/`.

## The rounds

When you noticed other sites still in a style ruling's old shape, add `Other sites still in the old shape: <n>` to the round's `Dropped:` line. Report them; leave them unfixed.
