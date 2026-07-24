# Final live verification checklist (RELEASE AppImage via CDP harness — verify BEFORE deploy)

IMPORTANT: test the freshly-built artifact, NOT the deployed one:
`COH2_APP="/home/jflessenkemper/dev/coh2-skin-editor/release/CoH2 Skin Editor-1.1.0.AppImage" node scripts/harness/harness.mjs launch`

## ROUND 2 — regression + correction checks (HIGHEST PRIORITY, run first)
- [ ] R1: open RespecSkin via Continue → the VEHICLE RENDERS IMMEDIATELY, no clicking another vehicle first (screenshot at t0 + t2s).
- [ ] R2: King Tiger texture looks correct; switch UK vehicle → German → UK repeatedly: German stays normal, UK visibly brighter, values stable across switches (no drift/darkening). Also change season with a UK vehicle selected → still boosted.
- [ ] R3: NO export button/section ANYWHERE (no floating button, no popover export entry). The title pill shows the live-sync StateIcon; its popover contains the in-game preview grid + publish — nothing labeled Export. The Edit Texture toolbar has the Download-PNG action instead.
- [ ] R3b: AUTO-SYNC works — make a small edit to the skin project, wait ~2.5 s, confirm mods/skins/<numericId>.sga mtime updated (record path + mtime before/after).
- [ ] R4: template opener lists INSTALLED skin packs with real display names (e.g. "Prinses Irene Brigade Skin Pack"), instantly (prefetched).
- [ ] R5: decal-pack opener lists INSTALLED decal packs with real names (e.g. "German Empire Semi-Historical Decals"), no "Workshop <number>" junk.
- [ ] R6: Edit Texture view chrome matches the faceplate editor family (glass toolbar, tool pill, options peel) — screenshot.
- [ ] R7: Edit Texture opens FIT-TO-WINDOW and CENTERED (h+v); wheel zoom anchors at cursor; space-drag and middle-drag PAN without painting a single dab and without creating an undo frame.
- [ ] R8: all sliders (brush size/softness/opacity, decal rotation/size) use the blue editor accent — zero orange anywhere.
- [ ] R9 (user report 2026-06-11): CREATE A NEW skin pack. For EACH faction — especially OKW and Wehrmacht — confirm the FIRST/default vehicle renders immediately with no interaction. If a first vehicle fails: capture console errors (suspect chunked-block-storage model loads, e.g. Tiger-class), note the exact vehicle id, try click-away-and-back and record whether it EVER renders. Screenshot per faction.


Evidence dir: /tmp/coh2-evidence/final/ — screenshot per check, named by ID. Baselines for
comparison: /tmp/coh2-evidence/feedback/*.png (pre-fix state).

## D — zero-loading (spec item D + F1/F3)
- [ ] D1: app launch → start screen time (note seconds); Connect → usable (note seconds).
- [ ] D2: saved-projects list renders instantly — NO "Loading projects…" (screenshot list).
- [ ] D3: open saved skin project → editor interactive immediately; NO "Loading" label, no FLIP hold (rapid screenshots t0/t0.5/t1.5).
- [ ] D4: season toggle swap — instant, no 600ms beam minimum.

## F2 — open-state correctness
- [ ] F2-1: open RespecSkin → NO winter flash (t0 screenshot shows summer/correct scene).
- [ ] F2-2: vehicle visibly rendered after open (stock texture if project has no paint).

## B — editor parity (spec item B; per-editor)
Skin editor:
- [ ] B1: paint a stroke → Ctrl+Z visibly reverts pixels (before/after screenshots).
- [ ] B2: ? / F1 opens shortcut sheet showing "Vehicle editor" group (from shared data).
- [ ] B3: VehicleTextureEditor (Edit Texture): wheel zoom at cursor + Space-drag pan + [ ] brush size.
Decal editor (DPE):
- [ ] B4: select decal → on-canvas resize/rotate handles; one Ctrl+Z reverts a whole handle gesture.
- [ ] B5: numeric X/Y/W/H/° row — edit W + Enter commits once (one undo frame), Esc reverts draft.
- [ ] B6: N opens import picker; Ctrl+D duplicates; [ / ] reorders in select mode; Esc deselects.
- [ ] B7: wheel zoom (B1-fix), Ctrl+= / Ctrl+- / Ctrl+0 fit / Ctrl+1 100%, Space-drag pan.
- [ ] B8: plain click on canvas does NOT wipe redo (undo, click, redo still works).
Faceplate editor (FPE):
- [ ] B9: drag/resize/rotate = ONE undo frame per gesture; F1 overlay opens; ? button bottom-right.
- [ ] B10: double-click layer renames (Enter commits once, Escape cancels); drag-reorder layers (undoable).
- [ ] B11: flip H/V on image layer; grid-snap toggle + step; opacity slider on text/shape/image; blend modes.
- [ ] B12: Ctrl+= / - / 0 / 1 zoom + Space-drag pan (no zoom pill — by design).

## C — decal rendering (spec item C)
- [ ] C1: decal pill menu shows "This vehicle / All vehicles" scope; switching works.
- [ ] C2: decal on vehicle is SHARP at high zoom (screenshot zoomed onto decal).
- [ ] C3: a Workshop-sourced decal pack appears in the pill list AND previews (not blank).
- [ ] C4: no center-top title-label template above vehicle selector.
- [ ] C5: decal editor's own 3D preview (AtlasPreview3D) shows decal at correct position, sharp.

## F — walkthrough fixes
- [ ] F5: template opener lists Workshop skins instantly (prefetched — no "Loading workshop items…" hint).
- [ ] F6: template menu uses custom scrollbar (screenshot vs feedback/F6 baseline).
- [ ] F7: toolbar row = [Template pill][Decal pill] left, [Season toggle][Edit Texture] right (vs F7 baseline).
- [ ] F8: click top-center title label → black transparent scrim behind menu (vs F8 baseline).
- [ ] F9: season icons look clearly clickable (dimmed inactive, hover brightens) (vs F9 baseline).
- [ ] F10: vehicle menu custom scrollbar (vs F10 baseline).
- [ ] F12: British + American vehicles visibly brighter (same vehicles/angles as feedback/F12-uk/us/de baselines; German unchanged).
- [ ] F4: no explode button anywhere in the editor UI.

## A — export + publish (spec item A)
- [ ] A-SYNC: deployment is AUTOMATIC via live-sync (no manual export exists, by design — matches decal/faceplate). For skin AND faceplate: make an edit in each editor, wait for sync (title-pill StateIcon reaches synced), then locate the auto-written SGA in the game mods dir (skins/<id>.sga, faceplates/subscriptions/<id>.sga); copy both to /tmp/coh2-evidence/final/ with paths + sha256. These are the G1/G2 inputs.
- [ ] A3 publish cycle on RespecDecal (small): publish PRIVATE → readback shows item+visibility; update FRIENDS-ONLY → readback; update PUBLIC → readback; "Delete from Workshop" → workshopId cleared, row updates; NO crash at any step (screenshot each state).

## In-game (after app session ends; game-harness; CoH2 will launch)
- [ ] G1: harness verify the UI-exported skin SGA → ARC [Sig:0], zero failure lines.
- [ ] G2: harness verify the UI-exported faceplate SGA → ARC [Sig:0], zero failure lines.
- [ ] Capture warnings.log delta to /tmp/coh2-evidence/final/.

Any FAIL: capture screenshot + console errors, continue the rest, report all fails together.
