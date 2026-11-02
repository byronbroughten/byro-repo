# Let GitHub and the git folders into the sandbox

A command that reached GitHub or wrote a git folder left the sandbox only when every command in its call matched an `excludedCommands` entry, so a `cd`, a pipe or an unlisted spelling such as `git -C <clone> commit` kept it in the box, where it failed with errors that never named the box. GitHub, the jev API and the git folders are now in the box and the commands that needed them come off `excludedCommands`, while the tier gate still decides each command from its text, superseding ADR 0023's rejection of GitHub on the allowlist and its denial of the git folders. Keeping them out closed little, since `npm test`, `npm run check` and `npm run runner*` already run code the gate can't read outside the box with full access.

Source: ByronBroughten/byro-repo#537

## Considered Options

- **Keeping GitHub and the git folders out of the box**: rejected. The exclusion guarded against code the gate can't read, such as a script, a test or a dependency, using the GitHub token the keychain hands the box or rewriting local history, but it closed little, as the lead says. Meanwhile, of the 34 sessions in the 2½ hours after the sandbox landed, 4 hit a TLS error, 2 a proxy 403 and 7 an `index.lock` error, and one halted sheets-framework#193.

## Consequences

- Boxed code gains the GitHub token's `repo`, `gist` and `workflow` scopes, so a buggy or injected script could post private content publicly. It could likely also change a repo's visibility: the `repo` scope grants full access to repositories, and the developer owns them.
- Boxed code can rewrite local refs and reflogs. Pushed history is unaffected.
- Data integrity is unaffected: Google stays outside the box.
- The later mitigation is a fine-grained token for the box, with no Administration permission, left to ByronBroughten/byro-repo#520 with ADR 0023's scoped token.
- `npm run issue*` and `npm run wrap-up *` stay excluded, since without `ps` their lease check reads a live lease as abandoned. `npm run jev*` stays excluded until its client sends requests through the sandbox's proxy.
- A new package clone needs its own `allowWrite` entry for its `.git` folder ([why](../claude-code-guardrails.md#the-bash-sandbox)).
