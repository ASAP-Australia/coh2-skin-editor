#!/usr/bin/env bash
# =============================================================================
# ingame-load-test.sh — Turnkey CoH2 signed-pack load test
#
# DO NOT RUN WHILE PLAYING ANOTHER GAME (Steam single-game lock).
#
# Usage:
#   ./tools/ingame-load-test.sh [path/to/pack.sga] [--launch]
#
# Without --launch the script copies the pack and prints instructions.
# With    --launch it copies the pack AND starts CoH2 via Steam, then tails
#         warnings.log for a verdict. You must not have the game already open.
#
# Default SGA: most recently modified file in out/verification/signed/
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SKINS_DIR="/home/jflessenkemper/.local/share/Steam/steamapps/compatdata/231430/pfx/drive_c/users/steamuser/Documents/My Games/Company of Heroes 2/mods/skins"
WARNINGS_LOG="/home/jflessenkemper/.local/share/Steam/steamapps/compatdata/231430/pfx/drive_c/users/steamuser/Documents/My Games/Company of Heroes 2/warnings.log"

# ---------------------------------------------------------------------------
# Resolve SGA path
# ---------------------------------------------------------------------------
SIGNED_DIR="$(dirname "$0")/../out/verification/signed"
SIGNED_DIR="$(realpath "$SIGNED_DIR")"

SGA_PATH=""
LAUNCH=0
for arg in "$@"; do
  if [[ "$arg" == "--launch" ]]; then
    LAUNCH=1
  elif [[ -z "$SGA_PATH" ]]; then
    SGA_PATH="$arg"
  fi
done

if [[ -z "$SGA_PATH" ]]; then
  # Pick most-recently-modified .sga in the signed output dir
  SGA_PATH="$(ls -t "$SIGNED_DIR"/*.sga 2>/dev/null | head -1 || true)"
  if [[ -z "$SGA_PATH" ]]; then
    echo "ERROR: No .sga found in $SIGNED_DIR"
    echo "       Run: npx tsx tools/patch-signed-pack.mts first"
    exit 1
  fi
fi

if [[ ! -f "$SGA_PATH" ]]; then
  echo "ERROR: SGA not found: $SGA_PATH"
  exit 1
fi

SGA_BASENAME="$(basename "$SGA_PATH")"
# Strip .sga to get the numeric ID
NUMERIC_ID="${SGA_BASENAME%.sga}"

echo "======================================================================"
echo "  CoH2 signed-pack load test"
echo "======================================================================"
echo "  SGA        : $SGA_PATH"
echo "  Numeric ID : $NUMERIC_ID"
echo "  Skins dir  : $SKINS_DIR"
echo "  Warnings   : $WARNINGS_LOG"
echo ""

# ---------------------------------------------------------------------------
# Copy into mods/skins
# ---------------------------------------------------------------------------
echo "Copying $SGA_BASENAME → $SKINS_DIR/"
mkdir -p "$SKINS_DIR"
cp -f "$SGA_PATH" "$SKINS_DIR/$SGA_BASENAME"
echo "  Done.  $(du -h "$SKINS_DIR/$SGA_BASENAME" | awk '{print $1}')"

# ---------------------------------------------------------------------------
# Launch CoH2 (only if --launch passed)
# ---------------------------------------------------------------------------
if [[ "$LAUNCH" -eq 0 ]]; then
  echo ""
  echo "Pack installed.  To complete the test:"
  echo "  1. Close any running game."
  echo "  2. Run:  steam steam://rungameid/231430"
  echo "  3. Load any skirmish that uses German / AEF / Soviet / OKW / British."
  echo "  4. After startup inspect warnings.log:"
  echo "       grep -i '$NUMERIC_ID\\|not signed\\|not unsigned\\|skin_pack' '$WARNINGS_LOG'"
  echo ""
  echo "Success markers  : lines containing '$NUMERIC_ID' with 'loaded' or 'registered'"
  echo "Failure markers  : 'not signed', 'not unsigned', 'invalid signature'"
  exit 0
fi

# --launch path
echo ""
echo "Launching CoH2 via Steam…"
# steam://rungameid/231430 is the CoH2 app ID
steam steam://rungameid/231430 &

echo "Waiting 30 s for the engine to start and write warnings.log…"
sleep 30

echo ""
echo "======================================================================"
echo "  Tailing $WARNINGS_LOG"
echo "  (press Ctrl-C to stop)"
echo "======================================================================"

# Watch for up to 120 s for relevant lines
timeout 120 tail -F "$WARNINGS_LOG" 2>/dev/null | while IFS= read -r line; do
  # Print every line for context
  echo "$line"

  # Verdict detection
  lower="${line,,}"
  if echo "$lower" | grep -qF "${NUMERIC_ID,,}"; then
    if echo "$lower" | grep -qE "loaded|registered|success"; then
      echo ""
      echo ">>> VERDICT: Pack $NUMERIC_ID appears LOADED successfully."
      break
    fi
  fi
  if echo "$lower" | grep -qE "not signed|not unsigned|invalid signature|signature.*fail"; then
    echo ""
    echo ">>> VERDICT: Signature REJECTED — engine reported: $line"
    break
  fi
done || true

echo ""
echo "Tail ended (or timed out).  Full check:"
echo "  grep -iE '$NUMERIC_ID|not signed|not unsigned|skin_pack' '$WARNINGS_LOG' | tail -30"
