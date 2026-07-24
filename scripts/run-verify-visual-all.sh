#!/usr/bin/env bash
# run-verify-visual-all.sh — orchestrate the VERIFY_VISUAL capture across all 5
# factions as SEPARATE electron launches (the resilient fallback for the hidden-
# window batch instability), then run the diff.
#
# Each faction is one electron session; we capture its session id and kill ONLY
# that session on completion / error (never pkill -f, which self-matches). The
# pre-existing electrons in other sessions are never touched.
#
# Usage:  bash scripts/run-verify-visual-all.sh
set -u
cd "$(dirname "$0")/.."

FACTIONS=(german west_german soviet aef british)
W=1024
H=768
LOGBASE=/tmp/vv_all
PER_ITEM_MS=90000

# Sessions we spawned — killed on exit for guaranteed cleanup.
SPAWNED_SESSIONS=()

cleanup() {
  for sid in "${SPAWNED_SESSIONS[@]:-}"; do
    [ -z "$sid" ] && continue
    if ps -eo sid | grep -q "^ *$sid$"; then
      echo "[orchestrator] cleanup: killing session $sid"
      kill -TERM -"$sid" 2>/dev/null
      sleep 1
      kill -9 -"$sid" 2>/dev/null
    fi
  done
}
trap cleanup EXIT INT TERM

# Baseline set of electron session ids BEFORE we start (to exclude pre-existing).
mapfile -t PREEXISTING < <(ps -eo sid,comm | awk '$2=="electron"{print $1}' | sort -u)
is_preexisting() { local s="$1"; for p in "${PREEXISTING[@]:-}"; do [ "$p" = "$s" ] && return 0; done; return 1; }

for FACTION in "${FACTIONS[@]}"; do
  LOG="${LOGBASE}_${FACTION}.log"
  rm -f "$LOG"
  echo "[orchestrator] ── Faction: $FACTION ─────────────────────────────"
  VERIFY_VISUAL=1 VERIFY_FACTION="$FACTION" AUDIT_WIDTH="$W" AUDIT_HEIGHT="$H" \
    VERIFY_PER_ITEM_MS="$PER_ITEM_MS" setsid npx electron . > "$LOG" 2>&1 < /dev/null &
  disown
  sleep 5

  # Find the NEW electron session (the one not pre-existing, most electron procs).
  SID=""
  for _ in $(seq 1 20); do
    SID=$(ps -eo pid,sid,comm | awk '$3=="electron"{print $2}' | sort | uniq -c | sort -rn \
      | awk '{print $2}' | while read s; do is_preexisting "$s" || { echo "$s"; break; }; done)
    [ -n "$SID" ] && break
    sleep 1
  done
  if [ -z "$SID" ]; then
    echo "[orchestrator] ERROR: could not identify electron session for $FACTION"
    continue
  fi
  SPAWNED_SESSIONS+=("$SID")
  MAIN=$(ps -eo pid,sid,comm | awk -v s="$SID" '$2==s && $3=="electron"{print $1; exit}')
  echo "[orchestrator] $FACTION session=$SID main=$MAIN"

  # Wait for this faction's capture to finish (Summary) or the process to die.
  DEADLINE=$(( $(date +%s) + 1800 ))  # 30 min hard cap per faction
  while ps -p "$MAIN" >/dev/null 2>&1; do
    if grep -qE "verify-visual\] ── Summary" "$LOG" 2>/dev/null; then break; fi
    if [ "$(date +%s)" -gt "$DEADLINE" ]; then
      echo "[orchestrator] $FACTION exceeded 30min cap — killing"
      break
    fi
    sleep 5
  done

  # Kill this faction's session now (don't wait for it to self-quit / hang).
  if ps -eo sid | grep -q "^ *$SID$"; then
    kill -TERM -"$SID" 2>/dev/null; sleep 1; kill -9 -"$SID" 2>/dev/null
  fi
  W_COUNT=$(grep -cE "verify-visual\] ✓" "$LOG" 2>/dev/null || echo 0)
  echo "[orchestrator] $FACTION done — $W_COUNT frames captured"
done

echo "[orchestrator] All factions captured. Running diff…"
npx tsx --tsconfig tsconfig.node.json scripts/verify-unwrap-visual.mts
DIFF_EXIT=$?
echo "[orchestrator] diff exit=$DIFF_EXIT"
exit "$DIFF_EXIT"
