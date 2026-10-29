# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY-MAP.md`** at the repo root: it points at one `GLOSSARY.md` per context, among them the framework's and the app's. Read each one relevant to the topic; the app's assumes the framework's, so a real-estate topic reads both.
- **The `docs/adr/` of each repo you're touching**: the decisions recorded there, one per file; the root's holds agent-behavior decisions.
- **`packages/framework/docs/design.md`**: the arguments behind the codebase's design; `docs/agent-behavior-design.md` holds the ones behind how agents work here.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs`) creates a `GLOSSARY.md` lazily when terms actually get resolved.

## File structure

Five contexts, four of them one per package:

```
/
├── GLOSSARY-MAP.md                 # points at the five glossaries
├── .claude/skills/inbox/GLOSSARY.md # an /inbox session's terms: Proposal, Sign-off
├── runner/GLOSSARY.md              # the spec runner's terms: steps, verdicts, Halts
├── docs/adr/                       # agent-behavior decisions; framework and real-estate get their own
├── docs/targets-and-gates.md
├── docs/claude-code-guardrails.md
└── packages/
    ├── framework/
    │   ├── GLOSSARY.md             # operator-facing terms every app shares
    │   ├── src/AGENTS.md           # the tiers
    │   └── docs/
    │       ├── design.md           # one line per principle; reasoning in design/
    │       ├── vocabulary.md       # architecture words; elaboration in vocabulary/
    │       ├── architecture.md, architecture/
    │       ├── generated-data.md, generated-data/
    │       ├── how-it-runs.md, how-it-runs/
    │       └── testing.md
    ├── real-estate/
    │   ├── GLOSSARY.md             # the app's terms: units, the occupancy ledger
    │   ├── src/AGENTS.md
    │   └── docs/occupancy-ledger.md
    └── personal/
        └── writing/
            ├── GLOSSARY.md         # a prose spec's terms: Piece, Deliverable, Supporting Material, Reference
            └── AGENTS.md           # implementing a piece spec
```

## Which context a term belongs to

Which context owns a term, how the glossaries relate and where the architecture words live are [`GLOSSARY-MAP.md`](../../GLOSSARY-MAP.md)'s. A new term that would redefine a framework one is a conflict to raise, not to resolve silently.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the `GLOSSARY.md` that owns it, per `GLOSSARY-MAP.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag conflicts against the design docs

If your output contradicts an ADR in a repo's `docs/adr/`, or a principle recorded in design.md or `docs/agent-behavior-design.md`, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0003 (escalate a spec whose premise fails), but worth reopening because…_
>
> _Contradicts the framework's design.md's "Record a deliberate absence as deliberate", but worth reopening because…_
