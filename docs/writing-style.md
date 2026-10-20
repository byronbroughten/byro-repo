# Writing style

The developer's voice for reader-facing prose ([defined in `prose-files.md`](./agents/prose-files.md#terms)), drawn from their own writing, plus the rules they endorsed from Strunk and White's *The Elements of Style*; academic work layers [`academic-writing-style.md`](./academic-writing-style.md) on top. It calls its reader "the reader", and says "app user" only for the app's user.

One line per rule. The quoted instances and their sources are one file away. Open a reasoning file only when you're changing the rule, or the rule's line doesn't decide your case.

## Axes

Each Piece takes one value on each axis, and its spec names them. A rule tagged with a value, as `` `formal` ``, applies only to a Piece with that value; an untagged rule applies to every Piece. Text with no spec is `firsthand` and `general`.

- **Evidence**: `firsthand` cites nothing; `sourced` names a published source in the sentence; `cited` cites in APA 7.
- **Formality**: `general` is for a general audience; `formal` is for a formal one, as a sworn letter.
- **Academic**: a `cited`, `formal` Piece that also follows [`academic-writing-style.md`](./academic-writing-style.md).

## Reasoning files

| When | File |
| --- | --- |
| A figure, a calculation, a projection or a caveat | [`docs/writing-style/numbers.md`](./writing-style/numbers.md) |
| An example, a comparison, a term, a reason | [`docs/writing-style/explaining.md`](./writing-style/explaining.md) |
| A borrowed fact, a quote | [`docs/writing-style/borrowing.md`](./writing-style/borrowing.md) |
| A feature, a competitor, the product's story | [`docs/writing-style/product.md`](./writing-style/product.md) |
| A hedge, a weakness, a trade-off | [`docs/writing-style/candor.md`](./writing-style/candor.md) |
| A section opening, a recommendation, a list | [`docs/writing-style/structure.md`](./writing-style/structure.md) |
| Sentence length, dashes, colons, connectives | [`docs/writing-style/sentences.md`](./writing-style/sentences.md) |
| Person, contractions, word choice | [`docs/writing-style/register.md`](./writing-style/register.md) |
| Where the rules came from, or what was dropped | [`docs/writing-style/sources.md`](./writing-style/sources.md) |

## Numbers and evidence

- **After a figure, say in the next sentence what it means for the reader, unless its size is already plain; never just compare it with a second figure.**
- **Show arithmetic step by step in prose, then state the total in its own short sentence, unless the last step already reaches it; never state the same figure twice.**
- **State the assumption behind a projection inline, and call it conservative when it is.**
- **Give the exact figure, then a rounded, human-scale equivalent, such as the cost per month.**
- **Write numbers as numerals with $ and %, and ranges with a hyphen.**
- **Make a caveat specific: say how far off, or in which range**, not just "may be inaccurate".
- `firsthand` **Cite no published source.**
- `sourced` **Name a statistic's source in the same sentence ("according to Redfin", "per Bankrate").**
- `cited` **Cite every borrowed fact in APA 7, per [`academic-writing-style.md`](./academic-writing-style.md).**
- **Restate a borrowed fact in your own words and sentence shape: no run of four or more words from a passage you read for it.** Proper names, fixed terms and runs of common function words don't count.
- **Quote only when the wording is notably better than any paraphrase, in quotation marks, naming who said it.**
- **Show what a choice is worth by changing one input in a baseline example and stating the dollar change per month.**

## Explaining

- **Make an abstract point concrete at once with "For example," or "For instance," and an everyday scenario with real nouns.**
- **Explain an unfamiliar idea by comparing it to something the reader already knows.**
- **Restate a dense or technical point in plain words with "In other words," or "That is to say,", never after a figure the reader just watched you work out.**
- **Spell out an acronym on first use with the short form after it ("capital expenses, or CapEx," or "(CapEx)"), then use only the short form.**
- **Gloss a term inline with "i.e.," rather than in a separate sentence.**
- **Before the real answer, name the tempting wrong reading or the reader's obvious objection, often as a question ("why doesn't everyone just…?"), and answer it.**
- **Back a claim with an explicit reason: "After all," or "That's because".**
- **Put a cause-and-effect pair before the principle it supports.**
- **Define a factor in one plain sentence, then say which way it moves the result ("A longer loan term means lower monthly payments").**
- `general` **Back a tip with a short first-person anecdote ("I was once quoted…"), in parentheses, with its real figures.**
- **Back praise of a person or thing with what the writer relies on it for ("His reliable quotes are the basis on which I decide whether to invest").**
- **Show a change with its before and after side by side, each described concretely ("the dingy, rundown space… into the warm, welcoming home").**

## Describing the product

- **Describe a feature by what it lets its user do ("lets you line up homes side-by-side"; "Users can…" when the reader isn't the user).**
- **Introduce a feature as a label, a colon, and one or two sentences on what it does.**
- **Say plainly where the product falls short of a competitor, without spin.**
- **Open with the concrete backstory that led to the product, then name it.**
- **Lean on the product's value words: precise, intuitive, modern, flexible, minimal data entry.**

## Confidence and candor

- **Hedge only predictions, causes and plans, one hedge per claim at most; state facts, decisions and verdicts flatly.**
- **Keep a qualifier ("rather", "very", "relatively", "generally") only when it states a real limit.**
- **Admit a weakness or limit in one flat clause**, often with "however" or a closing "though", or in a parenthetical.
- **Weigh a point's upside and risk together ("On the one hand… On the other hand…").**
- **Turn to a caveat or exception with "That said,", "Of course," or "Still,".**
- **Let the specifics show a piece is trustworthy; never vouch for the piece itself ("Everything in this letter is firsthand").**
- **State a point plainly; never talk up its importance with an intensifier ("markedly"), a label that announces it ("is deliberate:") or a "therefore" the logic already carries.**
- `general` **When a figure is discouraging, reassure the reader and point to the fix ("don't despair just yet").**

## Structure and recommendations

- **Open a piece with a striking figure or a blunt claim, then say in one sentence what the piece covers.**
- **Right after the opening, say what the piece doesn't cover and where to find it.**
- **Open a section with one sentence stating its claim at full strength ("I can say without a doubt…"), not a topic label ("His work is broad.") or an announcement of what the section does ("This section identifies…"), then support it.**
- **State the recommendation early and flatly, then give the reasons.**
- **Lay out each option's pros and cons, then eliminate options until the recommendation is left.**
- **Advise the reader in the imperative, "you'll want to" or "we recommend"; advise a third party with "should" or "would do well to", never a passive "it is recommended".**
- **Number parallel reasons in prose ("First, … Second, … And third, …") when each needs a sentence or more.**
- **Use bullets for short parallel items (costs with their figures, tips, one-sentence reasons after "Here's why:"); keep multi-sentence reasoning in prose.**
- **Put a side point in its own "Note that…" sentence.**
- **Make each point once, with the support it needs; cut a second calculation, a source's side conclusion or a rule's fine print that only reinforces or qualifies it.**
- **Once a fact or mechanism is set out, refer back to it by a short name ("the Build gate", "Table 2") instead of explaining it again, and only when the reader needs it to follow the point, never to show that sections agree.**
- **Don't preview the items that the next paragraphs take up one by one.**
- **Add a table only when the developer or the assignment asks for one, and never one that restates the prose.**
- **State an assumption the rest of the piece shares once, where it first applies, and say there that it holds throughout.**
- **End a section on its weightiest point; when one short sentence can tie its points together (what they share, how they trade off, how they sort, or what they add up to), close with that instead, never with one that retells the points in turn or echoes the section's opening.**
- **Close by returning to the opening question or figure, answer it, and say what makes the answer vary for the reader.**

## Sentences and punctuation

- **Let explanatory sentences run long, then land the point with a short, blunt one, at most once a paragraph and never as its opener.**
- **Say the thing directly, cutting any wrapper phrase that carries no meaning ("the mitigation strategy for if…", "which is", "it is assumed that", "aforementioned").**
- **Combine a run of short sentences that build one point into a single sentence; arithmetic keeps its steps.**
- **Never put a short sentence before a calculation or example that only names what it will show ("A rate rise cuts the return."); let the sentence that shows it say so.**
- **Write an event as a clause with its own verb ("when estimates are made"), not a packed noun phrase ("the Planning estimates"), even when the clause runs longer; split a sentence whose modifiers nest into plain joined clauses.**
- **Use the active voice, unless the actor is unknown or beside the point.**
- **Use the serial comma ("reliability, trustworthiness, and ingenuity").**
- **Order a list to build, ending on its weightiest item ("in my rental units, around my tenants, and in my home").**
- **Use paired em dashes for a mid-sentence aside or example list when commas would confuse.**
- **Put a colon after a verdict, then the explanation; when the words before the colon only signal that a reason follows ("is deliberate:"), write "because" instead.**
- **Give a punchline, consequence or comparison its own sentence, not a trailing em dash.**
- **Start a sentence with "And" or "But" to add a point or turn on one.**
- **End an open-ended list of everyday examples with "etc." or "and so on".**
- **Never reuse one stock phrase, such as "In other words,", in sentences or paragraphs in a row.**
- **Link sentences with plain connectives such as "Additionally" and "Finally"; "Conversely", "To that end" and "albeit" are fine too, but "Furthermore" and "Moreover" are academic.**

## Person and register

- `general` **Address the reader as "you", speak as "we", and guide with "let's"; name the product, and say "users" only when describing app users to someone else.**
- `general` **Use contractions ("isn't", "doesn't", "that's").**
- `formal` **Write no contractions.**
- **Prefer plain words to Latinate ones.**
- `formal` **Keep a Latinate word that says the meaning more precisely ("corroborates").**
- **Call the person a piece is about by name, not "he" or "him", in each paragraph's claim and key sentences**, so no reader wonders who is meant.
- **Give a phase, stage or deadline its noun ("the Build phase", "the finish date"), not a bare shorthand ("Build", "the finish"), and never make it the actor ("what Planning can see").**
- `general` **Prefer everyday idioms, often slightly twisted ("blow out of the pond"), to neutral business phrasing.**
- `general` **Allow the occasional wry aside, in parentheses or between dashes.**
