# Dispatched agents locate and quote, while diagnosis and gates stay in the main session

A dispatched agent starts cold, has nobody to ask, and costs more than it saves if its report has to be re-read before it can be trusted. So a sweep goes to a read-only explorer that finds and quotes but doesn't diagnose, run on Sonnet rather than Haiku since this codebase is type-heavy, and every dispatched agent returns `file:line` with verbatim quotes. The diagnosis and any action that needs a yes, a commit or a `gh` write stay in the main session, which runs the command the agent reports.

Source: byronbroughten/byro-repo#53, a7810dd
