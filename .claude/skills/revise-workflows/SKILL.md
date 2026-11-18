---
name: revise-workflows
description: "Revise the Workflows from their friction: mine a session, compare a Piece's Agent draft with its edited Deliverable, or triage the Friction notes, putting each proposed change to the developer as a grilling round answered yes, no or file. Invoked as /revise-workflows [code] [piece] [<session id> | <path> | the last session | <repo> <n> | <Doc> <Doc> | log]."
disable-model-invocation: true
---

Mine a [Workflow](../../../runner/GLOSSARY.md#language)'s **friction**, every place a Workflow or the machinery the Workflows share cost time or turned out wrong, and propose the changes that would spare the next session. Each Workflow has a branch file: [`code.md`](./code.md) for code, [`piece.md`](./piece.md) for a Piece. **Read only the branch files of the Workflows in scope, together in one turn**, with [`pair-mode.md`](./pair-mode.md) in pair mode and [`log.md`](./log.md) in log mode.

The spine test, applied to every candidate:

> **Propose only what a check, a tool or a doc could have given the session before it started.**

What a session _decided_ about what a feature or a Piece says belongs in a spec, an issue or a commit message. What it had to _find out_, and every ruling on how code or prose is shaped, belongs in the environment. A revision that restates conclusions has failed even if every line is true.

Do steps 0 to 3 silently. The developer sees only step 4.

## 0. Pick the mode and inputs

- **A repo and a number** (`<repo> <n>`): pair mode on the Agent draft of `<repo>#<n>`. A parent spec's number covers the whole Piece; a sub-issue's covers only its Sections.
- **Two Doc names, IDs or URLs**: pair mode on those Docs, for an older Piece with no Agent draft.
- **`log`**: log mode, on the open Friction notes.
- **A session ID or a transcript path**: session mode on that transcript.
- **"The last session"**: session mode on the newest transcript that is not your own, found by [`docs/session-transcripts.md`](../../../docs/session-transcripts.md).
- **No argument**: session mode on this session.

**`code`, `piece` or both may lead any of these to name the branches.** With none named, infer them from what the session, the Piece or the open notes touched: pair mode always takes `piece`, and log mode takes each Workflow its open notes name.

Say in one line which mode, which inputs and which branches you chose, so the developer can correct a wrong guess. In pair mode, [`pair-mode.md`'s step 2](./pair-mode.md#2-make-the-pair) says when and what the line lists.

- **Pair mode**: run [`pair-mode.md`](./pair-mode.md)'s setup before step 1; what it calls transcript mode is session mode. The diff and the decided Proposals on the spec's review lists are the evidence; transcripts give only the developer's stated reasons and the `Upstream:` line's sources.
- **Log mode**: [`log.md`](./log.md) takes the place of step 1, and its causes go on to step 2.
- **Session mode on a session that is not yours**:
  - **Read its handoff first**, if it left one ([`docs/agents/handoffs.md`](../../../docs/agents/handoffs.md#handoffs)). It says what the session was trying to do.
  - **Read the developer's turns before anything else**, with the command in [`docs/session-transcripts.md`](../../../docs/session-transcripts.md), which also says which `type:"user"` entries are the developer's. Then read the agent's turns only around the corrections.
  - **Bound the session's changes by its first and last timestamps**, and take them from `git log` and `git diff` over that window. The branch may hold other work.
  - **Check every candidate against the environment as it is now.** A later session may have changed it already; `git log` over the files a candidate would touch shows what changed since.

## 1. Hunt

Name every instance of these categories, which apply in either Workflow, and of each branch file's own kinds. Be **relentless**: the easy two surface on their own, and stopping there is the failure mode.

- **Navigation**: the session took long to find a file or a fact. A hidden dependency between files, or a missing **navigation pointer**.
- **Automated checks**: the agent made a mistake lint, a type, a test or a filesystem check could have caught. Read the repo's own check command first (its `lint` and `check` scripts, `config/eslint.js`, `config/docLint.js`), so a check that exists but sits unwired, off or scoped away is the finding, not a reinvention.
- **Coding standards**: the reviewer missed a shape the developer then had changed, or holds a rule that should be removed or clarified.
- **AGENTS.md size**: an always-loaded steering line, in the repo or the developer's global scope, that belongs in a standards file or a check instead.
- **Tool economy**: an expensive tool call that could be streamlined, or custom tooling that spends tokens badly.
- **No-ops**: a steering line that doesn't change the agent's behavior.
- **Information access**: a crucial fact the agent couldn't reach: a server log, read-only access to a service.

**Weight wrong turns heavily.** A confident claim the agent had to retract is the strongest signal there is: something here invites that specific error, and a change can disarm it for everyone after.

In your own session you observed the friction. In another's you infer it from the signals each branch file lists. **Tag each item `observed`, `diffed` (pair mode) or `guess`**: a guess is a candidate inferred only from another agent's behavior, with no developer turn behind it. If a ruling sounds situational ("for this one", "here"), quote the developer's words and leave it ungeneralized.

Done when every instance is either carried to step 2 or dropped with a stated reason. Friction you hit while revising is not the session's; report it separately, after the rounds.

## 2. Keep what passes all four tests

- **Beforehand**: could a check, a tool or a doc have given this before the session began? Conclusions, decisions and summaries fail. Rulings pass.
- **Ownership**: is it already assigned to a spec, an issue or a PR, or already in the environment now? Leave it there and say so; never write it twice.
- **Lookup**: can the next agent find it with one file read or one command? Leave it to the environment, where it can't go stale. Keep only what looking can't find: the unwritten convention, the reason behind a choice, the measurement, the gotcha no config confesses.
- **Durability**: will it still be true in three months? Counts and tallies of generated data go stale; the invariant behind them doesn't.

`piece.md` adds two tests for a prose ruling.

## 3. Route, check first, and rank

Route each kept candidate to the highest rung it can reach, and name the change that would have prevented the friction:

1. **A check**: a mechanical rule (a fixed syntax shape, a banned API, an import shape, a file location) becomes lint, a test, a hook or a CI job, whichever the repo's guardrail makes cheapest. Propose the selector or assertion and its message.
2. **A skill, a hook or a file move**: a step an agent skipped, a gate it lacked, a file that sat where nobody looked.
3. **A doc line, last**: a judgement call no check could make. The branch file names its home, and [`prose-files.md`'s map](../../../docs/agents/prose-files.md#map) names any other doc's.

- **Standards go to the reviewer.** The implementer carries the most context pressure and the reviewer the least, so a rule for the shape of code or prose lands where the review reads it, in a standards file, not in a step.
- **AGENTS.md is loaded every turn**, so it earns a line only if that line changes turn-one behavior; everything else gets a pointer at most.

**Weigh each recommendation against the Codebase Priorities, [`docs/agents/codebase-priorities.md`](../../../docs/agents/codebase-priorities.md).** Rank by the time the change would have saved.

## 4. Present, then wait

Put the proposals to the developer as rounds in [`grilling`](../grilling/SKILL.md)'s format:

- **Every round opens with one `Dropped:` line**: each candidate passed over and why, as `Dropped: <item> (owned by #123), <item> (one grep away)`.
- **One numbered question per proposal**, worded so "yes" accepts it. Its body says what went wrong, with no fix in it, and cites its evidence: `(session ab12, 22:53)` for another agent's session, the short session ID and the turn's timestamp; a pair-mode citation as `piece.md` gives it; note ids in log mode.
- **The recommended answer is the exact wording or change**: the file and the line to add or change, in a code block when it runs past a sentence. The developer is approving the edit, not the idea.
- **Order by time saved**, most first, so the developer can take the first few and stop. **A guess comes last**, its title marked `(guess)`.
- **Every question takes yes, no or file.** "File" saves the candidate as a Friction note to wait for a later triage.

An answer that opens a new question goes in the next round, in the same format. Then stop. Edit nothing until the developer answers; an agent running this skill doesn't answer for itself.

## 5. On the answers

- **Yes**: write only the approved changes. Before writing an AGENTS.md or skill line, call the Skill tool with `writing-for-agents`. Then `npx prettier --check` the touched files, and run what the branch file adds. Then ask whether to commit, and on which branch in each repo touched: the reviewed session may have left work in flight, and a revision-only commit shouldn't ride along with it.
- **File**: write the candidate as a Friction note by [`/note-friction`](../note-friction/SKILL.md)'s fields, `filed-by: developer`, its body the question's title and body.
- **No**: write nothing for it.

In log mode, then set each note's `status:` line, the one write log mode makes to a note: `addressed <link>` for a note a yes covered or step 2 of `log.md` found solved, the link to the commit, issue or doc that addresses it; `dismissed: <reason>` for one under a no, the developer's reason or `declined at triage`. A note under a file, or under no question, stays blank. Never delete a note.
