# The piece workflow by Workflow stage

The piece workflow's [Workflow stages](../../runner/GLOSSARY.md#language), from the grill on a Piece to its landed Snapshot, the skills that work each, how each hands off to the next, and the rules docs, formats and machinery several of its skills share, each with its route. The words Piece, Deliverable, Section, Stage and Snapshot are [the writing glossary](../../packages/personal/writing/GLOSSARY.md)'s. This doc records what is, not what should be: a gap it shows is a ticket. Each skill keeps its own rules; follow its link for them.

## Which skills are in scope

A skill is in scope when a piece Workflow stage calls it or names it as the next step; a skill both workflows use is in both maps, and every other skill is in [the coding map](./coding-workflow.md). Lint fails when a skill's `SKILL.md` is linked from neither map.

**An edit that adds or removes a link to a doc in this doc's shared tables, from a skill or a hook's message, updates this doc.**

## The Workflow stages and their skills

1. **Planning**: [`/grill-piece`](../../.claude/skills/grill-piece/SKILL.md), and the [`grilling`](../../.claude/skills/grilling/SKILL.md) round format it calls.
2. **Spec**: [`/piece-spec`](../../.claude/skills/piece-spec/SKILL.md).
3. **Tickets**: [`/piece-tickets`](../../.claude/skills/piece-tickets/SKILL.md), skipped when the spec needs no Research and its Split is one session.
4. **Implementation**: [`/implement-piece`](../../.claude/skills/implement-piece/SKILL.md) and the [`/review-piece`](../../.claude/skills/review-piece/SKILL.md) it follows; for the Research Stage, [`/research-piece`](../../.claude/skills/research-piece/SKILL.md) and [`/review-research`](../../.claude/skills/review-research/SKILL.md).
5. **Judgement**: no skill. The developer's edit of the Deliverable decides the review's judgement calls, and wrap-up waits for it.
6. **Process revision**: [`/to-writing-style`](../../.claude/skills/to-writing-style/SKILL.md), and the [`writing-for-agents`](../../.claude/skills/writing-for-agents/SKILL.md) it sends a calibration-step edit through.

[`/handoff`](../../.claude/skills/handoff/SKILL.md) is used in any Workflow stage.

## The hand-off table

"Named" means the skill's own text points to the next skill, so a skill edit can break it; "you invoke it" means the hand-off lives only in the developer's habits.

| Workflow stage | Skills | Hands off to | Named by |
| --- | --- | --- | --- |
| Planning | `/grill-piece` | `grilling`, for its round format | named |
| Planning | `/grill-piece` | `/piece-spec` | named |
| Planning | `/grill-piece` | `/to-writing-style`, with the calibration differences that hold for every Piece, listed unwritten | named |
| Spec | `/piece-spec` | `/piece-tickets` when Research is needed or Split names Sections; `/implement-piece` otherwise | named, in its chat line |
| Tickets | `/piece-tickets` | `/implement-piece` on the first ticket | named |
| Implementation | `/implement-piece` | `/research-piece` on a Research issue, read as a file since it is user-invoked | named |
| Implementation | `/implement-piece` | `/review-piece` once drafted, read as a file since it is user-invoked | named |
| Implementation | `/implement-piece` | wrap-up (`npm run wrap-up -- personal <n>`), once the developer has finished editing | named |
| Implementation | `/research-piece` | `/implement-piece`, when the issue is a Piece | named |
| Implementation | `/research-piece` | the Research wrap-up prompt in [the writing `wrap-up.md`](../../packages/personal/writing/docs/wrap-up.md) | named |
| Implementation | any | `/review-research`, on a Research issue's findings | you invoke it |
| Implementation | the Research wrap-up | `/implement-piece` on the next ticket | you invoke it |
| Judgement | the developer's edit | wrap-up | you invoke it |
| Judgement | the developer's edit | `/to-writing-style`, on the Piece's Snapshot | you invoke it |
| Process revision | [`/to-code-style`](../../.claude/skills/to-code-style/SKILL.md), from the coding workflow | `/to-writing-style`, with its prose rulings | named |
| Process revision | `/to-writing-style` | `writing-for-agents`, for a change to `/grill-piece`'s calibration step | named |
| any | the context nudge | a handoff by [`planning.md`'s Handoffs](./planning.md#handoffs) | named, by the hook |

## The shared rules docs

A doc is listed when two or more skills reach it by one of these routes: **directly** (the skill links it or names it to read), **via a doc** (it links a doc that links or names it), **via an always-on hook** (the read-first gate's prose-style row, which fires on any prose edit, and the context nudge, which fires for any session near the ticket budget), or **via a hook message**. A doc reached only through the root `AGENTS.md` router, or by one skill, isn't listed.

| Doc | Directly | Indirectly |
| --- | --- | --- |
| The Voice and Craft sheets: [`writing-voice.md`](../writing-voice.md) and [`writing-craft.md`](../writing-craft.md) | `/grill-piece`, `/review-piece`, `/to-writing-style` | via the writing `AGENTS.md`: `/implement-piece`, `/piece-spec`, `/piece-tickets` |
| [The academic style sheet](../academic-writing-style.md) | `/grill-piece`, `/review-piece`, `/to-writing-style` | via the writing `AGENTS.md`: `/implement-piece`, `/piece-spec`, `/piece-tickets` |
| [The writing `AGENTS.md`](../../packages/personal/writing/AGENTS.md) | `/grill-piece`, `/piece-spec`, `/piece-tickets`, `/implement-piece`, `/review-piece` | |
| [The writing glossary](../../packages/personal/writing/GLOSSARY.md) | `/grill-piece`, `/piece-spec`, `/piece-tickets`, `/review-piece`, `/to-writing-style` (its pair mode) | via the writing `AGENTS.md`: `/implement-piece` |
| [`grilling.md`](../../packages/personal/writing/docs/grilling.md) | `/grill-piece`, `/piece-spec`, `/to-writing-style` | via the writing `AGENTS.md`: `/piece-tickets`, `/implement-piece`, `/review-piece` |
| [`outlining.md`](../../packages/personal/writing/docs/outlining.md) | `/grill-piece`, `/piece-spec`, `/piece-tickets` | via the writing `AGENTS.md`: `/implement-piece`, `/review-piece` |
| [`pdf-pages.md`](../pdf-pages.md) | `/grill-piece`, `/piece-tickets` (its ticket template), `/review-piece`, `/research-piece`, `/review-research` | via the writing `AGENTS.md`: `/implement-piece`, `/piece-spec` |
| [`snapshots.md`](../../packages/personal/writing/docs/snapshots.md) | `/implement-piece`, `/to-writing-style` (its pair mode) | via the writing `AGENTS.md`: `/piece-spec`, `/piece-tickets`, `/review-piece` |
| [The writing `wrap-up.md`](../../packages/personal/writing/docs/wrap-up.md) | `/research-piece` | via the writing `AGENTS.md`: `/grill-piece`, `/piece-spec`, `/piece-tickets`, `/implement-piece`, `/review-piece` |
| The writing outcome log, [`model-fit.md`](../../packages/personal/writing/docs/model-fit.md) | `/piece-spec`, `/piece-tickets` | via the writing `wrap-up.md`: `/research-piece`, which has the developer add its row |
| [`planning.md`](./planning.md): ticket size and model fit | `/piece-spec` (model fit), `/piece-tickets` (both) | via always-on hook: the context nudge, for any session |
| [The git workflow doc](./git-workflow.md) | `/implement-piece` | via the writing `AGENTS.md`: `/grill-piece`, `/piece-spec`, `/piece-tickets`, `/review-piece` |
| [`prose-files.md`](./prose-files.md) | `/to-writing-style`, and `/to-code-style` from the coding workflow | via always-on hook: every prose edit, through [`prose-style.md`](../prose-style.md) |

## The shared formats

| Format | Skills |
| --- | --- |
| `grilling`'s round format | `grilling`, `/grill-piece` |
| The ten spec fields and the piece-spec template | `/grill-piece` settles them, `/piece-spec` writes them, `/piece-tickets` reads Research, Final pass, Split, Form and Outline, `/review-piece` reads Reader, Outline, Form and Style |
| The piece-ticket template, its Sections named by exact heading text | `/piece-tickets` writes it; `/implement-piece` drafts only the Sections it names; `/review-piece` scopes to them |
| The four review axes, Spec, Voice, Craft and Reader, with hard findings and judgement calls | `/review-piece` reports them; `/implement-piece` fixes the hard Spec findings and reports the rest |
| The Research fact list comment: numbered facts, each with a source and page, quotes verbatim | `/research-piece` posts it; `/review-research` checks it; `/review-piece`'s fact list takes it as verified; `/implement-piece` drafts from its facts, never its quotes |
| The model-fit chat line, `#n: <Model> <effort> (reason)` | `/piece-spec`, `/piece-tickets` |
| The Snapshot's path and shape | `/implement-piece` saves it; `/to-writing-style`'s pair mode diffs it |
| The numbered 🪤/📝 items | `/to-writing-style`, and `/to-code-style` from the coding workflow |

## The shared machinery

| Machinery | Skills |
| --- | --- |
| The issue reader (`npm run issue:read`) with Trusted and Untrusted text | `/piece-tickets`, `/implement-piece`, `/review-piece`, `/research-piece`, `/review-research` |
| Issue and session workspaces (`npm run issue:start`, [`git-workflow.md`](./git-workflow.md#a-skills-session-workspace)) | `/implement-piece`'s issue workspace, the Research wrap-up prompt's session workspace |
| Wrap-up (`npm run wrap-up`) | `/implement-piece`, the Research wrap-up prompt |
| `npm run overlap` | `/review-piece` runs it; `/implement-piece` reruns it after a fix |
| `npm run verify:quotes` | `/research-piece` alone |
| `npm run pdf:text` and the page-range command in [`pdf-pages.md`](../pdf-pages.md) | `/research-piece` dumps text; `/review-piece` writes ranges; `/grill-piece` and `/review-research` count and print pages |
| The Research wrap-up prompt ([the writing `wrap-up.md`](../../packages/personal/writing/docs/wrap-up.md)) | `/research-piece` gives it; the developer runs it |
| Sub-issues and native blocking edges | `/piece-tickets` sets them; `/review-piece` reads the parent through `gh api` |
| The gworkspace tools (Drive and Docs) | `/grill-piece`, `/implement-piece`, `/review-piece`, `/research-piece` |

## Out of scope

Every skill not named above is in [the coding map](./coding-workflow.md), which also holds `grilling`, `/handoff` and `writing-for-agents`.
