---
name: close-piece
description: "Close out a Piece on its Edit gate once the developer has edited the Deliverable: list the Sections they changed against the Agent draft, offer a pair-mode /to-writing-style, wrap up the gate and close the spec when nothing is left. Invoked as /close-piece <repo> <n>, <n> being the Edit gate."
argument-hint: "<repo> <n>"
disable-model-invocation: true
---

`/close-piece <repo> <n>` closes out the Edit gate `<repo>#<n>` and, when nothing else is left, its piece spec. The words Piece, Deliverable, Section, Agent draft and Edit gate are [`docs/pieces/GLOSSARY.md`](../../../docs/pieces/GLOSSARY.md)'s; the Agent draft's path and shape are [`docs/pieces/agent-draft.md`](../../../docs/pieces/agent-draft.md#file-format)'s.

**This skill reads the Piece and writes neither the Deliverable nor the Agent draft.** The Doc is read only with `npm run doc:print -- <Doc ID>`, never a gworkspace tool, and the Agent draft only from master.

Give Bash one command per call, run from the current directory: no `cd`, no `;` or `&&` chains, no variables.

## 1. Open the gate

- Run `npm run issue:read -- <repo> <n> --body` and take the spec's number from its `Parent:` line. Then `npm run issue:read -- <repo> <spec> --body`: its `Labels:` line holds `piece`, and its `## Deliverable` section names the Doc's ID. A gate with no parent, or a spec without `piece`, stops here, saying so.
- Run `npm run issue:start -- <repo> <n>` and ToolSearch `select:EnterWorktree` in one turn, then `EnterWorktree` with `path` set to the printed path. When either refuses, report its message and stop.

## 2. List the changed Sections

- Print the Doc with `npm run doc:print -- <Doc ID>` into a scratchpad file, `deliverable.md`, with each Section heading as `## <heading text>`.
- Write `agent-draft.md` beside it from the spec repo's master: `git -C <clone> fetch origin master`, then `git -C <clone> show origin/master:writing/agent-drafts/<spec>.md`, deleting each author-mark line.
- Compare them Section by Section, by heading. List each Section whose text differs as changed, each heading only the Doc holds as added and each only the Agent draft holds as struck.

Done when every Section of both files is in the list or matched. With nothing changed, added or struck, ask whether the edit is done, saying the Doc still matches the Agent draft. A no stops here, leaving the gate open.

## 3. Offer the style mining

Ask whether to run `/to-writing-style <repo> <spec>` in pair mode on the changed Sections. On a yes, Read [`.claude/skills/to-writing-style/SKILL.md`](../to-writing-style/SKILL.md) in full by its path and follow it, since it is user-invoked; for its pair, use step 2's two files in place of its own Doc read, keeping only the Sections in its scope.

Its approved edits are in the root repo, so unless `<repo>` is the root, put it on the gate's branch first with `npm run issue:promote -- <repo> <n> byro-repo`; then make them in this workspace and commit them there, without its ask about the branch.

## 4. Wrap up the gate

Call `ExitWorktree` with `keep`, then run `npm run wrap-up -- <repo> <n> --closing "<the changed Sections, and the style edits committed or none>"`, adding `--no-code` when nothing was committed. Wrap-up lands any commits and closes the gate; on a failure, report it and stop.

## 5. Close the spec

Read the spec again with `npm run issue:read -- <repo> <spec>` for its sub-issues and their states, and read its review lists by [`/judge-findings`' step 1](../../../runner/skills/judge-findings/SKILL.md#1-read-the-list), counting each unticked box as undecided and resolving `<owner>/<repo>` as it does.

- **Every sub-issue closed and no item undecided**: `gh issue close -R <owner>/<repo> <spec> --comment "The Edit gate #<n> is closed, every sub-issue is closed and every review-list item is decided."`, then prompt the developer to run `/mine-outcomes <repo> <spec>`. Run nothing more.
- **Otherwise**: leave the spec open and report what is left: open sub-issues by number, and undecided items by `R<n>.<k>`, which `/judge-findings <repo> <spec>` settles.
