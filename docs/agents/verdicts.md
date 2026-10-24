# Verdicts

How any review finding is judged: one verdict each, Dismiss, Fix, Propose or Halt. The code-review skill's reviewers suggest one per finding and the resolve step settles it.

One line per rule. The reasoning and worked examples are one file away. Open a reasoning file only when you're changing the rule, or the rule's line doesn't decide your case.

## Reasoning files

| When | File |
| --- | --- |
| A smell: fixing it, keeping it, a stale keep reason, an approved exception | [`docs/agents/verdicts/smells.md`](./verdicts/smells.md) |

## The verdicts

- **Dismiss**: no action, for one of these reasons, each with evidence:
  - `false-positive`: the finding is wrong about the code, the ticket or the spec.
  - `covered-later`: a later ticket covers it, named as `<repo>#<n>`.
  - `kept`: a Standards finding whose site carries a one-line reason that is still true, quoted with its `file:line`.
  - `tooling-enforced`: lint, the typecheck or a test already catches it.
  - `serves-spec`: scope creep that serves a user story the spec has, named in the evidence.
- **Fix**: fixed now, quoting the code or text with its `file:line` and naming the documented rule or spec line it breaks. Doc drift the diff caused is a Fix.
- **Propose**: left for the developer, with a recommendation. `decision` is a judgement only they can make, unverifiable findings included; `ticket` is a problem that predates this branch, with a drafted issue title.
- **Halt**: blocks the spec's scope, the named later tickets with their downstream or the whole spec, until the developer answers. In a run it posts on the spec; in an interactive session it is answered there.

## Standards findings

- **Standards findings, smells included, share one rule: Fix by default**, the way the review's how-to-fix line for a smell says.
- **A documented standard overrides the smell baseline**: where it endorses what the baseline flags, the smell is suppressed, not Proposed.
- **A finding is `kept` only for an external constraint**: a library's or API's required shape, or generated code. Its site carries a one-line reason that is still true.
- **Every new keep needs the developer's yes**: a finding an external constraint forces, whose site carries no reason, is a Propose `decision` with the drafted one-line reason.
- **A reason that's no longer true makes the finding fresh.** Re-check a kept reason when the diff touches its site or what the reason relies on.
- **Two documented standards in conflict is a Propose `decision`.** A conflict with the spec follows the Halt rules.

## Spec findings

- **A Spec finding is never `kept`.** One not fixed is Dismiss `covered-later`, `serves-spec` or `false-positive`, a Propose `decision` or a Halt, each with evidence.
- **Scope creep is Dismiss `serves-spec`** when the addition serves a user story the spec has, and the evidence names it. It is a Propose `decision` when it adds public surface or observable behaviour no story asks for. Otherwise it is a Fix that deletes it.
  - **Public surface**: a package's declared public entries, a CLI command or flag, a run knob or config key, a sheet, column or endpoint, or text the runner posts. An exported member used only inside its own package is not.
  - **Observable behaviour**: what the developer or an operator sees without reading code: terminal output, files written outside gitignored state, GitHub writes, what the sheet shows.

## Halt

**Halt when the spec is wrong.** Binding means a User Story or an Implementation Decision, never Further Notes or sketches. A spec protects decisions, not wording: a fix that changes how a decision is met while the decision still holds is a Fix.

- The spec is internally incoherent or inconsistent.
- A binding part *necessarily* breaks a documented standard, or meeting it would break another spec's decision or a guardrail. Where some way of meeting the decision avoids the break, it is a Fix.
- A premise about the codebase is false and that changes what gets built. Otherwise it is a Fix, plus a Propose `ticket` where the spec text needs correcting.

## Overruling a suggested verdict

A suggested verdict may be overruled with a reason. A suggested Halt becomes only a Halt, of any scope, or a Propose `decision`.

## Approved exceptions

Recurring keep reasons the developer has said yes to. Each suspends the rule it names, everywhere it applies.

- **Suspends Speculative Generality: a public member with no callers is kept only in a library package** (the framework and utils packages), unless another member does the same job with the same or fewer parameters, and within one only where its style doc allows. In an app package (real-estate, runner) it is flagged; an older caller-less member found there predates the branch, so it is a Propose `ticket`. Types are left out: an exported type with no callers is flagged.
- **Suspends Middle Man: a type in use stays even when it only names another type, a primitive or a literal union** (`type SheetGid = number`).
