---
name: review-research
description: "Verify research findings against the sources they cite, in fresh Sonnet sub-agents that quote each source verbatim. Takes a /research Markdown file or a writing Research issue. Reports only; never edits the findings."
disable-model-invocation: true
---

Checks every claim in a set of research findings against the source it cites. Each source is read by a **fresh-context sub-agent** on Sonnet that never wrote the findings, so a misread or invented claim gets caught rather than trusted.

A verified source list is what `/review-piece`'s Spec axis treats as closed. That axis checks a Piece against the list; this skill checks the list against its sources.

## 1. Pin the input

The input is one of:

- **A research file**: a Markdown path from `/research`. Read it.
- **A Research issue** in `byronbroughten/writing`. Fetch it with `gh issue view -R byronbroughten/writing <n> --comments`, state its title, and take the comment that holds the findings. If more than one comment could be the findings, ask which.

If the reference is ambiguous, or the issue is a Piece rather than Research, stop and say so.

Done when the findings text is pinned and its source is stated.

## 2. Extract claims and sources

Write a numbered list of **claims** to the scratchpad. A claim is one factual statement in the findings, quoted verbatim, with the source or sources it cites. Then group the claims by source: each source gets its URL or locator and the claims that cite it. A claim citing several sources goes under each.

A claim that cites nothing is not sent to a sub-agent; list it as **uncited** for the report.

Done when every factual statement in the findings is either under a source or uncited.

## 3. Spawn the sub-agents in parallel

One sub-agent per group, `model: "sonnet"`, all Agent calls issued together in the foreground. Use one group for a short source list; split by source once it runs past about five sources, keeping each source's claims together.

Each prompt gives only that group's sources and claims, never the rest of the findings, and the brief: "Open each source yourself. For each claim, return: the claim number; a verdict of **supported**, **partly supported** (only when the claim's meaning differs from the source: a number, a hedge, a scope, an attribution or a location; say exactly what) or **unsupported**; the passage the verdict rests on, quoted verbatim from the source; and its location (section, page or heading). An ellipsis, dropped punctuation or a footnote marker is still supported; note it beside the verdict. Never paraphrase the source in place of a quote. A source you can't open or can't find the passage in, say so and mark its claims **unverified**, never supported. Under 400 words per five claims."

Done when every claim sent out has a verdict or an unverified mark.

## 4. Report

Present one table per source: claim number, claim, verdict, quote, location. A claim under several sources takes its best verdict, and the report says which source carried it. Put unverified and uncited claims in their own list after the tables.

A source is **verified** when every claim it carries is supported. Only verified sources join the list `/review-piece`'s Spec axis treats as closed.

End with the counts for each verdict, unverified and uncited included, and the worst claim: unsupported before partly supported before unverified. Do not edit the findings; the developer or the researching agent fixes them.
