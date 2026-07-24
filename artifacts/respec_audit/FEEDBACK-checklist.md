# Respec campaign — authoritative fix checklist + scope rulings (2026-06-10)

Inputs: user live walkthrough (F1–F12), live-app diagnostics (LIVE-findings.md, N1–N4),
code audits (B-editors.md, C-decal-render.md, D-loading.md), roster check (F11-roster.md).
Evidence screenshots: /tmp/coh2-evidence/feedback/*.png (F2-t0..t3, F5–F12 current-state).

## P0 — correctness bugs (must land)
- **N5 Faceplate SGA rejected in-game (HIGHEST):** A2 verify (2026-06-10 23:01, /tmp/coh2-evidence/a2/RESULT.md):
  decal PASS, skin PASS, faceplate FAIL — `ARC ... [Sig:0]` then `MOD -- Error loading mod pack
  '...respec-faceplate.sga': invalid file structure.` Engine opens the archive (TOC/sig OK) but rejects
  internal structure. Since decal+skin from the same writer pass, suspect the faceplate pack's CONTENT
  layout (file set / folder tree / file naming inside the archive), not sga-writer bytes. Diagnose FIRST:
  (1) look for a previously verified faceplate SGA (game's faceplates/subscriptions/ dir, prior-session
  artifacts, or Workshop-subscribed faceplates) as known-good reference; (2) dump both archives' drive/
  folder/file trees with the repo's SGA reader; (3) diff trees, fix the faceplate export content builder;
  (4) MUST re-verify in-game via game-harness (faceplate only) after the fix.
- **N1 Export UI unreachable (HIGH):** ViewPanel has no opener; `setActivePanel('export')` only
  reachable from inside ViewPanel. Add a proper Export entry point in the toolbar (match existing
  design language). Do NOT change buildSkinPack/SGA bytes — wiring only.
- **N2 Export gate wrong:** TopBar editedCount counts decal'd vehicles only; painted-only vehicles
  must also count/unlock Export.
- **F2a Winter flash:** envName initialises 'mission_06' (winter) regardless of project season →
  initialise from project season; no flash of wrong scene.
- **F2b No tank on blank project:** project without customDiffuseUrl/camoPreset renders no/transparent
  vehicle → must render stock texture by default.
- **F2c/F1/F3 Loading label + double render on editor open:** kill 'editor-loading' visible label,
  the 620/600 ms App.tsx FLIP holds, and the invisible-mount → second-render; open must be instant.
- **Undo correctness (B audit):** skin paint undo broken (decal-history.ts snapshots only decals);
  faceplate per-pointermove undo flood (one frame per gesture, not per tick); decal-editor drag +
  multi-move bypass undo (undoable:false never committed).
- **F5/N4 Workshop content missing in openers:** listWorkshopItems() returns 0 while filesystem scan
  finds subscribed item 3728271474 → fix the bridge/query; template + decal openers must list
  Workshop skins/decals; plus C-audit fix: pill preview must resolve Workshop-sourced packs
  (workshopId fallback, today silently blank).
- **D blocking paths:** SavedProjectsList getRealWorkshopId full-parses 5–20 MB blob per row per
  render → lazy metadata index (backward compatible, no eager rewrite-all); listAll* parse-everything
  on mount → metadata-only list; persistActive full stringify per brush dab → throttle/debounce;
  SeasonToggle 600 ms artificial min → tie to real readiness; "Loading projects…" → instant render.

## P1 — user-requested UI changes (must land)
- **F7 Toolbar layout:** template + decal pills LEFT; season toggle + Edit Texture to the RIGHT of
  decal pill (not above).
- **F6/F10 Custom scrollbars:** template opener menu + US (all-faction) vehicle selector must use the
  same custom scrollbar style as the Load Project list. Prefer a shared class.
- **F8 Title-menu scrim:** clicking top-center title label → black semi-transparent backdrop behind
  the title menu.
- **F9 Season icons:** neutral/blank clickable icon buttons with clear hover/active affordance
  (see F9-season-icons.png for current state).
- **F12 Lighting:** increase viewport lighting for British + American vehicles (too dark; Soviet/
  German fine). Per-faction exposure/intensity factor; verify visually via screenshots.
- **F4 Explode removal:** explode functionality was removed earlier — verify ExplodeButton is
  vestigial (grep mounts), then delete component + its test (retires the known-failing
  "inactive variant" test). If still mounted somewhere, remove the mount too.
- **C: AtlasPreview3D.tsx** hardcodes old wrong King Tiger rect + low-quality upscale → use shared
  badge-rect registry + same supersample path as verified Editor path. Remove stale
  TemplateSelectSection comment (TemplateDecalPills.tsx:8).

## P1.5 — Photoshop-parity via SHARED PRIMITIVES (user architecture ruling 2026-06-10)
User decision: do NOT patch the three editors piecemeal and do NOT rebuild the texture editor on the
faceplate engine this campaign. Instead EXTRACT shared primitives into src/components/editor-shared/
(or src/lib/ where logic-only) and migrate all three editors onto them:
- **Shared history/undo engine** (single implementation; gesture-granular commits — one frame per
  drag/stroke, not per pointermove; covers ALL mutations incl. paint, multi-move, drags). The P0 undo
  fixes above MUST be implemented as this shared engine + per-editor migration, not as local patches.
- **Shared on-canvas transform handles** (generalize faceplate CanvasHandles; mount in DecalPackEditor).
- **Shared numeric transform inputs** (X/Y/W/H/angle row) wherever objects are transformable.
- **Shared zoom/pan/fit-to-window control** (incl. skin/texture editor 2048² atlas; respect FaceplateEditor
  zoom-pill "removed by design" rationale only if it genuinely conflicts).
- **Shared shortcut-overlay component** (F1) fed per-editor from one truthful shortcuts data source;
  implement N / Ctrl+D / [ ] reorder in DecalPackEditor (don't delete entries).
- Faceplate polish on top: flip UI, layer rename, drag-reorder, grid snap, opacity for all layer types,
  blend modes where sensible.
- Full layer-engine unification of the texture editor = v1.3 follow-on (see .llm/v1_3_0_design/), OUT of scope.

## P2 — cheap/cut
- Stale comment removal: include (free). Supersample sharpness test: include if cheap.
- Multi-decal preview: CUT this round. devicePixelRatio cap 1.5→2: leave as is.

## No-change items
- **F11 roster:** verified correct — US shows 17, all skinnable (validated vs ArtAEFSkins.sga,
  roster_validation.md 2026-06-03). Report only.

## Hard constraints
- Do NOT touch src/lib/sga-writer.ts or SGA byte-format logic in mod-export.ts (in-game verified;
  N1 is UI wiring only). SOLE EXCEPTION: if N5 diagnosis PROVES the faceplate failure originates in
  sga-writer.ts, the minimal fix is allowed — but then ALL THREE pack types must be re-verified
  in-game (a writer change invalidates the decal/skin PASS evidence).
- Persistence changes lazily backward compatible; no eager rewrite-all migrations.
- Every P0 fix gets a test; npx tsc -b clean; vitest green (ExplodeButton test removed with F4).
- Match existing design language (top toolbar + sub-menus, editor-primitives/); no new deps.
