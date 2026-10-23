# Every edit happens in a workspace, never a primary checkout

Parallel sessions shared one set of checkouts, so one session's branch switch moved another's, and runs land into those same checkouts, where a session's uncommitted edit can collide with a landing. So primary checkouts stay on master and take no edits: each ticket is implemented in its own issue workspace, any other edit in a session workspace, both opened with `npm run issue:start`. `branchGuard` and the primary-edit guard deny moving or committing in a primary, and editing a path it tracks, naming `issue:start` as the way through; they decide where work happens, not whether it needs a yes.

Source: byronbroughten/byro-repo#238, byronbroughten/byro-repo#257
