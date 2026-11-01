# Wrap-up: how a spec lands

Disclosed from [`docs/agents/git-workflow.md`](../git-workflow.md#landing-a-spec). The rule is there; this file holds what the wrap-up script does when it lands a spec.

- **`npm run wrap-up -- <repo> <n>` reads `.runner/<repo>-<n>.facts.json`** (the `WrapUpFacts` shape in `runner/src/FactsFile.ts`). The runner writes it during a run, and a session's tooling during an interactive one, the interactive review adding each review and resolve session it starts.
- **Nobody passes branches**: wrap-up lands each repo whose `issue-<n>-*` branch is ahead of master, in the config's clone order with the root repo last, so a repo lands before any repo that depends on it.
- **An interactive agent passes only the closing facts**: `npm run wrap-up -- <repo> <n> --closing "…" [--undone "<box>: <reason>"]...`, adding `--no-code` for a ticket with no branch ahead and no GitHub writes, such as one that only edited a Doc.
- **A wrap-up with no closing comment in either place fails naming `--closing`.**
- **When the facts file carries the recorded session ids, each with its account and config folder (`sessions`), the script computes pair, peak context, duration, cost and review cost from them**, reading earlier implementer sessions from each handoff comment's `session: <id>` line. A fact it can't compute is written `unrecorded`.
- **A Standalone ticket whose facts record undecided review-list items (`hasUndecidedReviewItems`) lands and stays open**, and wrap-up says so; `/judge-findings` closes it.
- **It stops at the first failure, naming its kind, and a rerun skips the steps already done.**
