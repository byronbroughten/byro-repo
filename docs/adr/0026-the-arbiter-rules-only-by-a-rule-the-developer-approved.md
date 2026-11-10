---
status: accepted
---

# The Arbiter rules only by a rule the developer approved, and leaves the rest to them

Most of what a run hands the developer is a rubber stamp. A runner agent step, the [Arbiter](../../runner/GLOSSARY.md), takes the first pass at a run's review-list items and Halts, and rules on one only by citing a rule the developer approved. It leaves the rest for the developer with a Recommendation, and the runner's own code makes every write. Removing a decision point is a Tier 1 change, and tying each ruling to an approved rule is what makes the change acceptable: the decision was made when the rule was approved, so only the rubber stamp goes.

Source: byronbroughten/byro-repo#677, byronbroughten/byro-repo#679

## Evidence and the approved rules

- In session babae021, all 17 of spec #611's review-list items and its filing question were answered "Agreed", unchanged. sheets-framework#219's run raised 28 Halts.
- The approved rules are the Standards docs, the verdicts doc, the spec's binding parts, the Codebase Priorities and the Arbiter Principles. The Arbiter Principles grow only by the developer's yes.

## Considered Options

- **Each item settled where it is raised**, by new resolver or merge-step rules: rejected. Folding duplicates, spotting what a later ticket already fixed, and recognising a repeated blocker all need the whole run in view, and a step's claim about its own work would go unchecked.
- **The Supervisor ruling**: rejected. It posts only replies the developer settled, so it saves no attention.
- **A fresh Arbiter step per Halt**: rejected. sheets-framework#219's 28 Halts came in 18 groups, and 11 of the 17 gaps between groups were under an hour. So the session is reused while its last turn is under the runner steps' one-hour cache lifetime and its context is under the ticket budget. Otherwise a fresh step reads the Ruling log in place of a handoff.
- **One session kept from the first Halt to the run's end, reset with handoffs**: rejected. A Restart or a crash loses it, and after an hour without a turn its cache is cold anyway.
- **The Arbiter making small fixes itself**: rejected. That would be an edit path with no review, which is a Tier 1 loss, and a judge that is also an implementer. A grouped ticket on Sonnet medium costs $0.40–1.80 all-in, review included.
- **An unbounded chain of filings**: rejected for a cap of 2 passes per spec, set by a run knob. The developer said they would probably not file what a third level raises.

## Consequences

- Every ruling stays on the review list or the Halt with its cited rule, and the developer can reopen any ruling in `/judge-findings`. Overturning one is how a new Arbiter Principle starts.
- An Arbiter that fails leaves everything with the developer, as before. It never raises a Failure Halt.
