# The coding workflow by Workflow stage

The coding workflow's [Workflow stages](../../runner/GLOSSARY.md#language), the skills that work each, how each hands off to the next, and the rules docs, formats and machinery several skills or runner [Steps](../../runner/GLOSSARY.md#language) share, each with its route. This doc records what is, not what should be: a gap it shows is a ticket. Each skill keeps its own rules; follow its link for them.

## Which skills are in scope

A skill is in scope when a Workflow stage calls it or names it as the next step, unless it belongs only to [the piece workflow](./piece-workflow.md). Lint fails when a skill's `SKILL.md` is linked from neither map, so a new skill goes in a Workflow stage or the out-of-scope list of one of them.

**An edit that adds or removes a link to a doc in this doc's shared tables, from a skill, a hook's message or a runner prompt, updates this doc.**

## The Workflow stages and their skills

1. **Planning**: [`/wayfinder`](../../.claude/skills/wayfinder/SKILL.md), [`/grill-with-docs`](../../.claude/skills/grill-with-docs/SKILL.md), [`/grill-me`](../../.claude/skills/grill-me/SKILL.md), [`grilling`](../../.claude/skills/grilling/SKILL.md), [`domain-modeling`](../../.claude/skills/domain-modeling/SKILL.md), [`/prototype`](../../.claude/skills/prototype/SKILL.md), [`/research`](../../.claude/skills/research/SKILL.md).
2. **Spec**: [`/code-spec`](../../.claude/skills/code-spec/SKILL.md).
3. **Tickets**: [`/code-tickets`](../../.claude/skills/code-tickets/SKILL.md), [`/review-code-tickets`](../../.claude/skills/review-code-tickets/SKILL.md).
4. **Implementation**: [`/runner`](../../runner/skills/runner/SKILL.md), the Supervisor; [`/start-issue`](../../.claude/skills/start-issue/SKILL.md); [`/implement-code`](../../runner/skills/implement-code/SKILL.md); [`tdd`](../../.claude/skills/tdd/SKILL.md) and the [`codebase-design`](../../.claude/skills/codebase-design/SKILL.md) it links; and [`/code-review`](../../.claude/skills/code-review/SKILL.md), the review Step's skill.
5. **Judgement**: [`/judge-findings`](../../runner/skills/judge-findings/SKILL.md).
6. **Process revision**: [`/mine-outcomes`](../../runner/skills/mine-outcomes/SKILL.md), [`/retro`](../../.claude/skills/retro/SKILL.md), [`/to-code-style`](../../.claude/skills/to-code-style/SKILL.md), and the [`writing-for-agents`](../../.claude/skills/writing-for-agents/SKILL.md) that `/retro` and `/to-code-style` call.

[`/handoff`](../../.claude/skills/handoff/SKILL.md) is used in any Workflow stage.

## The runner's Steps in the Implementation stage

A run's Steps are implement, review, resolve, checks and wrap-up for each ticket, and the gap check at the end of a spec; the [runner glossary](../../runner/GLOSSARY.md#language) defines each. `/code-review` is the review Step's skill, set by the runner's `skillNames.review` knob (`runner/src/runKnobs.ts`), and `/implement-code` is generated from the implement Step's shared body (`runner/src/implementCodeSkill.ts`), so a change to either reaches both an interactive session and a run.

## The hand-off table

"Named" means the skill's own text points to the next skill or Step, so a skill edit can break it; "you invoke it" means the hand-off lives only in the developer's habits.

| Workflow stage | Skills | Hands off to | Named by |
| --- | --- | --- | --- |
| Planning | `/wayfinder` | `grilling` with `domain-modeling`, `/prototype` and `/research`, by ticket type | named |
| Planning | `/grill-with-docs`, `/grill-me` | `grilling`, and `domain-modeling` for `/grill-with-docs` | named |
| Planning | any | `/code-spec` | you invoke it |
| Spec | `/code-spec` | `/code-tickets`, when the spec won't fit one session | named, in its chat line |
| Tickets | `/code-tickets` | `/review-code-tickets`, at 6 or more tickets, before the breakdown reaches the developer | named, read by path |
| Tickets | `/code-tickets`, `/review-code-tickets` | `grilling`, for the spec gaps a review finds | named |
| Tickets | `/code-tickets`, `/review-code-tickets` | `/runner` | you invoke it |
| Tickets | a Phase gate | `/code-tickets` | named, in the gate's body |
| Implementation | `/runner` | `/judge-findings` when a run finishes; an Interactive ticket through `/start-issue`'s steps and `/implement-code` | named |
| Implementation | `/start-issue` | `/implement-code` | named |
| Implementation | `/implement-code` | `tdd`, the review Step (`runner -- review`), then wrap-up | named |
| Implementation | `tdd` | `codebase-design` | named |
| Judgement | `/judge-findings` | `/to-code-style` and `/mine-outcomes` when it closes a spec; tickets filed by `/code-tickets`' conventions | named |
| Process revision | `/mine-outcomes` | `/retro`, on outlier tickets | named |
| Process revision | `/retro`, `/to-code-style` | `writing-for-agents` | named |
| any | the context nudge | a handoff by [`planning.md`'s Handoffs](./planning.md#handoffs) | named, by the hook |

## The shared rules docs

A doc is listed when two or more skills or Steps reach it by one of these routes: **directly** (the skill or Step links it), **via a doc** (it links a doc that links it), **via an always-on hook** (the read-first gate's code-style and prose-style rows, which fire on any code or prose edit, and the context nudge, which fires for any session near the ticket budget), **via a hook message**, or **via a runner prompt** (the text the runner gives a Step). A doc reached only through the root `AGENTS.md` router, or by one skill or Step, isn't listed.

| Doc | Directly | Indirectly |
| --- | --- | --- |
| [Codebase Priorities](./codebase-priorities.md) | `grilling` (and so `/grill-with-docs`, `/grill-me` and `/wayfinder`'s grilling tickets), `/judge-findings`, `/mine-outcomes`, `/retro`, `/to-code-style` | via `verdicts.md`: `/code-review`, `/implement-code`, the review and resolve Steps |
| [`verdicts.md`](./verdicts.md) | `/code-review`, `/implement-code`, `/judge-findings` | via runner prompt: the resolve Step; via `/code-review`: the review Step |
| [`planning.md`](./planning.md) | `/code-spec`, `/code-tickets`, `/review-code-tickets`, `/start-issue`, `/to-code-style` | via always-on hook: the context nudge, for any session |
| [`model-fit.md`](./model-fit.md) | `/mine-outcomes` | via `planning.md`: `/code-spec`, `/code-tickets` |
| The code-style rules: [config's](../../config/docs/code-style.md) and [the framework's](../../packages/framework/docs/code-style.md) | `/retro`, `/to-code-style` | via always-on hook: every code edit, by `/implement-code`, the implement and resolve Steps, and `/judge-findings`' "now" fixes |
| [`prose-style.md`](../prose-style.md) | `/code-review`, `/retro`, `/to-code-style` | via always-on hook: every prose edit |
| [The issue tracker doc](./issue-tracker.md) and [triage labels](./triage-labels.md) | `/wayfinder`, `domain-modeling`, `/code-spec`, `/code-tickets`, `/review-code-tickets`, `/code-review`, `/judge-findings`, `/mine-outcomes` | |
| [The git workflow doc](./git-workflow.md) | `/implement-code`, `/judge-findings`, `/mine-outcomes` | via runner prompt: the implement Step |
| [The runner glossary](../../runner/GLOSSARY.md) | `/runner`, `/review-code-tickets`, `/judge-findings`, `/mine-outcomes` | |
| [The guardrails doc](../claude-code-guardrails.md) | `/code-tickets`, `/review-code-tickets`' reviewer, `/retro` | |
| Design docs, ADRs and glossaries | `/code-spec`, `/code-tickets`, `domain-modeling`, `tdd`, `/to-code-style` | |
| Skills read as docs | `/code-tickets`' conventions by `/judge-findings`; `/retro`'s categories by `/mine-outcomes`; `grilling`'s format by `/judge-findings`, `/mine-outcomes` and `/retro` | |

Routes that depend on which files a ticket touches (the read-first gate's tier, framework-style and writing rows, nested `AGENTS.md` files, the AGENTS.md cost nudge and the sandbox-failure context) live in [the guardrails doc's hooks section](../claude-code-guardrails.md#the-hooks-and-the-project-agent).

## The shared formats

| Format | Skills and Steps |
| --- | --- |
| `grilling`'s round format | `grilling`, `/code-tickets`, `/review-code-tickets`, `/judge-findings`, `/mine-outcomes`, `/retro` |
| The `## Model fit` section and its read-back ([`planning.md`](./planning.md#model-fit)) | `/code-spec`, `/code-tickets`, the tickets `/judge-findings` and `/mine-outcomes` file, `/start-issue`'s check |
| A ticket's `## New dependencies` section | `/code-tickets` writes it; `/implement-code` and the implement Step add only what it names; the wrap-up Step refuses any other new package |
| The review list's `R<n>.<k>` items | the runner posts them; `/judge-findings` and the Supervisor decide them through `runner -- decide` |
| The quiz on the whole breakdown | `/code-tickets` alone |
| The numbered 🪤/📝 items | `/to-code-style`, and `/to-writing-style` from the piece workflow |

## The shared machinery

| Machinery | Skills and Steps |
| --- | --- |
| The issue reader (`npm run issue:read`) with Trusted and Untrusted text | `/runner`, `/review-code-tickets`, `/start-issue` (via `issue:start`), `/implement-code`, `/judge-findings`, `/mine-outcomes`, every agent Step |
| Session workspaces ([`git-workflow.md`](./git-workflow.md#a-skills-session-workspace)) | `/start-issue`, `/judge-findings`, `/mine-outcomes` |
| Wrap-up (`npm run wrap-up`) | `/implement-code`, `/judge-findings`, `/mine-outcomes`, the wrap-up Step |
| `runner -- decide` | `/runner`, `/implement-code`, `/judge-findings` |

## Out of scope

[`/inbox`](../../.claude/skills/inbox/SKILL.md), [`/wizard`](../../.claude/skills/wizard/SKILL.md), [`/prompt-scan`](../../.claude/skills/prompt-scan/SKILL.md), [`/pr`](../../.claude/skills/pr/SKILL.md), [`/retarget-after-gen-configs`](../../.claude/skills/retarget-after-gen-configs/SKILL.md), [`/check-upstream-skills`](../../.claude/skills/check-upstream-skills/SKILL.md), and the skills of [the piece workflow](./piece-workflow.md). `/to-code-style` sends prose rulings to `/to-writing-style`, which is piece workflow.
