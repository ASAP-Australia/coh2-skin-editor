#!/bin/bash
# Drive off-screen CoH2: main menu -> ASAP Verify skirmish -> capture the
# vehicle grid during the SCAR pin window.
#
# TIMING MATTERS: ASAPVerify_PinHero runs at 0.5 s cadence and self-removes at
# pinTicks >= 60, i.e. a THIRTY SECOND window. Capture after that and the view
# has drifted off the vehicles, which is what made the camera look broken for
# most of this project's history.
#
# INPUT GOTCHAS baked in below:
#  - the game tracks its cursor via raw input, so a warped X pointer leaves
#    hover state stale; jiggle with mousemove_relative before each click
#  - menu transitions take 10-15 s; capturing early looks like a failed click
#  - `import` can return a STALE pixmap; every capture is taken twice
#  - the win-condition dropdown's down-arrow stalls after ~10 clicks; move the
#    pointer OFF the arrow and back to re-arm, then click in batches of ~5
set -u
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
export DISPLAY="${WB_DISPLAY:-$(cat /tmp/wb-display 2>/dev/null || echo :1)}"
O="${OUTDIR:-/var/home/jflessenkemper/dev/coh2-skin-editor/artifacts/ingame-offscreen}"
mkdir -p "$O"

W=$(wmctrl -l | grep -i "company of heroes" | awk '{print $1}' | head -1)
[ -z "$W" ] && { echo "no CoH2 window on $DISPLAY"; exit 1; }
eval "$(xwininfo -id "$W" | awk '/Absolute upper-left X/{print "OX="$4} /Absolute upper-left Y/{print "OY="$4}')"
echo "window $W at $OX,$OY on $DISPLAY"

shot(){ import -window "$W" "$O/$1" 2>/dev/null; sleep 0.4; import -window "$W" "$O/$1" 2>/dev/null; }
click(){ xdotool mousemove $((OX+$1)) $((OY+$2)); sleep 1
         xdotool mousemove_relative -- 3 3; sleep 0.4
         xdotool mousemove_relative -- -3 -3; sleep 0.6; xdotool click 1; }

xdotool windowactivate "$W" 2>/dev/null; sleep 3
echo "menu -> Online & Skirmish";  click 379 507;   sleep 16
echo "     -> Create Custom Game"; click 1531 855;  sleep 24
echo "     -> Options";            click 1282 1243; sleep 12
echo "     -> Win Condition";      click 1594 529;  sleep 6

# Scroll to the "A" block. Numeric mods (10X/1X/2X/3X/5X...) sort first.
for b in $(seq 1 6); do
  xdotool mousemove $((OX+1300)) $((OY+700)); sleep 0.4
  xdotool mousemove $((OX+1598)) $((OY+872)); sleep 1.2
  for i in $(seq 1 5); do xdotool click 1; sleep 0.55; done
done
sleep 1
# Overshoots into CZ(v2); step back up to land on ASAP Verify.
xdotool mousemove $((OX+1300)) $((OY+700)); sleep 0.4
xdotool mousemove $((OX+1598)) $((OY+558)); sleep 1.2
for i in $(seq 1 5); do xdotool click 1; sleep 0.55; done
sleep 2
shot drive-list.png
echo "     -> pick ASAP Verify"
xdotool mousemove $((OX+1300)) $((OY+700)); sleep 0.4
xdotool mousemove $((OX+1380)) $((OY+651)); sleep 1.2
xdotool mousemove_relative -- 2 0; sleep 0.4; xdotool click 1; sleep 5
shot drive-picked.png

echo "     -> close Options"; click 1280 1131; sleep 8
echo "     -> add CPU";       click 2127 456;  sleep 8
shot drive-lobby.png
echo "     -> START";         click 1282 1359

echo "loading (~165 s)…"; sleep 165
xdotool key --window "$W" space; sleep 2
xdotool key --clearmodifiers space; sleep 2
xdotool mousemove $((OX+1200)) $((OY+800)); xdotool click 1; sleep 1

echo "=== pin-window captures ==="
for t in $(seq 1 12); do
  shot "pin-$(printf %02d $t).png"
  echo "  t+$((t*3))s"
  sleep 3
done
echo done
