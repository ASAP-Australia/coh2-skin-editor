#!/usr/bin/env bash
# Both-directions test for the process-kill guard.
#
# Per the instrument rule in CLAUDE.md: a guard is not trusted until it is shown
# to DENY the dangerous forms AND ALLOW the safe ones. A guard that denies
# everything is as useless as one that denies nothing, and only the second half
# of this test can tell them apart.
#
# This test already earned its place: it caught that `pkill -9 -f` slipped
# through, because the flag class `-[a-zA-Z]+` does not match the digit in `-9`.
#
#   ./.claude/hooks/guard-process-kill.test.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
HOOK=./.claude/hooks/guard-process-kill.sh
fails=0

check() { # check <expect: deny|allow> <command>
  local expect="$1" cmd="$2" got
  got=$(printf '{"tool_name":"Bash","tool_input":{"command":%s}}' \
        "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$cmd")" \
        | "$HOOK" \
        | python3 -c 'import json,sys; print("deny" if json.load(sys.stdin).get("hookSpecificOutput") else "allow")')
  if [ "$got" = "$expect" ]; then
    printf '  ok   %-5s %s\n' "$got" "$cmd"
  else
    printf '  FAIL expected %s, got %s: %s\n' "$expect" "$got" "$cmd"
    fails=$((fails + 1))
  fi
}

echo "MUST DENY — forms that have caused real damage:"
check deny 'pkill -f wineserver'                      # self-matches the calling shell
check deny 'pkill -9 -f "coh2.*AppImage"'             # digit flag; slipped through once
check deny 'pgrep -f electron'                        # same self-match hazard
check deny 'pkill -9 -x kwin_wayland'                 # would log the user out
check deny 'killall wineserver'                       # drops the user's running game
check deny 'pkill -9 -f kwin_wayland --virtual'
check deny 'sudo pkill -f node'                       # prefix deny rules miss this

echo "MUST ALLOW — the safe forms, and ordinary commands:"
check allow 'pkill -9 -x coh2-skin-edito'             # correct teardown for this app
check allow 'kill -9 344217'                          # by PID
check allow 'npm run build'
check allow 'git status --porcelain'
check allow 'pgrep -x steam'
check allow 'grep -f patterns.txt file'               # -f here is grep's, not pgrep's

echo
if [ "$fails" -eq 0 ]; then echo "PASS — guard discriminates in both directions"; exit 0
else echo "FAIL — $fails case(s) wrong"; exit 1; fi
