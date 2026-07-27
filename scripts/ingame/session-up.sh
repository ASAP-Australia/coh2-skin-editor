#!/bin/bash
# Bring up an OFF-SCREEN nested KWin compositor with Xwayland.
#
# Everything CoH2/WorldBuilder-related runs inside this so it never touches the
# user's desktop and never needs Steam launch-option changes.
#
# NOTE: identify the nested X display by OUTPUT NAME, not by grepping for
# Xwayland — that finds the HOST's Xwayland and hands back :0, i.e. the real
# monitor. The nested one reports output "Virtual-0".
set -u
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
SOCK=${WB_SOCK:-wb-session}

rm -f "$XDG_RUNTIME_DIR/$SOCK" "$XDG_RUNTIME_DIR/$SOCK.lock" 2>/dev/null

nohup dbus-run-session -- env -u WAYLAND_DISPLAY -u QT_QPA_PLATFORM \
  KWIN_WAYLAND_NO_PERMISSION_CHECKS=1 KWIN_SCREENSHOT_NO_PERMISSION_CHECKS=1 \
  kwin_wayland --virtual --no-lockscreen --width "${WB_W:-2560}" --height "${WB_H:-1440}" \
  --xwayland -s "$SOCK" > /tmp/wb-kwin.log 2>&1 &
echo "[up] kwin bg pid $!"

for i in $(seq 1 60); do
  [ -e "$XDG_RUNTIME_DIR/$SOCK" ] && { echo "[up] wayland socket ready"; break; }
  sleep 0.5
done
[ -e "$XDG_RUNTIME_DIR/$SOCK" ] || { echo "[up] FAILED: no wayland socket"; exit 1; }

# Find the display whose output is Virtual-0.
for i in $(seq 1 30); do
  sleep 1
  for d in :1 :2 :3 :4; do
    if DISPLAY=$d timeout 4 xrandr 2>/dev/null | grep -q "Virtual-0"; then
      echo "$d" > /tmp/wb-display
      echo "[up] nested display = $d"
      exit 0
    fi
  done
done
echo "[up] FAILED: no Virtual-0 display appeared"
exit 2
