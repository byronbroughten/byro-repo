# Writing style

The developer's voice for reader-facing prose ([defined in `prose-files.md`](./agents/prose-files.md#terms)), drawn from their own writing; academic work layers [`academic-writing-style.md`](./academic-writing-style.md) on top. It calls its reader "the reader", and says "app user" only for the app's user.

One line per rule. The quoted instances and their sources are one file away. Open a reasoning file only when you're changing the rule, or the rule's line doesn't decide your case.

## Reasoning files

| When | File |
| --- | --- |
| A figure, a calculation, a projection or a caveat | [`docs/writing-style/numbers.md`](./writing-style/numbers.md) |
| An example, a comparison, a term, a reason | [`docs/writing-style/explaining.md`](./writing-style/explaining.md) |
| A feature, a competitor, the product's story | [`docs/writing-style/product.md`](./writing-style/product.md) |
| A hedge, a weakness, a trade-off | [`docs/writing-style/candor.md`](./writing-style/candor.md) |
| A section opening, a recommendation, a list | [`docs/writing-style/structure.md`](./writing-style/structure.md) |
| Sentence length, dashes, colons, connectives | [`docs/writing-style/sentences.md`](./writing-style/sentences.md) |
| Person, contractions, word choice | [`docs/writing-style/register.md`](./writing-style/register.md) |
| Where the rules came from, or what was dropped | [`docs/writing-style/sources.md`](./writing-style/sources.md) |

## Numbers and evidence

- **After a figure, say in the next sentence what it means for the reader.**
- **Show arithmetic step by step in prose, then state the total in its own short sentence.**
- **State the assumption behind a projection inline, and call it conservative when it is.**
- **Give the exact figure, then a rounded, human-scale equivalent.**
- **Write numbers as numerals with $ and %, and ranges with a hyphen.**
- **Make a caveat specific: say how far off, or in which range**, not just "may be inaccurate".

## Explaining

- **Make an abstract point concrete at once with "For example," and an everyday scenario with real nouns.**
- **Explain an unfamiliar idea by comparing it to something the reader already knows.**
- **Restate a dense or technical point in plain words with "In other words,".**
- **Spell out an acronym on first use with the short form in parentheses, then use only the short form.**
- **Gloss a term inline with "i.e.," rather than in a separate sentence.**
- **Before the real answer, name the tempting wrong reading and correct it.**
- **Back a claim with an explicit reason: "After all," or "That's because".**
- **Put a cause-and-effect pair before the principle it supports.**

## Describing the product

- **Describe a feature by what app users do ("Users can…"), not by what the system is.**
- **Introduce a feature as a label, a colon, and one or two sentences on what it does.**
- **Say plainly where the product falls short of a competitor, without spin.**
- **Open with the concrete backstory that led to the product, then name it.**
- **Lean on the product's value words: precise, intuitive, modern, flexible, minimal data entry.**

## Confidence and candor

- **Hedge only predictions, causes and plans, one hedge per claim at most; state facts, decisions and verdicts flatly.**
- **Admit a weakness or limit in one flat clause**, often with "however" or in a parenthetical.
- **Weigh a point's upside and risk together ("On the one hand… On the other hand…").**
- **Turn to a caveat or exception with "That said," or "Still,".**

## Structure and recommendations

- **Open a section with one sentence stating its claim, then support it.**
- **State the recommendation early and flatly, then give the reasons.**
- **Lay out each option's pros and cons, then eliminate options until the recommendation is left.**
- **Phrase advice to its subject as "should" or "would do well to", not a passive "it is recommended".**
- **Number parallel reasons in prose ("First, … Second, … And third, …") when each needs a sentence or more.**
- **Use bullets only for short parallel items; keep reasoning in prose.**
- **Put a side point in its own "Note that…" sentence.**

## Sentences and punctuation

- **Let explanatory sentences run long, then land the point with a short, blunt one.**
- **Use paired em dashes for a mid-sentence aside or example list when commas would confuse.**
- **Put a colon after a verdict, then the explanation.**
- **End an open-ended list of everyday examples with "etc." or "and so on".**
- **Link sentences with plain connectives such as "Additionally" and "Finally"; "Conversely", "To that end" and "albeit" are fine too, but "Furthermore" and "Moreover" are academic.**

## Person and register

- **In product prose, name the product ("DealLab", "the app") and call its readers "users".**
- **In a spoken script or less formal piece, guide the reader with "we" and "let's".**
- **Use contractions ("isn't", "doesn't", "that's") in plain prose.**
- **Prefer plain words to Latinate ones**, unless the Latinate word says the meaning more precisely.
