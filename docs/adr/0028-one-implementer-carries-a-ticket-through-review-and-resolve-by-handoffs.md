# One implementer carries a ticket through review and resolve, by handoffs

A ticket's work from implement through review to resolve belongs to one implementer: once it is past the ticket budget it writes a handoff at the next step boundary, and its successor carries on the step it is in, on the ticket's own pair; killed at the live ceiling while resolving, it is resumed for a handoff, as in the implement step. This replaces ADR 0006's fresh resolver, a separate agent starting cold from the findings and the diff with no handoff, and keeps its warm resolve: the warm resolve cost $0.60 against the fresh resolver's $0.90, and on #634, the ticket nearest the budget, both warm resolves left fixes half-done, which a handoff before the resolve would have prevented. The handoff limit counts every handoff across the steps, and reaching it is still a Failure Halt that says to split the ticket.

Source: byronbroughten/byro-repo#743, byronbroughten/byro-repo#723
