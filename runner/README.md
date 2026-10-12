# @byronbroughten/spec-runner

Runs a spec's tickets through implement, review, finding triage, fix, checks and wrap-up, one agent step at a time, and leaves the developer a review list. It imports nothing from the repo around it: everything repo-specific is injected config, so it can be split out later. Its words are in [`GLOSSARY.md`](./GLOSSARY.md).

| Export | What it is |
| --- | --- |
| `@byronbroughten/spec-runner/contextMeter` | `ContextMeter`: a session's peak context, the most input + cache-read + cache-creation tokens any one main-loop assistant message carried, counting each message id once. Feed it stream-json events with `observe()` and read `peak`, or pass a whole transcript to `ContextMeter.ofTranscript()`. |

## Tests

Vitest, in the root's `tooling` project: `npm test` from the repo root, or `npx vitest run runner` for just these. `npm run tsc` and `npm run lint` from the root reach it too.
