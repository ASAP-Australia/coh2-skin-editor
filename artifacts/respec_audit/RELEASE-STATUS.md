# CoH2 Modding Tool — Release status (2026-06-14, end of autonomous session)

Deployed: ~/.local/bin/coh2-community-modding-tool.AppImage (latest build). Suite 1990 green, tsc clean.
Branch ci/auto-release-on-version-bump, all work UNCOMMITTED (per no-commit rule).

## DONE + test-verified this session
- Original spec A/B/C/D verified (B/C/D live earlier; A in-game decal+skin+faceplate [Sig:0]).
- Walkthrough rounds 1–3 + faceplate preview/resolution fixes.
- Faceplate SGA 6-file fix (root .dds) — in-game [Sig:0]. Faceplate icon sub-rect populated.
- Skin signed path: BC3 scoping + FBIF suppression → RGT == template 4,194,736 B; unsigned fallback.
- 377MB signing template bundled (extraResources). Native addon prebuilt refreshed (delete works).
- KONVA MIGRATION: decal + faceplate editors → react-konva, dark-mode, exports byte-identical
  (golden tests). Skin painter stays custom (CanvasTexture live-sync constraint).
- Two skeptical review rounds caught + fixed 7 real MAJOR bugs the green suite missed:
  R1: decal undo order, faceplate shape double-scale, stale paint layer, zoom-misaligned overlay.
  R2: skin workshopVisibility persistence, hardcoded-Unlisted auto-sync (the user's visibility bug!),
      export excluding unvisited faction/all-scope vehicles.
- Tiger exhaust: searched all 13 Art SGAs / 431 files / 36 models — NO exhaust geometry exists
  (FX-only). Not a bug; loader correct.

## NEEDS-LIVE (only the user's screen can confirm — DO THESE NEXT)
Konva editors (relaunch app):
- [ ] Decal: render/select/move/scale/rotate/flip, multi-select drag (one undo), draw tool, pan/zoom,
      reference previews, undo after a drag restores pre-drag position (R1 MAJOR-4 fix).
- [ ] Faceplate: complex shapes render as real shapes at scale≠1 (R1 MAJOR-3), 2nd paint stroke shows
      (R1 MAJOR-2), draw overlay aligned at zoom=2 (R1 MAJOR-1), all layer types, filters, F1.
- [ ] Dark-mode canvas surfaces in both editors look right (dark #1a1c22 + subtle checker).
Workshop (R2 fixes):
- [ ] Set Friends-only on a published item, make an edit (triggers auto-sync), reopen — stays
      Friends-only (NOT demoted to Unlisted). Repeat for skin/faceplate/decal.
- [ ] Skin publish visibility selector remembers its value across popover open/close.
Export completeness (R2 MAJOR-2):
- [ ] Apply an "all vehicles" / faction skin via Generate modal WITHOUT visiting each vehicle,
      export, confirm in-game ALL matching vehicles show the skin.
In-game (game-harness, one CoH2 launch):
- [ ] Signed skin SGA loads [Sig:0]; faceplate SGA loads [Sig:0] on the current build.
- [ ] A3 Workshop publish cycle: private→friends→public readback, then delete from Workshop.

## OPEN DECISIONS (user)
- Tiger "exhaust": fabricate geometry (would diverge from in-game, which has none) OR accept FX-only.
- "All 2D editors on the package": skin Edit-Texture painter stays custom (live 3D sync) — accept?

## OLDER DEFERRED (pre-session, still open, need visual verification)
- Panzerwerfer Z-fighting; Brummbär texture; Churchill dark texture; chunked-block-storage reader.
