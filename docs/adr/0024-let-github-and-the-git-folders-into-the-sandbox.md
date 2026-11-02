# Let GitHub and the git folders into the sandbox

A command that reached GitHub or wrote a git folder left the sandbox only when every command in its call matched an `excludedCommands` entry, so a `cd`, a pipe or an unlisted spelling such as `git -C <clone> commit` kept it in the box, where it failed with errors that never named the box. GitHub's domains and the jev API's are now on the allowlist, with `enableWeakerNetworkIsolation` on so `gh` can verify TLS. The primary's `.git` and each package clone's are writable. `gh`, git's network and local-write verbs and `outcome:summary` come off `excludedCommands`. The tier gate still decides each command from its text, wherever it runs. This supersedes ADR 0023's rejection of GitHub on the allowlist and its denial of the git folders.

Source: ByronBroughten/byro-repo#537

## Considered Options

- **Keeping GitHub and the git folders out of the box**: rejected. The exclusion guarded against code the gate can't read, such as a script, a test or a dependency, using the GitHub token the keychain hands the box or rewriting local history. But `npm test`, `npm run check` and `npm run runner*` already run such code outside the box with full access, so it closed little. Meanwhile, of the 34 sessions in the 2½ hours after the sandbox landed, 4 hit a TLS error, 2 a proxy 403 and 7 an `index.lock` error, and one halted sheets-framework#193.

## Consequences

- Boxed code gains the GitHub token's `repo`, `gist` and `workflow` scopes, so a buggy or injected script could post private content publicly. It could likely also change a repo's visibility: the `repo` scope grants full access to repositories, and the developer owns them.
- Boxed code can rewrite local refs and reflogs. Pushed history is unaffected.
- Data integrity is unaffected: Google stays outside the box.
- The later mitigation is a fine-grained token for the box, with no Administration permission.
- `npm run issue*` and `npm run wrap-up *` stay excluded, since without `ps` their lease check reads a live lease as abandoned. `npm run jev*` stays excluded until its client sends requests through the sandbox's proxy.
- `allowWrite` doesn't expand a `*` in a path, so the settings list the four package clones' `.git` folders one by one, and a new clone needs its own entry.
