---
status: accepted
---

# Text a run's step writes from Trusted text alone is Trusted, and an Arbiter ticket doesn't trip containment

A ticket the Arbiter files becomes instructions for a later implement step, but it is neither text the developer wrote nor text they approved word for word. [Trusted text](../../runner/GLOSSARY.md) now also covers text a run's step writes from Trusted text alone, carrying the runner's mark. The runner's code refuses a filing whose evidence or citations reach a path outside the developer's clones or inside a dependency folder. This is a named weakening of security, which the developer accepted.

Source: byronbroughten/byro-repo#678

## Why

- A resolver already Fixes from a reviewer's text with nobody approving it, so runs already act on agent text drawn from Trusted inputs. This extends that chain by one step.
- Making the developer approve each filed body word for word would keep the rubber stamp that [ADR 0026](./0026-the-arbiter-rules-only-by-a-rule-the-developer-approved.md) removes.

## Consequences

- [ADR 0007](./0007-keep-untrusted-text-out-of-instructions-and-defer-containment.md)'s first containment trigger, "the runner starts working tickets the developer didn't write", is narrowed to tickets whose text came from someone other than the developer. An Arbiter ticket filed behind the path check doesn't trip it, so ADR 0007 stays accepted and containment keeps waiting.
- Until containment is built, an implement step misled by a bad Arbiter ticket could still write to GitHub from inside the sandbox. That is [ADR 0024](./0024-let-github-and-the-git-folders-into-the-sandbox.md)'s accepted risk, left to #520.
- The path check is the runner's code, never the agent's own claim about where its evidence came from.
