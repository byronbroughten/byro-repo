# Handing a judgement to Jev

TypeSafe's Jev model answers narrow, typed questions about a text, with probabilities, for a tiny fraction of the session model's cost and in under a second. `npm run jev` hands it a request file and prints the answers. This doc says when that is the right call, how to make it, the version pin, and what may be sent.

## When to hand a judgement to Jev

- **The judgement is narrow and typed**: a yes/no (`noul`), one of a few named options (`choice`), or a place on a short scale (`score`).
- **There are many of them at once**, such as every paragraph against every rule. One request carries the text once and all the questions, so the text is charged once.
- **A wrong answer is cheap**: a person or a later step reviews the results, or one miss among many changes nothing.

## When not to

- **Writing text.** Jev answers questions; it never produces prose, a fix or an explanation.
- **Multi-step reasoning.** A judgement that needs a plan, a chain of inferences or a look at code stays with the session model.
- **A costly single wrong answer.** A gate, a write, a deletion or anything shipped on one answer stays with the session model or the developer.

## Calling it

Write the request to a file in your scratchpad and pass its path. Never put the text on the command line, where the shell can cut or mangle it.

```sh
npm run jev -- <request.json>
```

The file is `{ state, questions }` in the TypeSafe HTTP API's shape (the [TypeSafe docs](https://docs.typesafe.ai/)): `state` is text or JSON, and each question has a `type` (`noul`, `choice` or `score`), `instructions` and, optionally, `criteria`. A `model` field is ignored in favour of the pin.

```json
{
  "state": { "paragraph": "..." },
  "questions": {
    "usesPassive": {
      "type": "noul",
      "instructions": "Does the paragraph use the passive voice?",
      "criteria": { "true": "It uses the passive voice.", "false": "It does not." }
    }
  }
}
```

Stdout is `{ answers, usage }` as JSON: a `noul` answer carries `noul`, the probability of yes; `choice` and `score` answers carry their pick, `confidence` and `probabilities`. `usage` gives the input and output tokens, for reporting what a judgement cost.

The key comes from `TYPESAFE_API_KEY` in the developer's shell profile, never the repo. When it is missing, the run stops and says so; tell the developer, and note that a session started before the key was added won't see it. The client lives in `scripts/jev/`, with `JevClient` as its one test seam.

## The style check

`npm run jev:style` checks a Deliverable against [`docs/writing-style.md`](../writing-style.md) and prints a ready-made `## Jev style` section: one line per flag (band, probability, rule, the paragraph's first words), then a count line. It asks one yes/no per (paragraph, rule) pair; 0.7 or higher is `breaks`, 0.5 to under 0.7 is `unsure`, and lower answers are left out. The full answers go to `jev-style.json` beside the Deliverable.

```sh
npm run jev:style -- --deliverable <deliverable.md> --style <style.md> [--section "<heading>"]…
```

- **The Deliverable** is Markdown. Each list item is a paragraph and headings are skipped. With `--section`, only paragraphs under each heading, matched exactly, are judged; the whole Deliverable is still sent for context. A heading that isn't found stops the run.
- **The Style file** holds `Evidence:`, `Formality:` and `Academic:` lines, an optional `Kind:` line on what the Piece is, then an `## Overrides` heading with the spec's overrides, Form and Order verbatim; without Form and Order, a letter's required closing ask reads as a late recommendation. The heading is required, empty when the spec has none, so a Style file that lost its overrides stops the run instead of over-flagging. `Academic: yes` adds [`docs/academic-writing-style.md`](../academic-writing-style.md)'s rules.
- **Position rules**, the opening and closing rules listed in `scripts/jev/styleRules.ts`, are judged only at their place. A reworded rule that no entry matches stops the run; update the list.

## The pin and upgrading it

**Every request goes to the version in `jevPin`, in `scripts/jev/JevClient.ts`**, so results stay comparable across runs. Each run also asks which version `jev-latest` resolves to, and when it differs it prints one stderr line: `jev-X is out; pinned to <pin>, see the Jev agent doc`. Pass that line on to the developer; don't bump the pin yourself. A failed check prints its own stderr line and still prints the answers.

To upgrade, with the developer's yes:

1. Re-run the Pieces listed in the [Jev trial log](./jev-trial.md), this procedure's evidence, on the new version.
2. Compare its flags with the logged ones and the developer's rulings.
3. Bump `jevPin` only if the new version does at least as well. Otherwise leave the pin and record why.

## What may be sent

**Agents have a standing yes to send Deliverable text and repo docs to TypeSafe with `npm run jev`, without asking.** It never covers secrets, `.env` files or credential files: never put their contents, or any text copied from them, in a request. Anything else outside the repo and the Deliverable asks first. The gate row: [`docs/targets-and-gates.md`](../targets-and-gates.md#targets-dev-and-app).
