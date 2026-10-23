# Approve an issue body by its exact text, in a comment every reader sees

Approving edits couldn't tell a revert from a new edit by the same login, since GitHub keeps every edit in a body's history, and the approval sat in the runner's state file, where the issue reader never saw it. A body is Trusted text when it matches, by SHA-256, a body named in an `Approved body: sha256:<hex>` line of a comment under the developer's login. A revert to approved text is trusted again, and any later edit breaks the match.

Source: byronbroughten/byro-repo#351
