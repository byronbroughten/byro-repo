# Security measures accommodate routine commands, not the other way around

Agents kept meeting asks, sandbox denials and Hand-backs on commands they run all through their work: a process listing, opening a built file, deleting a dead hook file, pushing a `research/*` branch. Each stop was answered by the developer, or by a changed workflow, while the measure behind it stayed as it was. Now a command category the prompt scan shows recurring is routine. When it meets a security measure, the Recommendation reshapes the measure so the command runs, through a sanctioned route that keeps what the measure protects, and a Hand-back or a changed workflow is the last resort. The floor stands: any weakening a reshape leaves is named and left to the developer.

Source: ByronBroughten/byro-repo#588

## Considered Options

- **Ranking routine use above the floor**: rejected, since an agent would then settle a security trade-off by itself, and the developer's decisions stay theirs.
- **Keeping the measures fixed and cutting stops one prompt-scan row at a time**: rejected, since the scan saw only asks, so a sandbox denial that became a Hand-back went uncounted, and each fix bent the command around the measure.

## Consequences

- The stops nothing in the repo can answer stay: Claude Code's protected-path prompts on file-tool edits and its built-in removal check. The scan counts them, and a recurring one gets a doc line teaching the habit that avoids it.
- Fixing a gate misread, where the gate judged a command to be something it isn't, doesn't move an action to a cheaper tier, so it isn't a floor change.
