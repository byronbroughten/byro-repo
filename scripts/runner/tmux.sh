#!/usr/bin/env bash
# Starts the spec runner in a detached tmux session under caffeinate, so it outlives the terminal and the Mac stays awake.
# Usage: npm run runner:tmux -- <owner/repo> <n>; attach with `tmux attach -t runner-<repo>-<n>`.
# An exit above 1 is a crash, not a Stop or an end of run, so it sends the one push and run-ended line the runner itself couldn't.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ "${1:-}" == "--inside" ]]; then
  shift
  code=0
  caffeinate -is node "$root/scripts/runner/run.ts" "$@" || code=$?
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
tmux new-session -d -s "$session" -c "$root" "bash '$root/scripts/runner/tmux.sh' --inside '$1' '$2'"
# Keeps the pane after exit, so a crash's message is still there to read.
tmux set-option -t "$session" remain-on-exit on >/dev/null
echo "Started tmux session $session; attach with: tmux attach -t $session"
