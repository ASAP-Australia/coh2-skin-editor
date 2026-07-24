# Final review — respec fix campaign (2026-06-11)

Scope: full diff vs HEAD (~33 modified + 11 new files), checked against
`IMPLEMENTATION_PLAN.md` and `FEEDBACK-checklist.md`. `npx vitest run` 1786/1786
green and `npx tsc -b` clean were taken as given (not re-run).

## Hard-constraint compliance — PASS

- `src/lib/sga-writer.ts` / `mod-export.ts`: **untouched** (verified via `git diff`).
- `src/lib/faceplate-mod-build.ts`: change is exactly the 6th-file addition
  (root-level `${slug}.dds` → drive 2 "info") + comments. Compliant with the
  N5 hypothesis fix. NOTE: in-game harness PASS for the rebuilt faceplate pack
  cannot be verified statically — must be confirmed in the live pass (Phase 1
  step 4 was MANDATORY even with no code change).
- Persistence: lazy backfill only, no eager rewrite-all migration (project.ts /
  faceplate-project.ts / decal-pack-project.ts all parse-on-miss + write-back).
- No new artificial delays; `EDITOR_LOADING_MS` / `EDITOR_LOADING_MIN_MS` /
  `SEASON_MIN_LOADING_MS` all deleted. "Loading workshop items…" hint exists
  (TemplateDecalPills.tsx:432-436) but is mitigated by a mount-time
  `requestIdleCallback` prefetch and only renders when stock+saved are also empty.
- No new deps; design language (glass pills, editor-primitives) matched.

## Known-suspect ruling: FPE layer drag-reorder — RESOLVED, undoable

`onLayerDrop` (FaceplateEditor.tsx:~440-460) commits the reorder through plain
`mutate(...)` (undoable default true) → layer ORDER is document state and gets a
proper undo frame. Flip H/V, opacity, blend-mode all go through `mutateLayer` →
undoable. Rename is NOT clean — see M5.

---

## BLOCKER (must fix before build)

### B1. DecalPackEditor mouse-wheel zoom is dead (regression)
`DecalPackEditor.tsx:591-597` wires `usePanZoom` to `stageRef`, but `stageRef`
is attached at ~line 1354 to a **self-closing sibling overlay** with
`pointerEvents: 'none'`:
```tsx
<div ref={stageRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
```
A `pointer-events: none` element is never the hit-test target, and it is a
*sibling* (not ancestor) of the canvas subtree, so wheel events neither target
it nor bubble through it. The old working wheel handler on `canvasRef` was
deleted in the same diff. Result: scroll-to-zoom — a previously working core
interaction — does nothing in the decal editor (Ctrl+= still works).
**Fix:** attach `usePanZoom`'s `containerRef` to the real stage/canvas container
(the element that previously owned the wheel listener, i.e. `canvasRef`'s
ancestor wrapper), delete the dummy overlay; keep `getBoundingClientRect`-based
Fit working off the same element.

### B2. Skin-editor persist "debounce" is defeated — P0 perf fix is a no-op
`Editor.tsx` persist effect (~951-980): the flush was put in the **same
effect's cleanup**, with deps `[repaint, project]`. React runs cleanup on every
dependency change, so on every project change (every brush dab / drag tick) the
sequence is: cleanup → `persistActive(projectRef.current)` **synchronously** →
effect re-runs → re-arm timer. Net behavior: full multi-MB stringify per change
(exactly the old cost), *plus* an extra trailing write 400 ms later. The
checklist P0 "persistActive full stringify per brush dab → throttle/debounce"
is therefore not fixed.
**Fix:** flush only on unmount via a separate empty-dep effect:
```ts
useEffect(() => () => {
  if (persistDebounceRef.current != null) { clearTimeout(...); persistActive(projectRef.current) }
}, [])
```
and remove the flush from the per-change cleanup (the body already re-arms the
timer). Keep the existing synchronous `persistActive` on the close-pack path.

---

## MAJOR (fix before declaring PASS)

### M1. Paint-snapshot memory cap is dead code; its test is a tautology
`decal-history.ts` commit wrapper: `pixelFrameCountRef` is incremented and then
merely **clamped back to 8** — nothing ever prevents `captureSnapshot` from
embedding `diffusePng` (a full 2048² PNG dataURL, multi-MB) into every
Paint/Clear frame, and nothing nulls the oldest frame. Up to 50 pixel-bearing
frames can accumulate (plan: max 8, evict oldest). The covering test
(`editor-history.test.ts:299-320`) **re-implements the eviction inside the test
body** ("oldest eviction approximation") and never exercises the production
hook — it passes regardless. Also note its approximation drops pixels from the
*newest* frames, the opposite of the plan's "null the oldest".
**Fix:** keep a ring of references to captured pixel-bearing snaps inside
`useDecalHistory`; on the 9th capture, null `diffusePng` on the oldest
referenced snap (object identity is shared with the engine stack, so an
in-place field write works). Rewrite the test to drive the real hook.

### M2. Pan is inert in all three editors, yet the shortcut overlay advertises it
- FPE / DPE: `pz.handlers` are never spread on any element and `pz.offset` is
  never rendered → Space-drag / middle-drag pan does nothing; the wheel
  zoom-at-cursor offset math in `use-pan-zoom.ts:200-206` is computed and
  discarded (zoom stays center-anchored).
- VTE (`VehicleTextureEditor.tsx:304-311`): spreads `{...pz.handlers}` but the
  transform is `scale(${pz.scale})` only — pan mutates state that is never
  drawn.
- `keyboard-shortcuts-data.ts` now adds "Space + drag — Pan canvas" and
  "Middle-drag — Pan canvas" to the *common* group → the "truthful shortcuts
  data source" (Phase 6d) ships untruthful rows in every editor.
**Fix:** either render `translate(offset) scale(scale)` + spread handlers on
each stage (and verify paint-coordinate math under translate in VTE), or strip
pan from the hook usage and delete the two KSD rows. Half-wired is the worst
state.

### M3. Gesture leak: no `pointercancel` handling anywhere; engine cannot recover
All gesture sites listen only for `pointerup`: DPE `beginCanvasDrag`
(onUp ~980), DPE paint stroke (~1089), FPE `beginDrag` (~4230), FPE paint
stroke (~929), `CanvasHandles` resize/rotate (onUp). If `pointercancel` fires
instead (pointer capture loss, OS gesture, window switch mid-drag),
`endGesture()` never runs, `gestureDepthRef` stays >0 forever, and **every
subsequent mutation in that editor is silently non-undoable** for the rest of
the session. `editor-history.ts` has no self-heal (a later `beginGesture` just
increments further).
**Fix:** register `pointercancel` (and ideally `lostpointercapture`) alongside
every `pointerup` handler to run the same cleanup; additionally make the engine
defensive (e.g. `endGesture` on `pointerdown` of a new gesture when depth is
already >0, or an explicit `resetGesture()` called from each begin site).

### M4. Plain click pushes a no-op undo frame and wipes the redo stack
`beginGesture` (editor-history.ts:93-104) pushes the pre-gesture frame and
**clears redo immediately at pointerdown**. DPE `beginCanvasDrag` and FPE
`beginDrag` run on every select-click, drag or not. Consequences: (a) clicking
decals/layers to inspect them litters the undo stack with do-nothing frames
(Ctrl+Z appears broken — "nothing happened"); (b) undo N steps → click a decal
→ redo stack gone, work unrecoverable. This follows the plan's letter but is a
real UX defect.
**Fix:** capture the snapshot at `beginGesture` but push it lazily on the first
`mutate`/`commit` that occurs while the gesture is open (one-flag change in the
engine); redo then survives no-op clicks.

### M5. FPE layer rename: silently discards input for text/shape/paint; double/no-op commits for image
`FaceplateEditor.tsx` rename input (~2203-2270):
- Enter on a **text/shape/paint** layer: the `mapLayer` updater returns `l`
  unchanged for those kinds → typed name is thrown away, yet the no-op `mutate`
  still pushes an undo frame + persists + live-syncs.
- Enter on an **image** layer: first a no-op `mutate` (dead `if (img) return l`
  branch), then a second `mutate` writing `images[imgId].name` → 2 undo frames,
  the first inert; the input then unmounts and the `onBlur` handler can fire a
  **third** commit.
- **Escape does not cancel** for image layers: blur fires afterwards and
  commits the typed name anyway.
**Fix:** one `mutate` handling all kinds (store a `name` field on the layer, or
keep image-name behavior but skip the no-op first mutate); guard `onBlur` with
a "committed/cancelled" flag set by the keydown handler.

### M6. TransformInputsRow commits on every keystroke (spec says blur/Enter)
`editor-shared/TransformInputsRow.tsx:108-113` — its own header says "All
inputs commit on blur or Enter" but `NumField` calls `onChange` on every
keystroke. In both DPE and FPE these route to undoable `mutate` → typing "120"
= 3 undo frames + 3 persists + 3 live-sync schedules; W/H clamp intermediate
values live. This reintroduces exactly the per-tick flood Phase 2 removed
(plan 6b explicitly required commit on blur/Enter). Also `value={Math.round(value)}`
on a controlled input makes the field impossible to clear/type decimals into.
**Fix:** local draft string state; parse+commit on blur/Enter; Esc reverts.

---

## MINOR (note)

1. **FPE `editorZoom` no longer persisted** — old persist effect deleted; new
   `usePanZoom` only *reads* `initialProject.editorZoom` (FaceplateEditor.tsx:455).
   DPE kept its persist effect (DPE:604). Pass `onChange` to `usePanZoom` or
   restore the effect. (Comment "Persisted per-project…" is now false.)
2. **Decal/faceplate list counts wrong off-registry** — index entries lack
   count fields, so `listAllDecalPacks` fast path shows `decalCount: 0`
   (decal-pack-project.ts:754) and `listAllFaceplates` shows `layerCount: 0`
   for any pack that fell off the 12-entry recent registry. Plan's golden-compare
   test doesn't cover the second (index-hit) call's counts. Add the count to the
   index entry (mirror skin's `vehicleCount`).
3. **usePanZoom Space handler breaks button activation** — `preventDefault()`
   on Space exempts only INPUT/TEXTAREA (use-pan-zoom.ts:157-166); focused
   `<button>`s in DPE/FPE/VTE lose Space activation while those editors are open.
4. **DPE Escape always mutates** — `mutate(p => setActiveCellLayerId(p, null), {undoable:false})`
   (DPE:~676) stamps `modifiedAt` + saves + schedules live-sync on every Esc,
   selection or not. Guard on an active selection.
5. **EditorTitlePill scrim close works by accident** — PackIdentityPopover's
   own document-`mousedown` outside-close fires first and unmounts the scrim
   before its `click` can fire; if any future popoverContent lacks an
   outside-close, scrim `onClick` + outside-close could double-toggle (reopen).
   Use `onMouseDown` on the scrim (EditorTitlePill.tsx:128-140) for determinism.
6. **App.tsx impossible-state fallback dropped** — plan said keep the
   ConnectScreen fallback; now `phase==='editor' && !installRoot` renders a
   blank window. Unreachable today; cheap to keep.
7. **decal-history `undo()/redo()` return synthetic snapshots** — `decals: []`,
   only `label`/`vehicleId` real (decal-history.ts bottom). Fine for the toast
   at Editor.tsx:1837; a footgun for future callers — document or return the
   engine's restored snap.
8. **FPE image-layer align-bounds bug NOT fixed** — `layerBoundsW/H` still
   `return 0` for image layers (FaceplateEditor.tsx:3746-3763); plan item 6e
   (skippable) — skipped, but unticketed. Align Left on an image layer still
   half-offscreens it.
9. **Stale comments** — EditTextureButton.tsx:21,29 still reference the deleted
   ExplodeButton; AtlasPreview3D's `?? DEFAULT_BADGE_RECT` is dead
   (resolveDecalUvRect never returns null, vehicle-uv-registry.ts:123-135).
10. **StrictMode dev double-push** — engine `mutate` pushes the undo snapshot
    inside the `setState` updater (editor-history.ts:117-128); React StrictMode
    double-invokes updaters in dev → two frames per mutate (dev-only;
    pattern inherited from old FPE code).
11. **CanvasHandles resize-math change untested** — text-layer uniform resize
    now back-computes `startBaseW = bbox/viewScale/scale` (was `bbox/viewScale`);
    `canvas-handles-transform.test.ts` is shape-only (no math assertions).
    Verify text-layer handle resize feel live.
12. **`history.canUndo()` reads a ref at render** — disabled-state of DPE
    undo/redo buttons updates only on the next re-render (same as the old code;
    cosmetic).

## What's verified good

- Shared engine semantics (trim-at-limit, redo-clear, re-entrancy gate,
  capture-current-into-redo on undo) match the three ported implementations.
- FPE/DPE drag + paint strokes and CanvasHandles transforms are gesture-granular
  ({undoable:false} per tick + begin/end) — the P0 undo floods are gone.
- Skin paint undo now restores pixels (capture on Paint/Clear labels,
  `onDiffuseRestored` redraw + bumpOverlay + repaint), redo included.
- Metadata index: upsert on persist, sync on clearWorkshopId, removal on
  delete, lazy backfill in all three `listAll*`; SavedProjectsList renders
  synchronously with zero blob parses per row; `getRealWorkshopId` uses meta.
- App.tsx single return tree — one stable `<Editor>` across
  editor-loading→editor (no remount storm); FLIP preserved via retained
  'editor-loading' phase; faceplate/decal opens via `withViewTransition`.
- F2a env init + season→env swap; F2b vanilla-diffuse fallback with no
  bumpOverlay when all sources null; F12 boost applied exactly twice
  (exposure, hemi) with `vehicle?.faction` in deps; F7 row order; F10 CSS
  already has horizontal (`height: 12px`) scrollbar support.
- Workshop plumbing end-to-end: renderer optional root → preload → main
  `listWorkshopItems(root || detectWorkshopPath() || '')` (sync fn, imported);
  dist-electron mirror consistent; template opener Workshop group prefetched
  with graceful `[]` on error; pill preview falls back via
  `findDecalPackIdByWorkshopId` (with blob-scan fallback for pre-index storage).
- Export pill: left:56 clears the 36 px home button at left:12; gated on
  `onClosePack`; `isVehicleEdited` (decals OR customDiffuseUrl) drives count +
  gate, with tests.

## Verdict

**Ship after fixing B1 and B2** (small, surgical fixes), and treat M1–M6 as
required follow-ups before declaring the campaign PASS — M3/M4 directly
undermine the campaign's headline feature (trustworthy undo), M2 ships an
advertised-but-dead interaction, M1 is an unbounded memory growth path in long
paint sessions.

## Residual live-pass checks (CDP, after fixes)

1. Faceplate: in-game harness verdict for a fresh `buildFaceplateMod` SGA
   (`node scripts/harness/game-harness.mjs verify …`) — ARC [Sig:0] AND no
   "invalid file structure". Mandatory per Phase 1 even without code change.
2. DPE: mouse-wheel zoom works (B1); drag decal → ONE Ctrl+Z; undo → click a
   decal → redo still available (M4).
3. Skin editor: paint stroke → Ctrl+Z visibly reverts pixels; watch
   localStorage write frequency during a 2 s brush drag (B2); memory after
   ~20 paint strokes (M1).
4. Fresh blank project: stock-textured tank on first frame, no winter flash
   (compare /tmp/coh2-evidence/feedback/F2-t0..t3.png), no "Loading…" label,
   `[viewport] heavy effect run() start` fires once.
5. Saved-projects list: instant render, correct names/Workshop badges; with
   >12 decal packs check the count column (m2).
6. FPE: drag a layer 2 s → ONE Ctrl+Z; resize/rotate via handles → one frame;
   alt-tab mid-drag then verify undo still works (M3); rename a text layer (M5).
7. Title-pill menu: scrim appears, click closes (does not reopen).
8. F7 row order [template][decal][season][edit-texture]; F9 hover affordance;
   F10 horizontal scrollbar on US rail; F12 UK/US visibly brighter vs German
   baseline (compare F12-*.png).
9. Export pill visible/clickable in skin editor; paint-only project enables
   Export; template menu shows Workshop item 3728271474 without a visible
   loading hint.
10. Text-layer handle resize feel in FPE (m11 math change).
