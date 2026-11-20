# Issues are gitless records synced one way to GitHub, which is a view

Issues, friction notes and outcome rows are [gitless records](../../runner/GLOSSARY.md): markdown files in one gitignored store folder of the home repo's primary root, which every worktree shares, written without a workspace or a wrap-up. Agents edit an issue with their own file tools, with no `gh` round trip, gate prompt or Untrusted comment in the way, while the developer still gets a phone view, blocked-by display and parent grouping from GitHub. So don't suggest committing issues to git, nor making GitHub Issues or another hosted tracker the place agents edit them.

## Decision

- **The file is the issue's source of truth; the home repo's GitHub Issues are a view of it.** A one-way, hash-based push carries title, body, labels, parent, blocked-by and state, triggered by a hook on store edits, by the store CLI and at session start. It never deletes a GitHub issue.
- **Only open/closed and the developer's own comments come back**, pulled by a `since=` query at session start and in `map:next`. Other people's comments aren't pulled or counted, since GitHub notifies the developer of them. A body edited on GitHub stops the push for that issue until it is merged by hand.
- **GitHub assigns the number.** An [issue draft](../../runner/GLOSSARY.md) becomes an issue when the store CLI creates it on GitHub, blockers first, and the file is renamed `<n>-<slug>.md`; one number serves branches, `Source:` lines and links.
- **The format is Matt Pocock's local-markdown convention** (`Status:`, `Type:` and `Blocked by:` lines, `## Comments` appended, a spec beside its tickets), with creating, claiming and closing through the store CLI under a lock, a compare-and-set claim and a lease, and body edits as plain file edits.
- **Nothing is hard-deleted, and a closed issue stays readable by number.** Hourly restic snapshots of the store folder, kept 30 days off the machine, restore any point in that window; their credentials sit outside the sandbox's reach.
- **Every issue the developer or an agent writes lives in the store**, work on public repos included; a public repo's GitHub Issues take only outsider intake, read through `issue:read` as Untrusted text.
- **The developer's view of the store is one GitHub Project on the home repo**, grouped by Parent issue and showing sub-issue progress.

## Considered Options

- **GitHub Issues as the store** (the layout before this ADR): every agent read and write is a `gh` round trip and a gate decision, outside comments arrive as Untrusted text in agents' context, and a deleted issue can't be brought back.
- **Issues committed to git** (Backlog.md, a `.scratch/` folder): each capture costs a workspace and a wrap-up, and an issue filed on one branch is invisible to the other worktrees until it lands.
- **beads**: it has ids, atomic claims and a ready queue, but agents edit through its CLI rather than plain files, its store isn't markdown and every GUI is community-built.
- **Obsidian over iCloud Drive as the phone view**: free and it edits the files directly, but adds two tools and iCloud's conflict copies and offloaded files.
- **Google Docs, a Doc per spec with a tab per ticket**: agents would edit through the Docs API, which has no status or blocking fields.
- **Store-allocated numbers**: they work offline, but Claude doesn't, and two numbers per issue would confuse links.

## Consequences

- The logs Sheet goes, superseding ADR 0030's one-way Sheet backup; restic snapshots back the logs instead.
- Wayfinder's map and tickets, `issue:read`, `issue:file`, `map:next` and the runner move from `gh` onto the store; the order is the destination spec's.

Source: byronbroughten/personal#80, byronbroughten/personal#82
