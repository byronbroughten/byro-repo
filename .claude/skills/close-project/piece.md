# Closing out an Edit gate

`/close-project`'s step 2 on a piece spec: the Edit gate `<repo>#<gate>`, the one the brief's `## Edit gate` line names, closes out here once the developer has edited the Deliverable; `<spec>` is the parent `/close-project` was invoked on. The words Piece, Deliverable, Section, Agent draft and Edit gate are [`docs/pieces/GLOSSARY.md`](../../../docs/pieces/GLOSSARY.md)'s; the Agent draft's path and shape are [`docs/pieces/agent-draft.md`](../../../docs/pieces/agent-draft.md#file-format)'s.

**This file reads the Piece and writes neither the Deliverable nor the Agent draft.** The Doc is read only with `npm run doc:print -- <Doc ID>`, never a gworkspace tool, and the Agent draft only from master.

## 1. Open the gate

- The brief's `## Parent body` is the spec's: its `## Deliverable` section names the Doc's ID.
- When this session is in another workspace's entered worktree, call `ExitWorktree` with `keep`.
- Run `npm run issue:start -- <repo> <gate>` and ToolSearch `select:EnterWorktree` in one turn, then `EnterWorktree` with `path` set to the printed path. When either refuses, report its message and stop.

## 2. List the changed Sections

- Run `npm run doc:print -- <Doc ID>` bare, in a call of its own, and Write its output to a scratchpad file, `deliverable.md`; it prints each H1 as a `# <H1>` line and each H2 as a `## <H2>` line, the Agent draft's heading lines, each followed by a `<!-- headingId <id> -->` line, which you delete from `deliverable.md`.
- Write `agent-draft.md` beside it as [`to-writing-style`'s pair-mode step 2](../to-writing-style/pair-mode.md#2-make-the-pair) makes it, `<clone>` being this workspace's checkout of `<repo>`, deleting each author-mark line.
- Compare them Section by Section, by full heading path. List each Section whose text differs as changed, each heading path only the Doc holds as added and each only the Agent draft holds as struck, naming each Section by its path.

Done when every Section of both files is in the list or matched. With nothing changed, added or struck, ask whether the edit is done, saying the Doc still matches the Agent draft. A no stops here, leaving the gate and the spec open.

## 3. Offer the style mining

Ask whether to run `/to-writing-style <repo> <spec>` in pair mode on the changed Sections. On a yes, Read [`.claude/skills/to-writing-style/SKILL.md`](../to-writing-style/SKILL.md) in full by its path and follow it, since it is user-invoked; for its pair, run [pair-mode step 2](../to-writing-style/pair-mode.md#2-make-the-pair) afresh, since step 2's two files have lost the IDs it pairs by, keeping only the Sections in its scope.

Its approved edits are in the root repo, so unless `<repo>` is the root, put it on the gate's branch first with `npm run issue:promote -- <repo> <gate> byro-repo`; then make them in this workspace and commit them on the gate's branch.

## 4. Wrap up the gate

Call `ExitWorktree` with `keep`, then run `npm run wrap-up -- <repo> <gate> --closing "<the changed Sections, and the style edits committed or none>"`, adding `--no-code` when nothing was committed. A note holding `$(` or a backtick, as a Section heading may, goes in a scratchpad file passed with `--closing-file <path>` in place of `--closing`. Wrap-up lands any commits and closes the gate; on a failure, report it and stop.

Then return to `/close-project`'s step 2, which reads the brief again.
