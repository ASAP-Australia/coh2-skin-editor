#!/bin/bash
# Launch Company of Heroes 2 into the OFF-SCREEN nested display.
#
# Beats the old AOE3DEHarness route outright: no Steam LaunchOptions edit, no
# `steam -shutdown`, no restore step, and nothing renders on the user's desktop.
# Steam MUST be running (CoH2 is CEG-protected).
#
# GOTCHA: `proton run` REQUIRES AN ABSOLUTE PATH to the exe. A relative path
# exits 1 immediately, printing nothing beyond "wineserver: NTSync up and
# running!", which looks identical to the app refusing to start.
set -u
GAME="/var/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2"
export STEAM_COMPAT_DATA_PATH="/var/home/jflessenkemper/.local/share/Steam/steamapps/compatdata/231430"
export STEAM_COMPAT_CLIENT_INSTALL_PATH="/home/jflessenkemper/.steam/steam"
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
export SteamAppId=231430
export SteamGameId=231430
PROTON="/home/jflessenkemper/.steam/steam/compatibilitytools.d/GE-Proton10-34/proton"

unset WAYLAND_DISPLAY
export DISPLAY="${WB_DISPLAY:-$(cat /tmp/wb-display 2>/dev/null || echo :1)}"

cd "$GAME" || exit 3
echo "[coh2] DISPLAY=$DISPLAY"
exec "$PROTON" run "$GAME/RelicCoH2.exe" -window 2>&1
