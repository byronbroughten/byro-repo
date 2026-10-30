#!/usr/bin/env bash
# Starts the spec runner in a detached tmux session under caffeinate, so it outlives the terminal and the Mac stays awake.
# Usage: npm run runner:tmux -- <owner/repo> <n>; attach with `tmux attach -t runner-<repo>-<n>`.
# It then waits for the run's run-started or run-ended line (launchWait.ts): exit 0 on run-started, 1 on run-ended or a state still unknown.
# Exit 3 is a Restart, so the run relaunches in the same session on the code it just landed (run.ts).
# Any other exit above 1 is a crash, not a Stop or an end of run, so it writes the run-ended line the runner itself couldn't.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
restart_code=3

if [[ "${1:-}" == "--inside" ]]; then
  shift
  code="$restart_code"
  while (( code == restart_code )); do
    code=0
    caffeinate -is node "$root/scripts/runner/run.ts" "$@" || code=$?
  done
  if (( code > 1 )); then
    node "$root/scripts/runner/crash.ts" "$@" "$code"
  fi
  exit "$code"
fi

if [[ $# -ne 2 || "$1" != */* ]]; then
  echo "Usage: npm run runner:tmux -- <owner/repo> <n>" >&2
  exit 2
fi
session="runner-${1#*/}-$2"
if tmux has-session -t "=$session" 2>/dev/null; then
  if [[ "$(tmux display-message -p -t "=$session" '#{pane_dead}')" != "1" ]]; then
    echo "tmux session $session is still running its run; attach with: tmux attach -t $session" >&2
    exit 1
  fi
  # An ended run's pane, kept by remain-on-exit: its last lines go to the progress log before the session is replaced.
  log="$(node "$root/scripts/runner/progressLog.ts" "$1" "$2")"
  mkdir -p "$(dirname "$log")"
  {
    echo "Replaced dead tmux session $session; its last lines:"
    tmux capture-pane -p -t "=$session" -S -20
  } >>"$log"
  tmux kill-session -t "=$session"
fi
launched_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
tmux new-session -d -s "$session" -c "$root" "bash '$root/scripts/runner/tmux.sh' --inside '$1' '$2'"
# Keeps the pane after exit, so a crash's message is still there to read.
tmux set-option -t "$session" remain-on-exit on >/dev/null
echo "Started tmux session $session; attach with: tmux attach -t $session"
# A startup that stops within seconds is reported here, before any Supervisor's watch could miss its line.
exec node "$root/scripts/runner/launchWait.ts" "$1" "$2" "$launched_at"
