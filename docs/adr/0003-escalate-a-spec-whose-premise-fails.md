# Escalate a spec whose premise fails, rather than working around it

#84 placed the floor-seed check inside the generating constructors, but those run when the generated files load, so meeting that placement took an injected lookup, an optional parameter and an overload; the implementer moved the check and explained it in a departure note afterward. When a ticket's placement can only be met with plumbing that exists to get around it, the conflict goes to the developer before the code is written, not into a departure note.

Source: byronbroughten/byro-repo#84, commit 89a89573
