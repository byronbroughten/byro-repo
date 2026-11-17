# Specs

The rules for planning and writing a spec, code, piece or mixed. Sizing and splitting tickets is [`tickets.md`](./tickets.md)'s.

- **A plan or spec includes the matching prose-file edit** in its own scope ([`prose-files.md`](./prose-files.md)).

## Exploring

- **Explore the repo to understand the current state of the codebase.**
- **Use the project's domain glossary vocabulary throughout each spec.**
- **Respect ADRs in the area you're touching, and the [design](../../packages/framework/docs/design.md) principles that apply.**

## Piece specs

- **A piece or mixed spec's Piece is grilled with `/grill-piece`**, which runs [`docs/pieces/grilling.md`](../pieces/grilling.md).
- **A piece or mixed spec is filed with `/project-spec` and split with `/project-tickets`.**
- **Every piece or mixed spec gets tickets: at least one drafting ticket, and its Edit gate last**, a `ready-for-human` ticket blocked by every drafting ticket ([`/project-tickets`' piece branch](../../.claude/skills/project-tickets/SKILL.md#the-piece-branch)).
- **A mixed spec's tickets each carry their own label** ([the piece branch's mixed-spec line](../../.claude/skills/project-tickets/SKILL.md#the-piece-branch)); a ticket with neither raises a Halt naming it.

## Phases

Each Phase is a spec of its own, filed with the rest of its Project by [`/project-spec`](../../.claude/skills/project-spec/SKILL.md), which also runs each Phase gate.

- **Split work into several specs for a gate (real use could change or cancel what follows) or for size (a spec headed past about 55 user stories or about 25K characters of body).** The size line is fuzzy, weighed with the other considerations, and `/mine-outcomes` may retune it.
- **Each spec stands on its own: it lands green and leaves master consistent, with nothing half-migrated.** Operator-visible value is preferred; an enabling spec is allowed when no such slice fits, and its Problem Statement says so.
- **A spec that replaces something also removes the old version, docs included.** That removal and any docs sweep are tickets in that spec, never specs of their own.
- **A Phase is not a tracer bullet**: a tracer bullet is one verifiable slice, and a Phase is a spec, usually several slices that together can be used in real work.
- **The first Phase is the smallest usable spec**, and it names the stand-ins it runs on until a later Phase replaces them.

## Code in specs

- **Inline a shape (a record, type, schema or state machine) only when prose can't state the decision as precisely.**
- **A shape binds what it decides: which facts a record carries, which states and transitions exist, what a type allows.** Its form doesn't bind: names, how it's split, or whether it's a new type at all ([the implementer's precedence](../../runner/skills/implement-code/SKILL.md#what-the-ticket-binds)).
- **Wording is verbatim only when the developer has said it is exact.** A planner never treats the developer's casual phrasing as verbatim.
- **A ticket that changes a tier rule quotes the row of the tier table it changes and says whether the change is stricter or looser.**

## Test seams

- **For each code spec, sketch the seams at which you're going to test it.**
- **Existing seams should be preferred to new ones.**
- **Use the highest seam possible.**
- **If new seams are needed, propose them at the highest point you can.** The fewer seams across the codebase, the better: the ideal number is one.
- **A spec's test seams name the outcome each test asserts**: for a Sheets write, the grid it leaves, not the requests it sends ([framework style](../../packages/framework/docs/code-style.md#tests)).
- **Name any planned test that would break a [test speed rule](../../config/docs/code-style/tests.md#test-speed) and warn about it clearly, saying which rule it breaks.**
- **The spec's Testing Decisions repeat the warning**, so it reaches the ticket implemented from it.
- **The warning needs no approval of its own.**

## Settings changes

- **A `.claude/settings.json` change is agent work**: a step's edit can add a hook or permission rule for later steps on its own ticket, but can't remove a primary gate ([guardrails](../claude-code-guardrails.md#the-hooks-and-the-project-agent)).
