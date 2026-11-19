# The root is a private home repo with areas as folders, and public repos are edited in place

The root becomes the private [home repo](../../runner/GLOSSARY.md), where every session starts, holding the shared agent tooling and every [area](../../runner/GLOSSARY.md) as a plain folder. New work defaults to private, and which parts are product or showcase is decided per business later, so private is the default home and publishing is a deliberate step. So don't suggest a private working copy synced into a public repo, nor splitting an area into its own repo for tidiness.

## Decision

- **Areas sit at `areas/<name>/`**, an app inside one being its own subfolder workspace; `packages/` holds only separate repos cloned into the home.
- **An area becomes a repo of its own only when someone outside needs access**, since GitHub has no per-folder read access, **or when it goes public.**
- **Going public moves the folder to a new public repo with fresh history**, one initial commit, so no private commit message or diff needs scrubbing; the home then clones it into `packages/`.
- **A public repo is the single home for its code, edited in place with no private mirror.** The planning about it stays private, and its commit messages and branch names never mention private work, as its issues already don't.

## Considered Options

- **The root stays public, each private area a nested private repo** (the layout before this ADR): every new business needs a repo from day one, and the tooling stays public by default though it may become a product.
- **A new private home with the root kept as a public tooling repo inside it**: two roots to maintain, and tooling commits that mention private work leak.
- **A private mirror synced into each public repo** (Copybara, subtree split, josh): sync machinery and a channel for private history to leak, and outside contributions must be imported back. Companies that do this keep their source of truth in a private monorepo and pay to run the sync.
- **Submodules**: git calls several superproject checkouts "NOT recommended", and every session works in a worktree.
- **Splitting a public part with history** (`git filter-repo --subdirectory-filter`): every commit message and diff needs checking for private content first. It stays available case by case.

## Consequences

- `config` moves to its own public repo before the flip: public `framework` and `utils` depend on it, and npm can't attach provenance to a package published from a private repo.
- All history up to the flip stays public, GitHub's secret scanning goes away while wrap-up's own scan stays, and the home's CI stops being free.

Source: byronbroughten/personal#78
