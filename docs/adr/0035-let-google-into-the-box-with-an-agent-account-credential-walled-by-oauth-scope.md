# Let Google into the box with an agent-account credential walled by OAuth scope

The live aliases, `npm run app*` and `npm run dev*`, ran outside the box, so the repo code each one runs (a chore an agent wrote, `sync`'s operators, rollup) had every host, every write and the developer's `clasp` token, `cloud-platform` included, in reach; the Read deny on `~/.clasprc.json` doesn't stop a chore's own code. They now run in the box on a credential of the agent account, `byronbroughtenai@gmail.com`, with only the `spreadsheets`, `script.projects` and `script.deployments` scopes, which settings' `clasp_config_auth` names, and the box reaches only `sheets.googleapis.com`, `oauth2.googleapis.com` and `script.googleapis.com`, the hosts the verification found clasp and the Node-host transport need. This supersedes ADR 0024's consequence that Google stays outside the box; what the tier gate still asks or refuses there is in [the tier list](../targets-and-gates.md#which-tier-an-action-is-in).

Source: byronbroughten/sheets-framework#201, byronbroughten/sheets-framework#207, byronbroughten/byro-repo#564, byronbroughten/byro-repo#886, byronbroughten/byro-repo#887

## Why the agent account and these scopes

- **The agent account**, so code that skips the framework's check reaches only the spreadsheets shared with it and their bound scripts, and version history shows an agent's edits apart from the developer's.
- **No `script.scriptapp` and no `clasp run`**, since `scripts.run` needs every scope in the manifest, so the Gmail and Docs scopes planned for the app's manifest never grow this token, and the agent can't install triggers. Gmail and Drive sharing are walled by scope, not only by the gate.
- **The developer's terminal still runs as the developer**: the transport reads `clasp_config_auth` only when it is set.

## Considered Options

- **Keeping the live aliases outside the box**: rejected. It left their code the developer's whole token and the open network, and a pipe, `cd`, `$(…)` or loop beside one was refused.
- **Boxing them on the developer's `~/.clasprc.json`**: rejected. Boxed code would read a token whose scopes cover every Google API the developer can reach.

## Consequences

- **The leak path through GitHub comments is accepted.** Boxed code can paste the agent token into a GitHub comment, sheets-framework being public, as it can the GitHub token ([ADR 0024](./0024-let-github-and-the-git-folders-into-the-sandbox.md)). A leak reaches the spreadsheets shared with the agent account and lets someone push code that runs as the developer on the next trigger. Wrap-up's secret scan catches Google's refresh-token shape; revoking is on [the framework's auth page](../../packages/framework/docs/how-it-runs/auth.md#minting-the-agent-accounts-credential); comment scanning is left out.
- **Node code calling Sheets directly with the token is the accepted residue**; version history is the undo.
- **`dev:run` and the framework's `run` script are gone**: they can't work on these scopes, and outside the box they would let an agent push a function and run it as the developer with every manifest scope.
- **Revisit: once a Gmail scope joins an app manifest, reconsider free app pushes**, since a container-bound trigger runs the latest pushed code as its installer, the developer, with every manifest scope.
