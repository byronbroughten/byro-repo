#!/bin/bash
# Records /inbox state in the inbox data folder, in the formats at the top of each file.
#   record.sh status <n|n-m> <pending|signed-off|applied|declined>
#   record.sh log <n> <tool and action> <what changed> <what reverses it>
set -euo pipefail
# Still the gate's location; #423 re-points both to personal/inbox.
data=${INBOX_DATA:-$HOME/.claude/inbox-data}

case "${1:-}" in
  status)
    python3 -I - "$data/proposals.md" "$2" "$3" <<'PY'
import re, sys
path, ids, status = sys.argv[1:]
if status not in ("pending", "signed-off", "applied", "declined"):
    sys.exit(f"unknown status {status}")
first, _, last = ids.partition("-")
text = open(path).read()
for n in range(int(first), int(last or first) + 1):
    text, count = re.subn(
        r"(^## P%d:.*?^- status: )\S+" % n, r"\g<1>" + status, text, count=1, flags=re.S | re.M
    )
    if not count:
        sys.exit(f"no Proposal P{n}")
open(path, "w").write(text)
PY
    grep -E '^## P|^- status' "$data/proposals.md" | paste - - | grep -E "^## P($(seq "${2%-*}" "${2#*-}" | paste -sd'|' -)):"
    ;;
  log)
    printf '\n## %s: P%s\n- tool: %s\n- changed: %s\n- reverse: %s\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$2" "$3" "$4" "$5" >> "$data/changes.md"
    ;;
  *)
    sed -n 3,4p "$0" >&2
    exit 1
    ;;
esac
