#!/usr/bin/env bash
# PreToolUse guard for Bash — blocks process-kill patterns that have actually
# caused damage or lost work on this project.
#
# WHY A HOOK AND NOT JUST permissions.deny:
# deny rules match the literal command string as a prefix, so `Bash(pkill *)`
# does not stop `/usr/bin/pkill`, `sudo pkill`, or `bash -c 'pkill …'`. A hook
# inspects the whole command text and, returning permissionDecision "deny",
# blocks even under --dangerously-skip-permissions.
#
# Reads the tool call as JSON on stdin; emits a JSON decision on stdout.
# Exit 0 always — the decision travels in the payload, not the exit code.
set -uo pipefail

INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' 2>/dev/null || echo "")
[ -z "$CMD" ] && { echo '{}'; exit 0; }

deny() {
  python3 -c '
import json,sys
print(json.dumps({"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":sys.argv[1]}}))' "$1"
  exit 0
}

# 1. pkill/pgrep -f self-matches the calling shell whenever the command text
#    contains the pattern. Killed its own Bash tool call four times in one
#    session, surfacing as exit 1/144 and files that were never written.
# Flag class MUST include digits: `pkill -9 -f` is the common form, and
# `-[a-zA-Z]+` silently fails to match the `-9`, letting the dangerous case
# straight through. Caught by the both-directions test below.
if printf '%s' "$CMD" | grep -qE '(^|[^a-zA-Z0-9_/-])(pkill|pgrep)([[:space:]]+-[a-zA-Z0-9]+)*[[:space:]]+-[a-zA-Z0-9]*f'; then
  deny "BLOCKED: 'pkill -f' / 'pgrep -f' match the CALLING SHELL — this Bash command contains the pattern, so it would kill itself mid-script (this has happened 4x on this project; symptom is exit 1/144 with work half-done).
Use instead:
  pkill -9 -x <comm>        # exact process name, max 15 chars
  kill -9 <pid>             # PID captured at launch, or from: wmctrl -lp
This app specifically: pkill -9 -x coh2-skin-edito   (the AppImage re-execs as /tmp/.mount_coh2-*/coh2-skin-editor, and comm truncates to 15 chars)."
fi

# 2. Killing the compositor by name takes the user's whole desktop with it —
#    the nested verification session and their Plasma session share a name.
if printf '%s' "$CMD" | grep -qE '(pkill|killall)([[:space:]]+-[a-zA-Z0-9]+)*[[:space:]]+.*kwin'; then
  deny "BLOCKED: this matches the USER'S DESKTOP COMPOSITOR as well as any nested one — it would log them out.
Kill the nested session by the PID captured when it was launched (scripts/ingame/session-up.sh prints it), never by name."
fi

# 3. A bare wineserver/winedevice kill drops whatever game the user is playing.
#    Wine processes belong to whichever Proton prefix launched them.
if printf '%s' "$CMD" | grep -qE '(pkill|killall)([[:space:]]+-[a-zA-Z0-9]+)*[[:space:]]+(wineserver|winedevice)'; then
  deny "BLOCKED: wine processes belong to whichever Proton prefix launched them — this would also kill the user's running game.
Check ownership first:  tr '\\0' '\\n' < /proc/<pid>/environ | grep compatdata/
CoH2 is prefix 231430; kill only PIDs whose prefix matches."
fi

echo '{}'
exit 0
