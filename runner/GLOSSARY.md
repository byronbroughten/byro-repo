# Spec runner

The runner takes a spec's tickets through agent steps unattended and hands the developer only what needs a person. The words below are what its records, comments and pushes call the parts of a run, and how a spec is split for one.

## Language

**Runner**:
The program that runs one spec: it picks each ready ticket in turn, launches its steps, lands it and posts its review list. It never closes the spec.
_Avoid_: orchestrator, driver, pipeline

**Step**:
One stage of a ticket's run, in order: implement, review, finding triage, fix, checks and wrap-up, with the gap check once at the end of the spec. An agent step is one `claude -p` session; checks and wrap-up the runner does itself.
_Avoid_: phase, stage, job

**Record**:
The structured output an agent step returns, validated against the runner's schema: the implement record from the implement step and one triage record per finding from finding triage. A record failing the schema gets one retry.
_Avoid_: report, result, output

**Finding triage**:
The step after review that gives each review finding a verdict, as one triage record. It is skipped when review finds nothing.
_Avoid_: classification, judging

**Triage agent**:
The fresh agent session that runs finding triage. It also fixes the Fix batch when the implementer's peak context is past ~150K, or after a fixer is killed at ~180K.
_Avoid_: judge, reviewer

**Verdict**:
What finding triage decides for one finding: Dismiss, Fix, Defer or Halt.
_Avoid_: ruling, outcome

**Dismiss**:
The verdict that takes no action, with a reason: `false-positive`, `covered-later`, `won't-fix` or `tooling-enforced`. Dismisses appear in the review list's collapsed audit.
_Avoid_: ignore, reject

**Fix**:
The verdict that the finding gets fixed now, in a separate fix commit. It needs a quoted `file:line` and the documented rule or spec line it breaks.
_Avoid_: accept, apply

**Defer**:
The verdict that leaves the finding for the developer on the review list: `decision` for a judgement only they can make, or `ticket` for a pre-existing problem, with a drafted issue title.
_Avoid_: postpone, backlog

**Halt**:
The verdict that blocks the tickets in its scope until the developer answers: named later tickets and their downstream, or `spec`. It is posted as a spec-issue comment and a push.
_Avoid_: pause, block, question

**Failure Halt**:
A Halt raised because a step failed, not by a verdict: a second crash, a schema failure, red checks after a retry, an implement step's turn cap. It offers `retry` and `stop spec`, and free text such as `rerun on <pair>` or `skip`.
_Avoid_: error, crash

**Stop**:
The run ends on a failure no answer can fix inside the run: GitHub or `claude` unreachable or logged out, a clone missing or dirty, a red master, every account past its weekly reserve, or a runner exception. Rerunning resumes it.
_Avoid_: abort, exit, kill

**Limit wait**:
The run pauses until the earliest 5-hour usage reset plus a margin, because every account is past its 5-hour threshold, then continues unaided.
_Avoid_: cooldown, throttle

**Review list**:
The comment the runner posts on the spec issue for each landed ticket with a Defer, one checkbox per Defer and the Dismisses in a collapsed audit. The gap check posts the last one.
_Avoid_: todo list, report

**Gap check**:
The step at the end of a spec that lists what the spec asked for that no landed ticket covered, with drafted follow-ups. Its output is the final review-list comment.
_Avoid_: audit, retro

**Primary checkout**:
A repo's one long-lived clone. Tickets land into it and are never implemented in it.
_Avoid_: main repo, root clone

**Issue workspace**:
A disposable set of checkouts, one per repo, where one ticket is implemented.
_Avoid_: ticket worktree, sandbox

**Master set**:
A disposable set of checkouts, one per repo, each detached at its master, rebuilt for each preflight so the checks see master's commits and nothing uncommitted.
_Avoid_: clean checkout, master workspace

**Phase**:
A batch of a spec's tickets that can be used in real work, ending where that use could change or cancel what follows. Not a tracer bullet: a Phase is usually several.
_Avoid_: stage, milestone, step

**Phase gate**:
The developer's ticket that closes a Phase. It tests what the Phase built and decides whether the next Phase goes ahead, changes or is dropped.
_Avoid_: checkpoint, gate (bare), kill point

## Same word, two meanings

- **Runner**: here, the program that runs a spec. In the framework's glossary, an endpoint whose checkbox is a run button.
