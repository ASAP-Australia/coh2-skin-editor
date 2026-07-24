# Photoshop-parity editor campaign (live dev loop, 2026-06-15)

Goal: perfect the faceplate (then decal) editor to Photoshop parity — users come from Photoshop.
Method: live dev loop — drive the running dev editor (CDP :9222, HMR), exercise EVERY tool,
observe issues, fix via HMR, verify with screenshots (coordinator reads them). Match the app's
DARK GLASS language (floating glass panels + center-bottom tool pill) — already unified in r1-r3.

## Photoshop-parity reference checklist (what a PS user expects)
LAYERS: visibility · opacity · blend modes · lock · rename · drag-reorder · duplicate (Ctrl+J/Cmd+J)
  · delete · group/ungroup (Ctrl+G) · clipping mask · merge · multi-select · thumbnails.
TRANSFORM: move · scale (Shift=aspect lock) · rotate (Shift=15° snap) · flip H/V · numeric X/Y/W/H/°
  · free transform · arrow-key nudge (+Shift=10px) · alt-drag duplicate.
SELECT/MOVE: V=move, click-select, marquee/rubber-band multi-select, Esc deselect.
TEXT: font · size · weight · style (B/I) · color · align · letter/line spacing · stroke. (T tool)
SHAPES: rect/ellipse/polygon · fill · stroke · gradient · corner radius.
DRAW/BRUSH: size · hardness · opacity · color · eraser (E). (B tool)
COLOR: picker · eyedropper (I) · hex · swatches.
ALIGN/DISTRIBUTE: align to canvas/selection (L/C/R, T/M/B) · distribute.
GUIDES/SNAP: smart guides · snap to center/edges of other objects + canvas · grid · rulers.
ZOOM/PAN: wheel zoom-at-cursor · space-drag pan · fit (Ctrl+0) · 100% (Ctrl+1).
HISTORY: undo/redo (Ctrl+Z / Ctrl+Shift+Z) gesture-granular · shortcut overlay (F1/?).
SHORTCUTS: tool letters (V/T/B/E/I) · Ctrl+Z/Y · Ctrl+J dup · Ctrl+G group · Ctrl+D deselect
  · Ctrl+]/[ reorder · Delete · arrows nudge.

## Visual polish already done (r1-r3, live)
Floating glass panels matching the tool pill (rgba(20,22,28,0.62), blur36, radius16, inset12);
banner = lighter #2a2d3c document centered in the gap between panels, fully visible, with checker
+ border + shadow + dim chip; fit-to-window against the inset rect.

## Known minor items to polish (from r3 screenshot)
- Banner sits slightly high → true vertical center of the open area.
- Layers row opacity shows "10" while Properties shows 100% → stale field value, check.
- Title pill "My Faceplate" blue glow heavier than the clean glass elsewhere → tone down.

## Loop cadence
Dynamic /loop. Each tick: audit/fix ONE area, verify via screenshot, bank progress here. Single
Sonnet agents (cap-safe, no big workflows). Periodically `npx tsc -b` + `npx vitest run`; build+
deploy to the real AppImage at milestones. Edits land in the working tree (HMR live).

## Progress
- Tick 1: full tool/parity audit dispatched → PS-PARITY-AUDIT.md + /tmp/coh2-evidence/parity/.
