# The piece branch

The piece Workflow's friction kinds, its two extra keep tests and its routes, beside [`SKILL.md`](./SKILL.md)'s steps. Its rulings are **prose rulings**: every place the developer rewrote, struck or rejected reader-facing prose an agent wrote ([defined in `prose-files.md`](../../../docs/agents/prose-files.md#terms)). The homes are the three style sheets, [`docs/writing-voice.md`](../../../docs/writing-voice.md), [`docs/writing-craft.md`](../../../docs/writing-craft.md) and [`docs/academic-writing-style.md`](../../../docs/academic-writing-style.md), and the grilling doc, [`docs/pieces/grilling.md`](../../../docs/pieces/grilling.md).

What a Piece _says_ (its facts, its argument, which Section goes first in this one Doc) belongs to that Piece, but the grilling question that would have drawn it out before the draft belongs in the grilling doc. A ruling on how prose sounds belongs in a style sheet, even though it was decided this session. The rule is the generalization of the edit, never the edit restated.

## Session mode's input

**The transcript is the only input.** Read no Doc comments or suggestions, and diff no Doc's current text against the agent's draft. The agent's drafts are in the transcript already, in its replies and in the `text` of its gworkspace tool calls. For a session not yours, `git log -- docs/writing-voice.md docs/writing-craft.md docs/academic-writing-style.md docs/writing-voice docs/writing-craft docs/academic-writing-style` shows what the sheets gained since.

## Hunt

Add these kinds to step 1's:

- **Rewrite**: the developer pasted back the agent's prose in their own words, or told the agent how to reword it. Set the agent's draft beside the developer's version and name each difference: a cut hedge, a split sentence, a word swapped, an example added, a list turned to prose.
- **Rejection**: the developer struck a passage, or refused a draft without saying how to fix it. Name what the struck text had that the kept text lacks.
- **Stated rule**: a preference the developer articulated. Scan their turns for "I prefer", "never", "always", "don't say", "sounds like an AI", or a correction of a phrase the agent proposed.
- **Broken rule**: a draft that broke a line the style sheets already hold, which the developer then fixed. It goes in as a sharpened line.
- **Addition**: the developer added or cut content the spec never held: a fact, a verdict, what they rely on, a before and after, which facts go first. Name the question that would have drawn it out during the grill.

**Weight repeated corrections heavily.** The same fix made twice is a habit the agent's default voice brings to every draft, and the strongest case for a rule.

In another agent's session, infer the developer's edits from:

- a developer turn that quotes or pastes prose back;
- a developer turn that names a word, a phrase or a habit;
- the agent's next draft changing in a way no turn explains, after a developer turn you skipped.

**In pair mode**, hunt the paired list from setup. Each changed paragraph is a Rewrite, a struck one a Rejection, an added one an Addition, and a fix of a line the style sheets hold a Broken rule; a Stated rule counts only where a transcript or a decided Proposal holds one. Every change after the Agent draft is a candidate, a later agent pass's included, and a heading the developer edited is hunted like any other edit; a template fix falls to Style, not rubric. Tag each item `diffed`, upgraded to `observed` where a transcript states the developer's reason. The same fix made in several places in one Piece is a repeated correction. Drop an edit the diff can't tell apart as voice or fact as `ambiguous`; a fact correction never becomes a style rule. Hunt setup's decided Proposals too, as setup sorts them, tagging each `observed`.

**A ruling on code, comments, commits, PRs, agent docs or READMEs is `code.md`'s**; read that branch too when one turns up. A ruling on a chat reply, or on a Doc meant only for the developer, is out of scope; drop it so.

## Keep tests

Beforehand reads differently here: a fact the Piece got wrong fails it, and an Addition fails for the style sheets but passes for the grilling doc when a question asked before the draft would have drawn it out. Add two tests:

- **Style, not rubric**: is it how the prose should read, not a constraint of this one Piece's venue (a word limit, a template, an assignment's required headings)? A venue constraint fails.
- **Separates**: would the agent's draft (in pair mode, the Agent draft) have broken the proposed rule? A rule the draft already follows fails: it doesn't tell the draft from the developer's edit.

## Routes

The **Craft test** splits the first two sheets: would a good writer with a different voice still follow the ruling? Yes sends it to Craft; no keeps it in Voice.

- **`docs/writing-voice.md`**: how the developer sounds, for every kind of reader-facing prose. A ruling lands here when it fails the Craft test and isn't an academic convention. One voice: never add a section per medium.
- **`docs/writing-craft.md`**: what any skilled writer does, whatever their voice: a garden path, an undefined term, new before given, a clashing idiom. A ruling lands here when it passes the Craft test and isn't an academic convention.
- **`docs/academic-writing-style.md`**: citations, academic register, academic structure. A ruling lands here only if it applies to academic work and would be wrong in a blog post or in-app text. A ruling that overrides a Voice or Craft line for academic work goes here, and says which line it overrides.
- **The rule line** goes under the style sheet's existing section that fits, in its shape: one bolded line, the rule only, plus at most a short clause of scope or its one exception ([rules file](../../../docs/agents/prose-files.md#terms)).
- **The instance** goes in the reasoning file whose row in the style sheet's "When | File" table matches the rule's topic, under a `##` heading named for the rule. Match the file's bullets, `- "<quote>" — <source>`: for a rewrite, one bullet `- Agent: "<draft>" Developer: "<version>" — session <short id>, <date>`. A pair-mode instance ends `— <repo>#<n> Agent draft, <date>` instead, `<date>` being the Agent draft commit's date; mined from two Docs, it names the agent's Doc in place of `Agent draft`. Close a new heading with `- No count was recorded; from a session.` (in pair mode, `from an Agent draft.`), and leave `docs/writing-voice/sources.md` and every "Seen in" count alone: those describe the Drive samples, not sessions.
- **A grilling question** goes in the grilling doc's `## Questions` list, in its shape: a bolded label, what to ask, and the session's instance as `(<Piece letter>: "<quote>")`, by the letter the doc's Questions lead gives the Piece, or the next free letter for a new one. The quote is the real wording, with each name, institution, amount and spec number replaced by a neutral stand-in, as the doc's examples are (`Sam`, `Example Credit Union`, `$N`). A change to the calibration step edits it in `/plan-project`'s piece branch, [`piece.md`'s step 4](../plan-project/piece.md#4-end), instead.

A prose ruling's time saved is how often the correction recurred; rank by that, and say so.

## The rounds

- **A rule and its instance are one question**, the recommended answer naming both files and both texts. A grilling-doc question comes after the style-sheet questions.
- **The body quotes what the agent wrote and what the developer did**: "the agent wrote "<draft>"; the developer changed it to "<version>"" (or struck it, or said "<their words>").
- **A pair-mode question cites `(<Piece>, <Section's heading path>, ¶<n>)`.** A `diffed` one gives your reading of the developer's reason as "likely because…", and names the `R<n>.<k>` it answers when it sits at a Proposal's site. One from a decided Proposal cites `(<repo>#<spec>, R<n>.<k>)`.
- **In pair mode, close the last round with an `Upstream:` line** naming each skill or step that added text the developer struck, and what it added, and each reverted fix, as `reverted fix <where>: <the rule it cited>`, or `Upstream: none found.` File and edit nothing for it; the developer decides whether to follow up.

## On the answers

The Agent draft stays as `/implement-piece` committed it, and the edited Deliverable stays in its Doc, in both modes. After the writes, run `npm run lint` too.
