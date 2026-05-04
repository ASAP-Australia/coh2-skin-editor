#!/usr/bin/env bash
# publish-templates.sh — upload template SGAs to CoH2 Workshop via steamcmd,
# then copy the signed downloads into tools/templates/signed/ and public/keys/.
#
# Usage:
#   ./tools/publish-templates.sh [--username STEAM_USER] [--count 1]
#
# The script will prompt for your Steam password + Guard code interactively.
# After upload, subscribe to each item in Steam, then re-run with --fetch-only
# to copy the signed SGAs and rebuild the manifest.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
STEAMCMD="${HOME}/.local/share/steamcmd/steamcmd.sh"
TEMPLATES_DIR="$SCRIPT_DIR/templates"
SIGNED_DIR="$SCRIPT_DIR/templates/signed"
KEYS_DIR="$PROJECT_DIR/public/keys"
COH2_APP_ID="231430"
COH2_SKINS_SUBS="${HOME}/.local/share/Steam/steamapps/common/Company of Heroes 2/mods/skins/subscriptions"
# Also check alternate Steam path
COH2_SKINS_SUBS2="${HOME}/.steam/steam/steamapps/common/Company of Heroes 2/mods/skins/subscriptions"

# Parse args
USERNAME="${STEAM_USERNAME:-}"
COUNT=1
FETCH_ONLY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --username) USERNAME="$2"; shift 2 ;;
    --count)    COUNT="$2";    shift 2 ;;
    --fetch-only) FETCH_ONLY=true; shift ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$USERNAME" ]]; then
  read -rp "Steam username: " USERNAME
fi

mkdir -p "$SIGNED_DIR" "$KEYS_DIR"

# ── FETCH-ONLY mode: scan subscriptions dir for signed SGAs ──────────────────
if [[ "$FETCH_ONLY" == true ]]; then
  echo "Scanning for signed SGAs in subscriptions directories…"
  FOUND=0
  for SUBS_DIR in "$COH2_SKINS_SUBS" "$COH2_SKINS_SUBS2"; do
    [[ -d "$SUBS_DIR" ]] || continue
    for SGA in "$SUBS_DIR"/*.sga; do
      [[ -f "$SGA" ]] || continue
      NAME="$(basename "$SGA")"
      echo "  Found: $NAME"
      cp "$SGA" "$SIGNED_DIR/$NAME"
      cp "$SGA" "$KEYS_DIR/$NAME"
      FOUND=$((FOUND + 1))
    done
  done
  if [[ $FOUND -eq 0 ]]; then
    echo "No signed SGAs found. Subscribe to the Workshop items in Steam and wait for download."
    exit 1
  fi
  echo "$FOUND SGA(s) copied."
  echo "Running build-manifest…"
  cd "$PROJECT_DIR"
  npx tsx tools/build-manifest.ts --signed "$SIGNED_DIR" --out "$KEYS_DIR"
  echo ""
  echo "Done! Rebuild the app (npm run build) and ship."
  exit 0
fi

# ── PUBLISH mode ──────────────────────────────────────────────────────────────
# Ensure templates exist
if [[ ! -d "$TEMPLATES_DIR" ]] || [[ -z "$(ls "$TEMPLATES_DIR"/*.sga 2>/dev/null)" ]]; then
  echo "No template SGAs found in $TEMPLATES_DIR"
  echo "Run: npx tsx tools/build-template.ts --count $COUNT"
  exit 1
fi

WORKSHOP_IDS=()

for SGA in "$TEMPLATES_DIR"/template_*.sga; do
  [[ -f "$SGA" ]] || continue
  SGA_NAME="$(basename "$SGA" .sga)"
  echo ""
  echo "═══ Publishing $SGA_NAME ═══"

  # Content folder: steamcmd workshop_build_item expects a folder whose
  # contents become the Workshop item. For CoH2 skin packs the item IS
  # the SGA file. We put the SGA at the root of the content folder.
  CONTENT_DIR="$(mktemp -d)"
  cp "$SGA" "$CONTENT_DIR/"

  # Preview image (1×1 PNG — required by Workshop API)
  PREVIEW="$CONTENT_DIR/preview.png"
  # Minimal 1×1 grey PNG (hardcoded bytes)
  printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82' > "$PREVIEW"

  # VDF file for steamcmd
  VDF="$(mktemp --suffix=.vdf)"
  cat > "$VDF" << VDF_EOF
"workshopitem"
{
  "appid"          "${COH2_APP_ID}"
  "contentfolder"  "${CONTENT_DIR}"
  "previewfile"    "${PREVIEW}"
  "visibility"     "0"
  "title"          "CoH2 Skin Key ${SGA_NAME}"
  "description"    "Pre-signed key template for the CoH2 Skin Editor. Do not subscribe — internal use only."
  "changenote"     "v1"
}
VDF_EOF

  echo "Content folder: $CONTENT_DIR"
  echo "Running steamcmd upload…"
  "$STEAMCMD" \
    +login "$USERNAME" \
    +workshop_build_item "$VDF" \
    +quit 2>&1 | tee /tmp/steamcmd_upload.log

  # Extract the Workshop item ID from steamcmd output
  ITEM_ID="$(grep -oP 'Published file id \K[0-9]+' /tmp/steamcmd_upload.log || true)"
  if [[ -z "$ITEM_ID" ]]; then
    ITEM_ID="$(grep -oP 'Workshop item \K[0-9]+' /tmp/steamcmd_upload.log || true)"
  fi

  rm -rf "$CONTENT_DIR" "$VDF"

  if [[ -n "$ITEM_ID" ]]; then
    echo "  ✓ Published: https://steamcommunity.com/sharedfiles/filedetails/?id=${ITEM_ID}"
    WORKSHOP_IDS+=("$ITEM_ID")
  else
    echo "  WARN: Could not extract Workshop item ID from steamcmd output."
    echo "        Check /tmp/steamcmd_upload.log"
  fi
done

echo ""
echo "══════════════════════════════════════════"
echo "Upload complete. Workshop item IDs:"
for ID in "${WORKSHOP_IDS[@]}"; do
  echo "  https://steamcommunity.com/sharedfiles/filedetails/?id=${ID}"
done
echo ""
echo "Next steps:"
echo "  1. Subscribe to each item above in Steam"
echo "  2. Wait for download to complete"
echo "  3. Run: $0 --fetch-only --username $USERNAME"
