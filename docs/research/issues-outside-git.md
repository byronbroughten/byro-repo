# Issues kept outside git: safety, sharing across sessions, phone write-back (personal#82)

Researched 2026-11-19 from official docs, specs and source code. It builds on `markdown-issue-trackers.md` (personal#75) and doesn't repeat it. Every claim cites its source. Claims I couldn't check against a primary source are under Unverified.

## Answer

**1. Today's pattern, generalised.** The friction-note write is safe for creates only: it takes a new file with `wx` (`runner/src/frictionNotes.ts:61-69`, `:132-143`). Tools that hold mutable records add three things:
- A lock-then-rename write: git takes `<file>.lock` with `O_CREAT|O_EXCL`, then renames it over the file.
- A compare-and-set claim: beads `--claim`, `--if-assignee` and `--if-status`, which exit 13 when another actor won.
- A lease with a TTL and a heartbeat, so `bd reclaim` frees a dead agent's claim.

The repo already has `wx` pid locks with a takeover guard (`runner/src/PidLock.ts:1-4`). Concurrent edits get either one writer at a time (SQLite WAL, beads embedded mode) or a per-record log of operations, folded into state (git-bug).

**2. Durability.** The Sheet sync never deletes a row, but it overwrites a changed one (`runner/src/logBackup.ts:82-86`). A bulk corruption reaches the Sheet, and only Sheets version history undoes it. Free off-machine copies with history:
- beads Dolt history pushed to `refs/dolt/data`, readable `AS OF`, though `bd delete` "cannot be undone".
- restic snapshots to B2 (10 GB free).
- DoltHub (100 MB private free).

GitHub issue deletion is permanent.

**3. Phone write-back.** `bd github` pulls title, body, labels, assignee and open/closed state, but not comments, dependencies or due dates. A close on GitHub Mobile comes back, and a ticked box comes back only as body text. b9s web serves beads to a phone over Tailscale but needs the Mac awake, and Tailscale's free plan is non-commercial. iCloud Drive is Obsidian's free iOS sync. Sheets on a phone ticks checkboxes added on desktop, but today's sync is one-way.

**4. Reminders.** beads stores `--due`, filters with `--overdue` and runs hook scripts, but sends nothing. Free senders:
- An Apps Script trigger: email (100/day) or Calendar events with reminders.
- An ntfy.sh push.
- A launchd job, which runs on wake.

Google Tasks stores dates only.

**5. Service as the store.** None documents an offline CLI.
- GitHub Issues: free, with `gh`, an official MCP server and a phone app. You export through the API yourself.
- GitLab Free: export includes issues and comments, and its MCP server is on Free.
- Plane Free: 12 users and an MCP server, but Exports are not included.
- Linear Free: 250 active issues.
- Jira Free: 10 users.


## Comparison

### Durability options for a store outside git

| Option | Off-machine | Point in time | Survives a bulk delete | Cost at this size | Restore |
|---|---|---|---|---|---|
| Today's Sheet sync (`npm run logs`) | Yes | Only through Sheets version history | Deleted files: yes, the row stays. Corrupted files: no, the row is overwritten | Free | `restore` writes missing files, never overwrites |
| beads `bd dolt push` to `refs/dolt/data` | Yes (git remote) | Yes, every write is a Dolt commit | Yes, if the delete's commit is undone or read `AS OF` | Free on GitHub | Dolt reset or `AS OF` reads |
| beads `bd backup` to a folder or DoltHub | Yes | The backup's state at last sync | Only if the backup synced before the delete | DoltHub: 100 MB private free | `bd backup restore [--force]` |
| restic to B2, or rclone to a cloud drive | Yes | Yes, each snapshot | Yes | B2: first 10 GB free | `restic restore <id> --include` |
| Time Machine | Only if the disk is kept elsewhere | Hourly for 24 h, daily for a month | Yes | An external disk | Time Machine |
| Google Drive folder | Yes | 30 days or 100 versions per file | Trash for 30 days | 15 GB on a Google account (unverified) | Manage versions; Trash |
| Commit the folder to a private repo on a timer | Yes | Each commit | Yes | Free | `git checkout <commit> -- <path>` |

### Hosted trackers as the store

| Service | Free tier fit (1–3 people, ~1,300 issues) | Agent access | Phone | Delete recovery | Export |
|---|---|---|---|---|---|
| GitHub Issues | Yes | `gh`, official MCP server | GitHub Mobile | None: permanent, admin only | REST API, 100 per page |
| GitLab Free | Yes (limits not checked) | `glab`, MCP server Free since 19.2, GA in 19.5 | Not checked | Not checked | Project export with issues, comments and labels |
| Plane Cloud Free | 12 users; no stated item cap | Official MCP server (`makeplane/plane-mcp-server`), REST API | Mobile app on Cloud Free (personal#75) | Not checked | "Exports" not included on Free, per pricing |
| Linear Free | No: 250 active issues, archived ones unlimited | Hosted MCP, API | iOS/Android | Deleted issues kept 30 days | CSV without comments; Markdown copy with comments; API |
| Jira Free | 10 users, 2 GB | Atlassian remote MCP server | Not checked | Not checked | Not checked |

## Findings

### 1. Today's pattern, generalised: ids, claims, concurrent edits

**The local pattern, as built**
- One Markdown file per note, with fields between `---` lines. The id is `<date>-<session>-<k>`, where `k` counts from 1 past the highest already used (`runner/src/frictionNotes.ts:1-4`).
- "No note is ever deleted, and only log mode changes a status" (`runner/src/frictionNotes.ts:5`).
- The write loops over `k` and uses `flag: "wx"`. On `EEXIST` it tries the next number: "`wx` refuses a file another writer took meanwhile" (`runner/src/frictionNotes.ts:61-69`, `:132-143`).
- A restore writes a note back under its own id and leaves an existing file alone (`runner/src/frictionNotes.ts:82-89`).
- The sync "adds and updates rows but never deletes one, and a restore never overwrites a file" (`runner/src/logBackup.ts:1-3`). An existing key whose cells differ is replaced in place (`runner/src/logBackup.ts:76-91`), and the whole tab is rewritten when anything changed (`runner/src/logBackup.ts:28-30`). A row's key is its first cell, the note's id (`runner/src/logBackup/logTabs.ts:1-2`).
- ADR 0030 records the reasons: a public repo can't hold the prose, tracked notes cost a workspace per capture, and parallel worktrees appending to one file conflict. It also records the cost: "rows written since the last sync exist only on this disk" (`docs/adr/0030-the-friction-and-outcome-logs-live-outside-git-with-a-one-way-sheet-backup.md:3`).
- The repo already has a lock with stale-holder takeover. A pid lock file records holder, host and start time. It "is stale only when that pid is no longer running on this host; there is no time-based expiry". A stale lock "is taken over only while holding a `<path>.takeover` guard" (`runner/src/PidLock.ts:1-4`). It is written with `flag: "wx"` (`runner/src/PidLock.ts:122`).

**What the primitives guarantee**
- POSIX `open` with `O_CREAT|O_EXCL`: "The check for the existence of the file and the creation of the file if it does not exist shall be atomic." https://pubs.opengroup.org/onlinepubs/9799919799/functions/open.html
- Node's `'wx'` flag: "Like `'w'` but fails if the path exists." https://github.com/nodejs/node/blob/main/doc/api/fs.md
- POSIX `rename` must be atomic, and a directory entry named `new` "shall remain visible to other threads throughout the renaming operation". https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html

**Lock, then rename (git)**
- To change a file, git creates `<filename>.lock` "with `O_CREAT|O_EXCL` so that we can notice and fail if somebody else has already locked the file". It writes the new contents into the lock, then "atomically rename[s] the lockfile to its final destination to commit the changes and unlock the file".
- "Lockfiles only block other writers. Readers do not block, but they are guaranteed to see either the old contents of the file or the new contents."
- On exit, git's handlers remove a lock it left behind.

https://github.com/git/git/blob/master/lockfile.h

This maps onto one file per issue: lock `<id>.md.lock`, read, write the new state into the lock, rename it over `<id>.md`.

**Atomic claims and leases (beads)**
- `bd update --claim` "Atomically claim[s] the issue (sets assignee to you, status to in_progress; idempotent if already claimed by you)". https://github.com/gastownhall/beads/blob/main/docs/cli-reference/update.md
- "`--claim` is atomic: when multiple agents pull from the same ready queue, the first claim wins." `bd ready --claim` claims the first ready issue. https://github.com/gastownhall/beads/blob/main/docs/multi-agent/coordination.md
- Compare-and-set on any update: `--if-assignee` and `--if-status` apply the update "only if the current assignee/status equals this value". On a mismatch nothing is written and the exit code is 13, "another actor won the race". https://github.com/gastownhall/beads/blob/main/docs/cli-reference/update.md
- Updates to several ids are "applied per issue ID, not atomically across IDs". Same source.
- Leases: a claim "takes a lease that expires after a TTL, kept alive by 'bd heartbeat'". `bd reclaim` reverts an in_progress issue whose lease expired more than `--older-than` ago (default 10m) back to open. https://github.com/gastownhall/beads/blob/main/docs/cli-reference/reclaim.md
- `--force` lets `-a` overwrite "another actor's live in_progress claim". The docs say to use it only for abandoned claims. https://github.com/gastownhall/beads/blob/main/docs/cli-reference/update.md
- Writers: embedded mode is "Single-writer (one process at a time)", and the store is file-locked. "For sustained concurrent agents, use server or proxied-server mode." https://github.com/gastownhall/beads/blob/main/docs/architecture/dolt.md and https://github.com/gastownhall/beads/blob/main/README.md
- Latest release: v1.3.4, 2026-11-04. https://github.com/gastownhall/beads/releases (The `steveyegge/beads` repo now redirects to `gastownhall/beads`, per the GitHub API.)

**One writer at a time in a database (SQLite)**
- In WAL mode, readers and writers mostly don't block each other. But "since there is only one WAL file, there can only be one writer at a time". "All processes using a database must be on the same host computer; WAL does not work over a network filesystem." https://www.sqlite.org/wal.html
- "BEGIN IMMEDIATE might fail with SQLITE_BUSY if another write transaction is already active on another database connection." https://www.sqlite.org/lang_transaction.html
- All worktrees here sit on one Mac, so the same-host rule holds.

**Edits as an operation log (git-bug)**
- An entity is "a series of edit operations". Each operation has a type, an author, a timestamp, one or two Lamport times, and its data. Its id "is a hash of that data". The final state comes from applying the operations in order, an idea the doc ties to operation-based CRDTs. https://github.com/git-bug/git-bug/blob/trunk/doc/design/data-model.md
- Applied here, this means each status change, comment or edge becomes its own exclusively created file under the issue, written exactly as friction notes are. Two parallel writers never touch the same file, and the store stays append-only.

**Ids**
- UUIDv7 is a "time-ordered value field derived from the widely implemented and well-known Unix Epoch timestamp source", with random bits after it. "Implementations SHOULD utilize UUIDv7 instead of UUIDv1 and UUIDv6 if possible." RFC 9562, May 2024. https://www.rfc-editor.org/rfc/rfc9562.html
- Backlog.md's plan for shared id records across worktrees (BACK-760.1) is in personal#75.

### 2. Durability

**Today's Sheet backup**
- It survives a bulk delete of files: rows are never deleted, and `restore` writes back every missing file (`runner/src/logBackup.ts:36-52`).
- It does not survive a bulk overwrite or corruption: a file whose cells changed replaces its row (`runner/src/logBackup.ts:82-86`). For mutable issues this also means the Sheet keeps only the latest state of each issue.

**Google Sheets version history**
- Restoring an earlier version clears "the cell-by-cell edit history for any changes made before the restore".
- A sheet holds up to 15 named versions, and naming a version helps keep it from being merged. "The revisions for your file may occasionally be merged."
- Owners can delete version history, and doing so is "permanent and cannot be undone."

https://support.google.com/docs/answer/190843

**Google Drive (non-Google files)**
- "A version might be permanently deleted after 30 days or if there are 100 newer versions", unless it's marked Keep forever. https://support.google.com/drive/answer/2409045
- Trash empties itself: "Files you move to the Trash are deleted forever after 30 days." https://support.google.com/drive/answer/2375102

**beads / Dolt**
- "Every write creates a Dolt commit." https://github.com/gastownhall/beads/blob/main/docs/architecture/dolt.md
- "A local commit of either kind is not a backup. To keep a copy off the machine, push history to a remote, or point `bd backup` at a separate or off-machine destination." Same source.
- `bd dolt push` sends history to `refs/dolt/data` on the git remote. https://github.com/gastownhall/beads/blob/main/README.md
- `bd delete` "Permanently delete[s] the issues from the database. This is a destructive operation that cannot be undone." It supports batch deletion (`--from-file`, `--cascade`) and needs `--force`. https://github.com/gastownhall/beads/blob/main/docs/cli-reference/delete.md
- Past commits stay queryable: `AS OF` "must name a valid Dolt reference, such as a commit hash, branch name". The `dolt_history_<table>` tables "provide a row for every revision of a row". https://www.dolthub.com/docs/sql-reference/version-control/querying-history
- `bd backup` is "a Dolt-native database backup", covering tables, branches, commit history and working set, for "off-machine recovery". Destinations are a filesystem path ("external drive, NAS, Dropbox folder") or a DoltHub URL. Restore is `bd backup restore [path]`, with `--force` to overwrite. Auto-backup is on in embedded mode when a git remote exists and off in server mode. https://github.com/gastownhall/beads/blob/main/docs/cli-reference/backup.md
- DoltHub: "the same free 100 MB of private data storage" for Pro subscribers. Pro costs $5/month up to 5 GB, then $1/GB/month. Public databases are free (2026-04-24). https://dolthub.com/blog/2026-04-24-announcing-dolthub-pro-for-5-dollars-per-month/

**restic**
- Backends: local, SFTP, REST server, S3, B2 (through its S3 API), Azure, GCS, and rclone, which "can be used to access many other different services". https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html
- Restore: `restore latest` or `restore <snapshot-id>`, with `--include` for a subset, or `restic mount` to browse snapshots as files. https://restic.readthedocs.io/en/stable/050_restore.html
- Backblaze B2: "First 10GB storage is always free", then $6.95/TB/month. https://www.backblaze.com/cloud-storage/pricing

**Time Machine**
- It keeps "hourly backups for the past 24 hours, daily backups for the past month, and weekly backups for all previous months" on an external storage device. https://support.apple.com/en-us/104984

**GitHub Issues, if they were the store**
- On a personal account's repo, only that account can delete issues. The docs describe the delete as permanent and give no undo. https://docs.github.com/en/issues/tracking-your-work-with-issues/administering-issues/deleting-an-issue
- The GraphQL API has a `deleteIssue` mutation, so a script can delete in bulk; this rests on a search snippet of https://docs.github.com/en/graphql/reference/issues.
- "A deleted repository can be restored within 90 days." https://docs.github.com/en/repositories/creating-and-managing-repositories/restoring-a-deleted-repository

### 3. Phone write-back

**`bd github` field mapping (beads source, `internal/github`, as of 2026-11-05)**
- Pull (GitHub to beads) sets:
  - `Title`
  - `Description` from the body
  - `Status`: the closed state takes precedence over `status::` labels
  - `IssueType` and `Priority` from `type::` and `priority::` labels
  - the other labels
  - `Assignee` (the first assignee's login)
  - created and updated times

  `Dependencies` is always empty. https://github.com/gastownhall/beads/blob/main/internal/github/mapping.go
- Push (beads to GitHub) sends title, body, labels (`type::`, `priority::`, `status::in_progress`, `status::blocked`, `status::deferred`, plus plain labels) and state. Same source.
- `StatusToBeads` maps `"closed"` to closed and `"open"` to open. https://github.com/gastownhall/beads/blob/main/internal/github/fieldmapper.go
- The tracker adapter has no comment code, and `ClosedAt` maps to `CompletedAt`. https://github.com/gastownhall/beads/blob/main/internal/github/tracker.go
- Conflicts: `--prefer-newer` is the default, and `--prefer-github` and `--prefer-local` also exist. The docs mention no webhook or schedule, so sync runs only when the command is invoked. https://github.com/gastownhall/beads/blob/main/docs/cli-reference/github.md
- **So, for the ticket's two cases.** Closing an issue on GitHub comes back as closed. A ticked task-list box comes back only as changed Markdown in the description, not as a field.

**GitHub task lists and Mobile**
- "You can select or deselect the checkboxes to mark the tasks as complete or incomplete." "Tasklist blocks are retired"; sub-issues replace them. https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/about-tasklists
- GitHub Mobile lets you "Read, review, and collaborate on issues and pull requests" and receive push notifications for mentions. https://docs.github.com/en/get-started/using-github/github-mobile

**Community beads UIs on a phone**
- b9s says it lets you "change it, from your terminal, your phone or any browser". `b9s web` serves `127.0.0.1:7979` and prints a pairing link, and `tailscale serve --bg 7979` publishes it to the tailnet over HTTPS. The pairing cookie lasts 90 days.
- On a phone you swipe right to start an issue and left to close it, and drag cards between columns. Every write is a `bd` command.
- "The phone view is a page in the phone's browser, not a native app, and it needs the computer that serves it to stay awake."
- MIT, last pushed 2026-11-18.

  https://github.com/vanderheijden86/b9s
- Other beads web UIs, among them beads-ui, bd-board, beads-web, Bead Me Up Scotty and beadside, are listed in https://github.com/gastownhall/beads/blob/main/docs/community-tools.md. beadside writes your notes back as comments.
- Tailscale Personal: "Free forever", up to 6 users, unlimited devices, "only suitable for non-commercial use". https://tailscale.com/pricing

**Obsidian mobile with free sync**
- iCloud: "iCloud can be used to sync vaults between iOS and macOS." The vault should sit in the Obsidian folder in iCloud Drive. Avoid syncing one vault through several services.
- Git on iOS goes through Working Copy, and "syncing isn't automatic. You must manually push and pull changes". Some Working Copy features are paid.
- Syncthing on iOS is unsupported. Google Drive, Dropbox and OneDrive are not officially supported on iOS.

  https://obsidian.md/help/sync-notes
- Obsidian Git warns that its mobile Git "is very unstable" (personal#75).
- Remotely Save (community plugin) syncs through S3-compatible storage (including B2), Dropbox, OneDrive (App Folder) and WebDAV for free. Google Drive is a PRO feature. Its free version has "Basic Conflict Detection". Last pushed 2024-11-10. https://github.com/remotely-save/remotely-save

**Google Tasks behind a sync script**
- `status` is "needsAction" or "completed", and `completed` holds the completion timestamp. Notes are capped at 8192 characters. `webViewLink` links to the task in the Tasks web UI. https://developers.google.com/workspace/tasks/reference/rest/v1/tasks
- `due`: "Only date information is recorded; the time portion of the timestamp is discarded". Same source.
- A sync script can poll for changes with `updatedMin` and `completedMin`. https://developers.google.com/workspace/tasks/reference/rest/v1/tasks/list

**Google Sheets (the existing backup Sheet)**
- "After you add checkboxes on your computer, you can check and uncheck a cell from your iPhone or iPad." https://support.google.com/docs/answer/7684717?co=GENIE.Platform%3DiOS&hl=en
- Today's `logBackup` only writes to the Sheet and restores missing files. Pulling a ticked box back would be new code (`runner/src/logBackup.ts:15-53`).

### 4. Reminders

**beads**
- `--due` takes a date or time (`+6h`, `tomorrow`, `2025-01-15`). `--defer` hides an issue from `bd ready` until a date, "then auto-wakes to open". https://github.com/gastownhall/beads/blob/main/docs/cli-reference/update.md
- `bd list --overdue` shows "issues with due_at in the past (not closed)", and `--due-before` and `--due-after` filter by date. https://github.com/gastownhall/beads/blob/main/docs/cli-reference/list.md
- Hook scripts in `.beads/hooks/` run after events: `on_create`, `on_update`, `on_close`. https://github.com/gastownhall/beads/blob/main/internal/hooks/hooks.go
- No notification sender appears in the repo tree. A timer still has to run `bd list --overdue` and send something.

**Apps Script on the backup Sheet** (the agent account already owns it, per ADR 0030)
- Time triggers run "at a particular time or on a recurring interval, as frequently as every minute". "The time might be slightly randomized": a 9 AM trigger runs between 9 and 10 AM. https://developers.google.com/apps-script/guides/triggers/installable
- Consumer quotas:
  - 100 email recipients a day
  - 90 minutes of trigger runtime a day
  - 6 minutes per execution
  - 5,000 calendar events created a day
  - 20 triggers per user per script

  https://developers.google.com/apps-script/guides/services/quotas

**Google Calendar events**
- `reminders.overrides[]` takes `method` `"email"` or `"popup"` and `minutes` from 0 to 40320. "The maximum number of override reminders is 5." https://developers.google.com/workspace/calendar/api/v3/reference/events
- The Calendar help lists "On your phone" as a notification option. https://support.google.com/calendar/answer/37242

**ntfy**
- Push to a phone with `curl -d "..." ntfy.sh/mytopic`. There are Android and iOS apps. "Topic names are public, so it's wise to choose something that cannot be guessed easily." https://docs.ntfy.sh/
- Scheduled delivery uses `X-Delay`/`At`/`In`, from 10 seconds up to 3 days ahead. `X-Click` attaches a link. https://docs.ntfy.sh/publish/
- Free with no sign-up. Paid plans start at $5/month. https://ntfy.sh/#pricing

**A job on the Mac**
- "If you schedule a `launchd` job by setting the `StartCalendarInterval` key and the computer is asleep when the job should have run, your job will run when the computer wakes up." Cron jobs don't run while the Mac is asleep. https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/ScheduledJobs.html

**GitHub Actions on a schedule**
- The shortest interval is 5 minutes, and runs "can be delayed during periods of high loads". In public repos, schedules are disabled after 60 days without activity. https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- Free plan: standard runners are free in public repos. Private repos get $12 of compute a month, about 2,000 Linux minutes. https://docs.github.com/en/billing/concepts/product-billing/github-actions
- An Action can only see a store that lives off the Mac, such as the Sheet or a pushed ref.

### 5. Service as the store

**GitHub Issues**
- Free. See personal#75 for sub-issues, blocked-by and Mobile.
- Official MCP server (MIT) with selectable toolsets and a read-only mode. https://github.com/github/github-mcp-server
- The REST list endpoint takes `state=all` and `per_page` up to 100, so about 1,300 issues need about 13 calls to export. https://docs.github.com/en/rest/issues/issues#list-repository-issues
- Deletion is permanent (section 2).

**GitLab Free**
- File export is on Free. It includes "Issues, including issue comments", plus labels and milestones. The default limit is 6 exports a minute. https://docs.gitlab.com/user/project/settings/import_export/
- MCP server: available on Free, Premium and Ultimate. It "moved from Premium to Free" in 19.2 and became generally available in 19.5. It has a `work_items` toolset by default and needs no Duo add-on, only the "Allow access to the MCP server" setting. https://docs.gitlab.com/user/gitlab_duo/model_context_protocol/mcp_server/

**Plane Cloud Free**
- Free: 12 users. "Publishing views, Exports, and Integrations" are not included. Imports from Jira, Linear and CSV are. https://plane.so/pricing
- Export work items as CSV, Excel or JSON. Exports from a cycle or view are tagged Pro. This rests on search snippets of https://docs.plane.so/core-concepts/export and https://docs.plane.so/core-concepts/cycles, which don't say which plan the basic project export needs.
- Official MCP server (MIT). https://github.com/makeplane/plane-mcp-server

**Linear Free**
- "250 issues (plus unlimited archived issues)". https://linear.app/startups
- Closed issues archive automatically after a configurable delay. "Recently deleted issues are stored in the archives for 30 days." After that, it is "not possible to restore deleted issues". https://linear.app/docs/delete-archive-issues
- CSV exports have no comments. A Markdown copy includes comments. An issue-view export takes 250 issues at a time for members. The API is also available. https://linear.app/docs/exporting-data
- With about 1,300 issues, staying under 250 active means a short archive delay.

**Jira Free**
- Up to 10 users and 2 GB of storage, from a search snippet of https://support.atlassian.com/jira-cloud-administration/docs/explore-jira-cloud-plans/ (the pricing page did not render for the fetcher).
- Official remote MCP server (Apache-2.0). https://github.com/atlassian/atlassian-mcp-server

**Offline**
- None of the pages above documents an offline mode for its CLI or MCP server. The only offline route found is a local mirror synced on demand, such as `bd github sync` (section 3).

## Unverified

- **Maildir.** Its delivery without locks (write in `tmp/`, then link or rename into `new/`, with flags held in the filename after `:2,`) would be a close precedent for one-file-per-record stores. The spec at cr.yp.to was blocked by the sandbox's network allowlist, so it isn't cited.
- **`wx` on synced folders.** Whether `O_EXCL` stays atomic inside an iCloud Drive or Google Drive for desktop folder. POSIX promises it only within one filesystem, and the sync daemons were not checked.
- **beads `AS OF` after a delete.** Whether `bd` itself exposes `AS OF` or a revert of a delete. The Dolt docs cover `AS OF` in SQL, and `bd sql` exists, but no beads doc walks through it.
- **GitHub Mobile checkboxes.** Whether GitHub Mobile lets you tick a task-list checkbox today. The only hit was a 2023 private-beta note that tasklists render on mobile.
- **Phone notifications.** Whether Calendar `popup` reminders arrive as phone notifications. Whether Google Tasks notifies on a date-only due date.
- **iCloud Drive.** The Recently Deleted window for iCloud Drive (30 days is commonly stated) and whether Optimize Mac Storage could evict store files agents need. Apple's page says files leave the Mac only "when more space is needed".
- **Google account storage.** 15 GB free on a Google account was not re-checked.
- **Jira and GitLab.** Jira Cloud's backup or export on Free, and its delete recovery. GitLab Free's limits on issue count or storage, and its mobile story.
- **Linear.** Whether archived issues really don't count toward the 250 cap in practice. Only the startups page states it, and pricing and billing don't say.
- **ntfy.** The free tier's daily message limit on ntfy.sh.
- **Commercial use.** Whether this developer's use counts as commercial under Tailscale's free plan.
