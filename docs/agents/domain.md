# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root: it points at one `CONTEXT.md` per context, the framework's and the app's. Read each one relevant to the topic; the app's assumes the framework's, so a real-estate topic reads both.
- **`packages/framework/docs/design.md`**: the arguments behind the design, and this repo's substitute for an ADR tree.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates a `CONTEXT.md` lazily when terms actually get resolved.

## File structure

Three contexts, one per package, and no ADR tree:

```
/
├── CONTEXT-MAP.md                  # points at the three glossaries
├── docs/targets-and-gates.md
├── docs/claude-code-guardrails.md
└── packages/
    ├── framework/
    │   ├── CONTEXT.md              # operator-facing terms every app shares
    │   ├── src/AGENTS.md           # the tiers
    │   └── docs/
    │       ├── design.md           # one line per principle; reasoning in design/
    │       ├── vocabulary.md       # architecture words; elaboration in vocabulary/
    │       ├── architecture.md, architecture/
    │       ├── generated-data.md, generated-data/
    │       ├── how-it-runs.md
    │       └── testing.md
    ├── real-estate/
    │   ├── CONTEXT.md              # the app's terms: units, the occupancy ledger
    │   ├── src/AGENTS.md
    │   └── docs/occupancy-ledger.md
    └── writing/
        ├── CONTEXT.md              # a prose spec's terms: Piece, Deliverable, Reference
        └── AGENTS.md               # implementing a piece spec
```

## Which context a term belongs to

Ask "would this make sense in a different Sheets-backed app?" Yes: the framework's `CONTEXT.md`. No: the app's. A word for a piece of writing: the writing `CONTEXT.md`. How the glossaries relate is [`CONTEXT-MAP.md`](../../CONTEXT-MAP.md)'s; a new term that would redefine a framework one is a conflict to raise, not to resolve silently.

## Use the glossary's vocabulary

The architecture words (Raw, Identified, Named, profile, Operator) are [`docs/vocabulary.md`](../../packages/framework/docs/vocabulary.md)'s, not the glossary's.

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the `CONTEXT.md` that owns it, per `CONTEXT-MAP.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## No ADR tree — flag conflicts against the framework's design.md

**Don't create `docs/adr/`.** The framework's `docs/design.md` rules it out: specs are published as GitHub issues, and a second filing system would only drift from them. An architectural argument belongs in docs/design.md's principle list, one line there plus its reasoning in `docs/design/`, cited by issue where one exists and by commit otherwise.

If your output contradicts a principle already recorded there, surface it explicitly rather than silently overriding:

> _Contradicts the framework's design.md's "Record a deliberate absence as deliberate", but worth reopening because…_
