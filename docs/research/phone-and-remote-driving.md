# Phone and remote driving for the spec runner (#201, map #197)

Researched 2026-10-10 against Claude Code v2.1.296 (the version installed on this Mac, `claude --version`). The Mac is a MacBook Air (Apple M4, `system_profiler`), so lid and sleep behavior matter.

## Summary

- **A Halt is a runner event, not a Claude dialog.** The runner is a script that launches headless `claude -p` and `cursor-agent -p` steps. A `-p` run never opens a dialog a phone can answer. With no permission host it denies anything that would prompt, and it offers `AskUserQuestion` only when a host exists ([headless][headless], [hooks][hooks-defer]). So the runner itself must send each Halt to the phone and wait for the reply. Claude Code's phone features (Remote Control, its push notifications, the PushNotification tool) only cover interactive Claude sessions.
- **The `/clear` report is out of date for Remote Control.** The current docs list `/clear` among the commands that work from mobile and web ([remote-control][rc-limits]). The changelog shows the old trouble: commands sent from Remote Control failed with "Unknown command" until v2.1.202, and `/clear` resets didn't reach attached clients until v2.1.224. **Cloud sessions** still don't support `/clear` ([cloud][cloud-context]). That is likely where the report comes from. Real limits today: terminal-only commands such as `/plugin` and `/resume` don't work remotely, `/claude-api` can't be typed from mobile, and bypass-permissions mode can't be picked from the app.
- **Cloud sessions are a poor fit.** They load repo `.claude/skills/`, `CLAUDE.md` and hooks, and `gh` is preinstalled behind a REST-only proxy. But they have no `clasp` credentials, user `~/.claude` skills or `cursor-agent`, and the VM pauses after a few idle minutes ([cloud-environments][cloud-env]). That doesn't suit a long script that waits on Halts.
- **SSH + tmux over Tailscale** is the most general way to start and watch a run. It costs about an hour to set up. Use the Standalone Tailscale app plus macOS Remote Login, because Tailscale's own SSH server needs the open-source `tailscaled` variant on macOS ([tailscale-ssh][ts-ssh], [variants][ts-variants]). iOS suspends SSH apps in the background within seconds ([Termius][termius-bg]), so the session has to live in tmux on the Mac.
- **Notifications plus a reply channel:** ntfy (free; a POST can carry up to 3 action buttons that send HTTP requests) or Pushover (emergency priority with acknowledgement receipts) for the push. The answer comes back through an ntfy reply topic, a GitHub issue comment the runner polls, or a Telegram bot.
- **Recommendation (labeled below):** keep the Mac awake with the runner in tmux under `caffeinate`, reachable over Tailscale and an SSH app. On each Halt the runner posts the question as a GitHub issue comment on the spec's issue and sends an ntfy push linking to it, with buttons for pick-one answers. It then polls for the answer. Remote Control is an extra for live chat with an interactive Claude session, not the Halt path.

## 1. SSH from a phone

### Network: Tailscale (or alternatives)

- **Tailscale SSH server on macOS needs the open-source `tailscaled` variant.** The App Store and Standalone apps "can't be a Tailscale SSH server" ([macOS variants][ts-variants]). Tailscale recommends `tailscaled` "only for unattended installs managed by experienced macOS system administrators", and recommends the Standalone app for everyone else ([variants][ts-variants]). The server component exists only on Linux and on "macOS open source `tailscale` + `tailscaled` CLI devices" ([tailscale-ssh][ts-ssh]).
- **The practical path:** the Standalone Tailscale app on the Mac gives it a tailnet address. macOS's own sshd (**System Settings > General > Sharing > Remote Login**, with an "Allow access for" user list) listens on it ([Apple Mac User Guide][apple-remote-login]). The phone runs the Tailscale app plus an SSH client. Only the open-source `tailscaled` variant runs before login ([variants][ts-variants]), so with the app variants someone must be logged in on the Mac.
- **Cost:** Tailscale SSH is "available for all plans" ([tailscale-ssh][ts-ssh]). Tailscale's free-plan limits were not checked here.
- **Alternatives (not researched in depth, non-primary):** ZeroTier, Cloudflare Tunnel, or a port-forwarded sshd. Each needs more network setup or exposes a public port. Moshi's docs also route through a tailnet ([Moshi docs][moshi-docs]).

### Phone clients

| Client | Platforms | mosh | Background behavior | Agent-specific features | Source |
| --- | --- | --- | --- | --- | --- |
| **Termius** | iOS, Android (and desktop) | Yes. Needs mosh 1.3.0+ installed on the server, enabled per host. Mosh sessions aren't recorded in session logs | Recent iOS suspends background activity within about 20-30 s. Workarounds: enable location tracking (docs) or Live Activities (Termius blog) | Blog post on agents; no approval inbox found | [Termius FAQ][termius-bg], [Termius search summary][termius-bg] |
| **Blink Shell** | iOS/iPadOS | Yes (`mosh user@host`; mosh must be installed on the destination) | Not stated on the docs index | None stated; a free trial or paid Blink+ | [Blink docs][blink] |
| **Moshi** | iOS and Android | Yes; mosh is a Pro feature | Mosh "keeps sessions alive through network changes and sleep" (App Store listing) | `moshi-hook` on the host feeds an inbox of approvals, questions and turn completions, with push and iOS Live Activities. Approvals can be answered from the app and the Apple Watch. A custom webhook can trigger alerts | [Moshi docs][moshi-docs], [App Store][moshi-appstore] (vendor sources) |

Moshi's comparison with Blink is the vendor's own framing ([getmoshi.app/compare/blink][moshi-compare], non-neutral). Whether `moshi-hook` hooks into a headless `claude -p` runner is **unknown**: its docs describe agent sessions in a terminal.

### Persistence: tmux and mosh

- **mosh** "automatically roams as you move between Internet connections" and survives sleep on the client side. It uses UDP 60000-61000, must be installed on both ends, and "synchronizes only the visible state of the terminal", so scrollback is lost unless tmux or screen runs on the server ([mosh.org][mosh]). Over Tailscale the UDP ports need no router forwarding (inference: tailnet traffic is peer-to-peer).
- **tmux** keeps the runner alive when the phone's SSH session drops. Claude Code's own docs say to start `claude` inside `tmux` or `screen` on a machine you SSH into ([remote-control limitations][rc-limits]). Termius also recommends tmux or screen for recovering after a drop ([Termius][termius-bg]). tmux and mosh are **not installed** on this Mac (`which` found neither), so setup includes `brew install tmux mosh`.
- **Alternative to tmux:** `claude --bg --exec '<cmd>'` runs a shell command as a PTY-backed background job under Claude Code's supervisor ([cli-reference][cli]). Agent-view sessions are "preserved across sleep but stop if the machine shuts down" ([agent-view][agent-view]). Whether such a job can be watched from a phone, other than over SSH with `claude logs` or `claude attach`, is **unknown**.

### Keeping the Mac awake

- `caffeinate -i <cmd>` holds an idle-sleep assertion while `<cmd>` runs. `-s` prevents system sleep, but "only when system is running on AC power". `-w <pid>` ties the assertion to an existing process (`man caffeinate`). Wrapping the runner, as in `caffeinate -is npm run runner …`, is the cheapest guard.
- `pmset` has `ttyskeepawake`, which prevents idle sleep while a remote-login tty is active (`man pmset`). This Mac currently shows `ttyskeepawake 1`, `sleep 0 (sleep prevented by caffeinate, powerd)` and `tcpkeepalive 1` (`pmset -g`).
- **Lid closed:** Apple's closed-display mode needs power plus an external display and keyboard/mouse ([Apple dark-display support][apple-display], indirect). Whether `caffeinate` keeps a MacBook Air awake with the lid closed and no display is **unverified**. Plan on lid open and plugged in.
- **What happens on sleep:** Remote Control reconnects when the machine comes back ([remote-control][rc]). An outage while the machine is awake ends a `claude remote-control` server after about 10 minutes ([rc-limits][rc-limits]).

### Assessment

- **Setup:** about an hour (Tailscale on both devices, Remote Login, an SSH key on the phone, `brew install tmux mosh`, one runner launch script).
- **Reliability:** high once set up. The weak links are Mac sleep and iOS killing a backgrounded client. tmux covers the second.
- **Mid-run:** can start, watch, stop, edit files and answer anything the runner reads from stdin. A phone keyboard makes long answers tedious. SSH alone doesn't push: you only see a Halt if you happen to look.

## 2. Claude Code Remote Control

**What it is:** connects claude.ai/code or the Claude iOS/Android app to a Claude Code session running on the Mac. "Claude keeps running locally the entire time", with the local filesystem, MCP servers and project config ([remote-control][rc]). Start it with `claude remote-control` (server mode, several sessions), `claude --remote-control` / `--rc` (an interactive session), or `/remote-control` (`/rc`) inside a session ([rc][rc], [cli][cli]). It needs a claude.ai Pro/Max/Team/Enterprise login. API keys don't work. It is unavailable if `ANTHROPIC_API_KEY`, `apiKeyHelper` or `ANTHROPIC_AUTH_TOKEN` is set (changelog 2.1.139), and when `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` or `DISABLE_GROWTHBOOK` is set ([rc requirements][rc]).

### The `/clear` and slash-command question, verified

- **Current docs:** "Text-output commands: `/compact`, `/clear`, `/context`, `/usage`, `/exit`, `/usage-credits`, `/recap`, and `/reload-plugins`" work from mobile and web. "When you run `/clear`, the conversation resets on connected devices too" ([rc limitations][rc-limits], [what connected devices see][rc]).
- **Local-only:** "commands that only run in the terminal interface, such as `/plugin` or `/resume`, work only from the local CLI". "`/claude-api` is also unavailable when you type it from mobile or web" ([rc-limits][rc-limits]). `/model`, `/effort`, `/fast`, `/config`, `/autocompact`, `/advisor`, `/output-style` and `/focus` need an argument instead of opening a picker ([rc-limits][rc-limits]).
- **Changelog history (likely source of the report):**
  - 2.1.202: "Fixed commands sent from Remote Control (mobile/web) into an interactive session failing with 'Unknown command'"
  - 2.1.224: "`/clear` resets now propagate to attached clients", and "Fixed Remote Control and SDK clients showing a blank '(no content)' message after `/clear`"
  - 2.1.261: "Fixed Remote Control sessions showing as still working (stuck spinner and Stop button) … after a local slash command like `/clear`"
  - 2.1.265: "Fixed `/clear` from Remote Control waiting on SessionStart hooks and on open terminal dialogs before completing"
  - 2.1.69: "Fixed Android app crash when running local slash commands (`/voice`, `/cost`) in Remote Control sessions"

  ([CHANGELOG.md][changelog])
- **Cloud sessions are different:** "`/clear` | No | Start a new session from the sidebar instead" ([cloud][cloud-context]).
- **Repo skills over Remote Control:** the docs name only `/claude-api` as a skill you can't type from mobile, which implies typed project skills such as `/implement` work. That is an inference, **not tested here**.

### Other documented limits

- **The session dies with its process:** "If you close the terminal … or otherwise stop the `claude` process, the session goes offline". Use tmux on a remote machine ([rc-limits][rc-limits]).
- **One remote session per interactive process.** Server mode serves several ([rc-limits][rc-limits]).
- **Network timeouts:** a 403 retry window of up to 3 minutes; server mode exits after about 10 minutes of outage; an interactive session disconnects after about 30 minutes of failed heartbeats ([rc-limits][rc-limits]).
- **Dialogs:** permission prompts and `AskUserQuestion` stay open until answered. Other forwarded dialogs auto-close after 5 minutes (`dialogExpiry`) ([rc-limits][rc-limits]).
- **Permission modes from the phone:** Manual, Accept edits, Plan, Auto. Bypass permissions can't be picked from the app ([mobile][mobile]).
- **Server-mode trust prompt:** in an untrusted directory, `claude remote-control` needs a TTY for its trust prompt and otherwise exits with `Workspace not trusted` ([rc requirements][rc]).
- **Headless runs:** Remote Control isn't documented for `claude -p`. The CLI reference describes `--remote-control` as starting "an interactive session" ([cli][cli]). Whether a `-p` child can opt in is **unknown**. The changelog mentions Remote Control in "SDK-hosted sessions" such as Desktop (2.1.152).

### Push notifications

When Remote Control is active, `/config` offers **Push when Claude decides** and **Push when actions required** (permission prompts and questions). "Claude decides when to push", and there is no per-event config ([rc push][rc-push]). Pushes are skipped while you're focused on the terminal (`CLAUDE_CLIENT_PRESENCE_FILE` extends that) ([rc push][rc-push]). iOS Focus modes and Android battery optimization can delay them ([rc push][rc-push]).

### Assessment

- **Setup:** minutes (log in, install the app, `/config` toggles).
- **Reliability:** good for an interactive session kept alive in tmux. It is still marked as fixing many edge cases (dozens of changelog entries).
- **Mid-run:** it can chat with, steer and approve one interactive Claude session. It **cannot** see or answer anything inside the runner's headless children, or a Halt the runner raises.
- **Fit for the runner:** start the runner from an interactive Remote Control session (Claude launches it in tmux via Bash; local interactive sessions have no background-command time limit ([tools-reference][tools-bg])). Or, on a Halt, have the runner open an interactive `claude --rc` session in tmux seeded with the Halt. The second needs a TTY and its push depends on Claude choosing to push; it is **untested**.

## 3. Cloud sessions (Claude Code on the web) and the Claude mobile app

- **The app is a client.** "The Claude app … is a client for Claude Code sessions rather than a place where code runs". It reaches cloud sessions, Remote Control and Dispatch ([mobile][mobile]).
- **What a cloud session loads:** repo `CLAUDE.md`, `.claude/settings.json` hooks and permissions (single-repo sessions), and `.claude/skills/`, `agents/` and `commands/` all load, because they are part of the clone ([cloud-env][cloud-env]).
- **What it doesn't load:** user `~/.claude` skills and `CLAUDE.md`, plugins from `enabledPlugins`, and anything installed only on the Mac ([cloud-env][cloud-env]).
- **Credentials:**
  - **gh:** "GitHub's `gh` CLI is pre-installed". Credentials are injected by a proxy (`proxy-injected` placeholder), and GraphQL is rejected with a 403, so only REST subcommands and `gh api` work ([cloud-env][cloud-env]).
  - **Other keys:** a "network secret" attaches API keys per host on Pro and Max. Plain environment variables are readable by anyone using the environment ([cloud-env][cloud-env]).
  - **Not checked:** whether clasp's Google OAuth or Apps Script calls could work through network secrets. It would mean moving a credential AGENTS.md gates behind asks into the cloud, so treat it as out.
  - **cursor-agent:** would need installing in a setup script plus a `CURSOR_API_KEY` (inference from [Cursor headless][cursor-headless]).
- **Long scripts:** a foreground command defaults to 2 min (up to 10). Timed-out commands move to the background for up to 30 more minutes, adjustable with `BASH_DEFAULT_TIMEOUT_MS`/`BASH_MAX_TIMEOUT_MS`. "After a few minutes without activity, a session's VM pauses … and a paused VM can later be reclaimed" ([cloud-env time limits][cloud-env]). Background shell work still running when the VM is reclaimed is not restored ([cloud][cloud-expired]).
- **Questions:** when a session asks something and sits idle, you can answer "up to environment expiry" ([cloud][cloud]). `/clear` isn't supported ([cloud][cloud-context]).
- **Steering from a script:** `claude -p "msg" --cloud <session-id>` queues a message into a running cloud session from any logged-in machine ([cloud][cloud]).
- **Platform:** the VM is Ubuntu 24.04 x86_64, not macOS ([cloud-env][cloud-env]).
- **Dispatch** (Desktop app, Pro/Max only): message a task from the phone. The Desktop app runs it locally and pushes when it "finishes or needs your approval" ([desktop][desktop-dispatch]). Driving a deterministic script through it is untested; Dispatch decides how to route the task.
- **Assessment:** setup is low for the GitHub parts and high to impossible for clasp and app gates. It is reliable for self-contained tasks, but the VM pausing makes it unreliable for a script blocked on a Halt. It doesn't fit v1 of the runner.

## 4. Push notifications to the phone

| Option | Setup | Can carry an answer back? | Notes | Source |
| --- | --- | --- | --- | --- |
| **Remote Control push / PushNotification tool** | `/config` toggles; Claude app | Through the Remote Control session only | PushNotification "sends a desktop notification, and a phone push when Remote Control is connected". It runs only inside a Claude session, and the model decides when to push | [tools-reference][tools-push], [rc push][rc-push] |
| **Notification hook** | A `settings.json` hook running `curl` | No (side effects only) | Matchers include `permission_prompt` (after about 6 s idle), `idle_prompt` (60 s), `agent_needs_input` and `agent_completed`. The hook gets `message`, `title` and `notification_type`, and "can't block or modify notifications". The user settings already have a desktop-notify Notification hook. Whether it fires under `-p` isn't stated; a `-p` run has no prompts to wait on, so expect little | [hooks][hooks-notif] |
| **ntfy** | Install the app, subscribe to a topic, `curl -d "msg" ntfy.sh/<topic>` | **Yes, partly:** up to 3 action buttons; an `http` action sends a POST/GET/PUT to any URL (e.g. a reply topic the runner subscribes to). No free-text input | Topics on ntfy.sh are public and "the topic is essentially a password". Access tokens are possible. ntfy.sh: 250 messages/day, 4,096-byte messages. Subscribe from a script with `curl -s ntfy.sh/<topic>/json` or `?poll=1&since=<id>`; the cache lasts "a couple of hours". iOS instant delivery goes through ntfy.sh/APNs. A known iOS bug can leave the list unrefreshed until you swipe | [ntfy publish][ntfy-publish], [ntfy subscribe][ntfy-sub], [ntfy known issues][ntfy-known] |
| **Pushover** | Account plus app license; POST to `api.pushover.net/1/messages.json` | **Acknowledge only:** emergency priority 2 repeats every ≥30 s for up to 3 h until acknowledged. A receipt or callback tells the script it was acked | 10,000 messages/month free per account. Supplementary URL up to 512 characters. Pricing not on the API page | [Pushover API][pushover] |
| **GitHub Mobile** | Already installed if you use it | Via comments (section 5) | Push only for "Direct mentions", "Assignments to issues or pull requests", "Requests to review a pull request" and "Requests to approve a deployment". **Unknown:** whether a comment posted with your own token that @mentions you triggers a push. GitHub treats "your own updates" as a separate email category. A second bot account or GitHub App avoids the question | [GitHub configuring notifications][gh-notif] |
| **Moshi `moshi-hook`** | Install on the Mac; Moshi Pro | Approvals and questions for agent sessions | Coverage of headless runs **unknown** | [Moshi docs][moshi-docs] |

## 5. Asynchronous control channels for answering a Halt

The runner writes the Halt and its options somewhere the phone can reach, then blocks or polls until an answer arrives.

- **GitHub issue comments:**
  - **How:** the runner posts the Halt on the spec's issue (`gh issue comment`) and polls `gh api repos/<o>/<r>/issues/<n>/comments` for a reply after its own comment (REST works locally; the cloud proxy rejects GraphQL ([cloud-env][cloud-env])). The REST limit is 5,000 requests/hour per user, so polling every 30 s uses 120/hour ([GitHub rate limits][gh-rate]).
  - **Strengths:** free; uses tools the runner already has; leaves an audit trail on the issue; free-text answers; works from GitHub Mobile or any browser.
  - **Weaknesses:** a write per Halt (AGENTS.md: commit/push only when asked, and `gh` writes count as writes, so the spec needs a standing rule for Halt comments). Push only if the comment @mentions you from another account (see above). Poll latency.
- **ntfy reply topic:** buttons such as "A", "B", "Stop" POST to `ntfy.sh/<reply-topic>`, and the runner subscribes with `curl …/json`. It answers pick-one Halts with one tap, but can't take free text. Topic secrecy is the only auth unless you use tokens ([ntfy][ntfy-publish]).
- **Telegram bot (runner-owned):** the runner long-polls `getUpdates` (the `timeout` parameter); updates wait on Telegram's server for up to 24 hours ([Telegram Bot API][telegram]). It gives free text and push via the Telegram app. Setup: create a bot with BotFather and keep the token on the Mac.
- **Claude Code Channels (Telegram, Discord, iMessage):** a research-preview MCP plugin pushes chat messages into a running interactive Claude session. "Channel servers that declare the permission relay capability can forward these prompts". "When you run channels in non-interactive mode with `-p`, tools that need terminal input … are disabled" ([channels][channels]). It needs Bun, `--channels`, and pairing plus an allowlist. It suits an interactive Claude "operator" session, not the deterministic runner.
- **`defer` hook for headless Claude steps:** a `PreToolUse` hook returning `permissionDecision: "defer"` makes `claude -p` exit with `stop_reason: "tool_deferred"` and the pending tool call saved. The caller collects the answer and resumes with `claude -p --resume <id>`, and the hook then returns `allow` with the answer in `updatedInput` ([hooks defer][hooks-defer]). This is how a step's own `AskUserQuestion` becomes a runner Halt. It needs `--permission-prompt-tool` for `AskUserQuestion` to be offered at all ([hooks][hooks-defer]).
- **Slack:** not researched beyond noting Claude in Slack spawns cloud sessions ([rc comparison table][rc]). A Slack bot using Socket Mode would work like the Telegram option (unverified).

## Recommendation (labeled: recommendation, not a finding)

1. **Host:** run the runner on the Mac inside `tmux`, wrapped in `caffeinate -is`, with the lid open and on power. Install the Standalone Tailscale app and turn on Remote Login, limited to your user and key auth. On the phone: the Tailscale app and an SSH client with mosh. Blink or Termius are the neutral picks; Moshi if its inbox proves useful. This is the path to **start** and **watch** a run, and the fallback for anything else.
2. **Halt channel, owned by the runner, a standalone module per #197's "modular by default":** on each Halt, (a) post the question, the options and the runner's recommendation as a comment on the spec's issue, and (b) send an ntfy push (private topic name or access token) with a `view` button to the comment and up to 2 `http` buttons for the top options, posting to a reply topic. The runner accepts whichever answer comes first: a reply-topic message or a new issue comment from you after its own. The issue comment is the record either way.
3. **Headless steps:** run Claude steps with `--permission-prompts none` or a `defer` hook, so nothing stalls inside a step. Anything a step can't decide surfaces as structured output, and the runner turns it into a Halt.
4. **Remote Control:** optional. Keep `claude --rc` in a second tmux window as an operator console for live questions about a run. It doesn't need to be part of the Halt path, so its edge cases can't block a run.
5. **Skip for v1:** cloud sessions (no clasp, VM pauses), GitHub Mobile as the only push (mention-only), and Channels (research preview, interactive only).

## Unknowns

- Whether Remote Control can attach to a `claude -p` or `cursor-agent` child, and whether `claude --bg --exec` jobs are reachable from the phone other than over SSH.
- Whether a GitHub comment posted with your own token that @mentions yourself triggers a GitHub Mobile push.
- Whether ntfy `http` action buttons work on iOS for this use. The section header lists Android, Apple and Firefox as supported; it wasn't tested.
- Whether a MacBook Air stays awake under `caffeinate` with the lid closed and no external display.
- Whether repo skills typed from the Claude app over Remote Control expand correctly in practice. The docs imply yes; not tested.
- Pricing for Pushover, Blink+, Moshi Pro and Termius, and Tailscale free-plan device limits (pricing pages not fetched).
- Whether `moshi-hook` covers headless runs.
- Whether Notification hooks fire under `-p` (not stated in the hooks doc).

## Sources

Primary unless marked.

[rc]: https://code.claude.com/docs/en/remote-control
[rc-limits]: https://code.claude.com/docs/en/remote-control#limitations
[rc-push]: https://code.claude.com/docs/en/remote-control#mobile-push-notifications
[cloud]: https://code.claude.com/docs/en/claude-code-on-the-web
[cloud-context]: https://code.claude.com/docs/en/claude-code-on-the-web#manage-context
[cloud-expired]: https://code.claude.com/docs/en/claude-code-on-the-web#environment-expired
[cloud-env]: https://code.claude.com/docs/en/cloud-environments
[mobile]: https://code.claude.com/docs/en/mobile
[desktop-dispatch]: https://code.claude.com/docs/en/desktop#sessions-from-dispatch
[cli]: https://code.claude.com/docs/en/cli-reference
[headless]: https://code.claude.com/docs/en/headless
[hooks-notif]: https://code.claude.com/docs/en/hooks#notification
[hooks-defer]: https://code.claude.com/docs/en/hooks#defer-a-tool-call-for-later
[tools-push]: https://code.claude.com/docs/en/tools-reference
[tools-bg]: https://code.claude.com/docs/en/tools-reference#time-limit-for-background-commands
[agent-view]: https://code.claude.com/docs/en/agent-view
[channels]: https://code.claude.com/docs/en/channels
[changelog]: https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
[ts-ssh]: https://tailscale.com/kb/1193/tailscale-ssh
[ts-variants]: https://tailscale.com/kb/1065/macos-variants
[apple-remote-login]: https://support.apple.com/guide/mac-help/mchlp1066
[apple-display]: https://support.apple.com/en-us/102501
[termius-bg]: https://docs.termius.com/help-center/faq/how-can-i-keep-termius-sessions-alive-in-the-background-on-ios-ipados
[blink]: https://docs.blink.sh/
[moshi-docs]: https://getmoshi.app/docs
[moshi-appstore]: https://apps.apple.com/app/id6757859949
[moshi-compare]: https://getmoshi.app/compare/blink
[mosh]: https://mosh.org/
[ntfy-publish]: https://docs.ntfy.sh/publish/
[ntfy-sub]: https://docs.ntfy.sh/subscribe/api/
[ntfy-known]: https://docs.ntfy.sh/known-issues/
[pushover]: https://pushover.net/api
[gh-notif]: https://docs.github.com/en/subscriptions-and-notifications/get-started/configuring-notifications
[gh-rate]: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
[telegram]: https://core.telegram.org/bots/api
[cursor-headless]: https://cursor.com/docs/cli/headless

- Claude Code docs: [Remote Control][rc], [cloud sessions][cloud], [cloud environments][cloud-env], [mobile][mobile], [Desktop/Dispatch][desktop-dispatch], [CLI reference][cli], [headless][headless], [hooks][hooks-notif], [tools reference][tools-push], [agent view][agent-view], [channels][channels], [CHANGELOG][changelog] (versions mapped from `## x.y.z` headers).
- Tailscale: [Tailscale SSH][ts-ssh], [macOS variants][ts-variants].
- Apple: [Remote Login][apple-remote-login]; [dark external display][apple-display] (indirect for closed-display mode); local `man caffeinate`, `man pmset`, `pmset -g`.
- Clients: [Termius FAQ][termius-bg]; Termius blog on Live Activities (non-primary, via search summary); [Blink docs][blink]; [Moshi docs][moshi-docs] and [App Store listing][moshi-appstore] (vendor); [Moshi vs Blink][moshi-compare] (vendor, non-neutral); [mosh.org][mosh].
- Notifications and channels: [ntfy publish][ntfy-publish] (plus its docs source on GitHub `binwiederhier/ntfy/docs/publish.md`), [ntfy subscribe][ntfy-sub], [ntfy known issues][ntfy-known], [Pushover API][pushover], [GitHub notifications][gh-notif], [GitHub REST rate limits][gh-rate], [Telegram Bot API][telegram], [Cursor CLI headless][cursor-headless].
