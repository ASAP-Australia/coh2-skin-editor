# IMPLEMENTATION PLAN — Respec fix campaign (2026-06-10)

Self-contained brief for implementation agents. Do NOT read the audit docs; everything needed is here. All paths relative to repo root `/home/jflessenkemper/dev/coh2-skin-editor` unless absolute. Line numbers verified against the working tree on 2026-06-10.

## 0. Constraint header (verbatim hard constraints — binding)

- Do NOT touch src/lib/sga-writer.ts or SGA byte-format logic in mod-export.ts (in-game verified; N1 is UI wiring only). SOLE EXCEPTION: if N5 diagnosis PROVES the faceplate failure originates in sga-writer.ts, the minimal fix is allowed — but then ALL THREE pack types must be re-verified in-game (a writer change invalidates the decal/skin PASS evidence).
- Persistence changes lazily backward compatible; no eager rewrite-all migrations.
- Every P0 fix gets a test; npx tsc -b clean; vitest green (ExplodeButton test removed with F4).
- Match existing design language (top toolbar + sub-menus, editor-primitives/); no new deps.
- Run `npx tsc -b` and targeted `npx vitest run <files>` after each phase; full suite (`npx vitest run`) at the end.

No-change item: F11 roster (US 17 vehicles) is verified correct — report only, no code change.

---

## Phase 1 — N5: faceplate SGA rejected in-game (P0, HIGHEST)

**Files owned:** `scripts/diagnose-faceplate-sga.mts` (new, may be kept or deleted after), `src/lib/faceplate-mod-build.ts` (only if diagnosis demands), `src/lib/__tests__/faceplate-mod-build.test.ts` (extend if builder changes). Disjoint from every other phase → can run first / in parallel.

### Root-cause hypothesis (from verified reading — confirm via diagnosis, do not assume)

The failed pack `/tmp/coh2-evidence/a-sweep/respec-faceplate.sga` is 3,461,612 bytes — nearly identical to the PASSING skin pack (3,437,634 B) and ~20× larger than a real faceplate pack (`buildFaceplateMod` output is ~150–200 KB: one 692×204 BC3 atlas + small files). The live sweep that produced it built BOTH packs by calling the skin builder `buildSkinPack` directly via CDP (its content is recorded as "Elefant 1 shield decal" — vehicle warpaint content). A skin-layout archive (`art/armies/<faction>/vehicles/.../skins/...` + skin RGDs) deployed into `mods/faceplates/subscriptions/` is exactly the failure mode documented in `src/lib/decal-mod-build.ts:267-280`: files in a drive/location not permitted for the pack type → engine logs `MOD -- Error loading mod pack ... invalid file structure` after a successful ARC line. **Most likely verdict: evidence artifact — the real faceplate builder (`buildFaceplateMod`, src/lib/faceplate-mod-build.ts:83-186) was never tested in-game.** Secondary suspect if a true faceplate pack also fails: the builder packs 5 files (faceplate-mod-build.ts:140-168) while its own header comment (line 6) says "same 6-file layout as a published workshop faceplate" — a root-level preview `.dds` (the 6th file, analogous to `<slug>.dds` in decal packs, routed to the "info" drive by `driveOf` in sga-writer.ts:89-94) may be missing.

### Steps

1. **Write `scripts/diagnose-faceplate-sga.mts`** (run with `npx tsx`, matching `scripts/a11y-axe.mts`; if tsx is unavailable, implement as a temporary vitest file under `src/lib/__tests__/` and delete after). It must:
   - Open an SGA from a path argument with `SgaArchive.open(file)` (src/lib/sga.ts:89; build a `File`/Blob from `fs.readFileSync` bytes) and print `archive.listPaths()` (sga.ts:297) plus per-file sizes from `archive.list()` (sga.ts:302-318).
   - Dump trees for: (a) `/tmp/coh2-evidence/a-sweep/respec-faceplate.sga`; (b) a known-good Workshop faceplate from `/home/jflessenkemper/.steam/steam/steamapps/compatdata/231430/pfx/drive_c/users/steamuser/Documents/My Games/Company of Heroes 2/mods/faceplates/subscriptions/` (10 exist, e.g. `1394135665.sga`); (c) a freshly built pack from `buildFaceplateMod` using a synthetic 692×204 atlas — copy the atlas synthesis from `src/lib/__tests__/end-to-end-claude-produced-mods.test.ts:316-330`.
2. **Diff the trees.** Expected: (a) contains skin-pack paths (`art/armies/*/vehicles/*/skins/*`) → evidence artifact confirmed. Compare (b) vs (c) for file-set differences (count, root-level `.dds`, folder casing, drive placement per `driveOf` rules: `attrib/`→0, `english/|locale/`→1, root files→2 "info", everything else→3 "data").
3. **Fix only what the diff proves.** If (c) diverges from (b) in file SET or paths, fix the `files:` array in `buildFaceplateMod` (faceplate-mod-build.ts:140-168) — e.g. add a root `${slug}.dds` preview built from the atlas via the existing `wrapBc3InDds`/`encodeBc3` helpers, mirroring decal-mod-build.ts:282. Do NOT touch sga-writer.ts unless byte-level TOC diffs prove it (then the hard-constraint exception applies: re-verify all three pack types in-game).
4. **In-game re-verify (MANDATORY even if no code change):** have the script write the fresh `buildFaceplateMod` SGA to `/tmp/respec-true-faceplate.sga`, then run `node scripts/harness/game-harness.mjs verify /tmp/respec-true-faceplate.sga --id <the-32-hex-guid>` (harness subcommands: `install`, `verdict`, `verify`; see usage block at scripts/harness/game-harness.mjs:30-45; wait ≥30 s before verdict per its tip). PASS = ARC `[Sig:0]` line present AND no `MOD -- Error ... invalid file structure` line for this pack. If sga-writer changed, also rebuild + verify decal and skin packs.
5. **Tests:** if the builder changed, extend `src/lib/__tests__/faceplate-mod-build.test.ts` to pin the new file list (path set assertion mirroring end-to-end test lines 370-380).

**Done when:** diagnosis verdict written into the PR/commit message (artifact vs builder bug, with tree diffs); a true `buildFaceplateMod` pack PASSES the game-harness verdict; `npx tsc -b` clean; `npx vitest run src/lib/__tests__/faceplate-mod-build.test.ts src/lib/__tests__/end-to-end-claude-produced-mods.test.ts` green.

---

## Phase 2 — Shared history/undo engine + migration of all three editors (P0 + P1.5 architecture ruling)

**Files owned:** NEW `src/lib/editor-history.ts`; NEW `src/lib/__tests__/editor-history.test.ts`; `src/lib/decal-history.ts`; `src/components/DecalPackEditor.tsx`; `src/components/FaceplateEditor.tsx`; `src/components/editor-shared/CanvasHandles.tsx`; `src/components/Editor.tsx` (ONLY the history-wiring region, lines ~128-160 and the paint-restore callback; no other Editor.tsx regions); `src/lib/__tests__/editor-undo-redo-stack.test.ts`, `src/lib/__tests__/decal-parity-features.test.ts` (extend). `src/components/VehicleTextureEditor.tsx` must NOT need changes (its props contract at VehicleTextureEditor.tsx:78-95 — `onStrokeBegin/onUndo/canUndo/onRedo/canRedo` — is preserved).

**Architecture ruling (user, 2026-06-10):** ONE shared engine; the P0 undo fixes are implemented AS this engine + per-editor migration, not as local patches. Gesture-granular commits: one undo frame per drag/stroke/transform gesture, not per pointermove tick.

### 2.1 The engine — `src/lib/editor-history.ts`

```ts
export interface HistoryAdapter<S, Snap> {
  capture: (current: S, label: string) => Snap
  restore: (current: S, snap: Snap) => S
}
export interface HistoryEngine<S, Snap = S> {
  /** FPE/DPE style: push prev state (or prev snapshot) BEFORE applying fn. */
  mutate(fn: (prev: S) => S, opts?: { undoable?: boolean }): void
  /** Skin-editor style: explicitly snapshot current state before caller mutates. */
  commit(label: string): void
  /** One undo frame per gesture: beginGesture pushes ONE frame (pre-gesture
   *  state); all mutate()/commit() calls until endGesture are suppressed.
   *  Re-entrant (counter), unbalanced-safe. */
  beginGesture(label?: string): void
  endGesture(): void
  undo(): { label: string } | null
  redo(): { label: string } | null
  canUndo(): boolean
  canRedo(): boolean
}
export function useHistoryEngine<S, Snap = S>(
  getState: () => S,
  setState: React.Dispatch<React.SetStateAction<S>>,
  options?: {
    adapter?: HistoryAdapter<S, Snap>   // default: identity (Snap = S)
    limit?: number                       // default 50
    onPersist?: (next: S) => void        // fired after every applied mutation/undo/redo
    onAfterRestore?: (snap: Snap) => void // post-restore side effects (repaint etc.)
  },
): HistoryEngine<S, Snap>
```

Semantics (port from the three verified implementations): dual ref stacks, trim-from-front at limit (DecalPackEditor.tsx:261-263 pattern); new undoable action clears redo; `applyingRef` re-entrancy gate with microtask reset (decal-history.ts:52-87); undo captures current → redo stack before restoring (decal-history.ts:105-131). `mutate` calls `setState(prev => …)`, pushing `adapter.capture(prev,…)` when undoable && !inGesture, then runs `onPersist(next)` (inside the updater, matching FaceplateEditor.tsx:297-323).

### 2.2 DecalPackEditor migration

Current machinery: stacks at DecalPackEditor.tsx:140-141, `mutate` at 254-276 (stamps `modifiedAt`, calls `saveDecalPackToLocal` + `scheduleLiveSync('decal', next)`), undo/redo below it, keyboard at 605-631.
- Replace stacks/mutate/undo/redo with: `const history = useHistoryEngine(getProject, setProject, { onPersist: next => { saveDecalPackToLocal(next); scheduleLiveSync('decal', next) } })` plus a local wrapper keeping the EXACT current `mutate` signature so all call sites stay untouched: `const mutate = useCallback((fn, opts) => history.mutate(p => ({ ...fn(p), modifiedAt: new Date().toISOString() }), opts), [history])`. `undo`/`redo` become thin wrappers over `history.undo/redo`.
- **Drag undo fix (P0):** `beginCanvasDrag` (DecalPackEditor.tsx:864-955) currently mutates with `{undoable:false}` per move and never commits → drags + multi-move (G9) invisible to undo. Insert `history.beginGesture('Move decal')` right after the `setPointerCapture` try/catch (~line 878) and `history.endGesture()` inside `onUp` (~line 947). Leave the per-move `{undoable:false}` mutates as-is.
- **Draw-stroke gesture:** locate the draw-tool pointerdown that sets `isDrawingRef.current = true` (ref declared at line 159) and wrap the stroke with `beginGesture('Paint')`/`endGesture()` at stroke start/end.

### 2.3 FaceplateEditor migration

Current machinery: `mutate` at FaceplateEditor.tsx:297-323 (calls `persistFaceplate` + `scheduleLiveSync('faceplate', next)`), undo/redo at 325-349, keyboard at 446-462.
- Same replacement pattern as 2.2 with `onPersist: next => { persistFaceplate(next); scheduleLiveSync('faceplate', next) }`.
- **Per-pointermove undo flood (P0), drag:** `beginDrag` (FaceplateEditor.tsx:3854-3921) is a standalone function receiving `mutate`; it calls bare `mutate(...)` per pointermove (undoable defaults true → ~60 frames/s). Extend its signature with `gesture: { begin: (label?: string) => void; end: () => void }`; call `gesture.begin('Move layer')` after the group-layer early-return + pointer capture, `gesture.end()` in `onUp`; pass `{undoable:false}` on the per-move mutate. Update the single call site to pass `{ begin: history.beginGesture, end: history.endGesture }`.
- **Per-tick undo flood, resize/rotate:** the `CanvasHandles` mount (FaceplateEditor.tsx:1764-1784) calls `mutate(...)` in `onResize`/`onRotate` per tick. Add optional `onGestureStart?: () => void; onGestureEnd?: () => void` props to `src/components/editor-shared/CanvasHandles.tsx`, fired at its internal handle pointerdown/pointerup; FPE passes `history.beginGesture('Transform layer')` / `history.endGesture()` and switches the onResize/onRotate mutates to `{undoable:false}`.
- **Paint strokes:** wrap the faceplate brush stroke begin/end (paint-tool pointer handlers near the brush section, FPE:3162-3237 options panel; find the stroke pointerdown) with `beginGesture('Paint')`/`endGesture()`.

### 2.4 Skin editor: paint undo restores pixels (P0)

`src/lib/decal-history.ts` snapshots only `decals`+`mainDecalId` (lines 61-81), yet Editor commits paint labels: `history.commit('Clear paint')` (Editor.tsx:971), `'Place decal'` (1019), `'Edit decal'` (1040), `'Paint stroke'` (1240), `'Paint'` (1831 via VTE `onStrokeBegin`). Undo toasts fire (Editor.tsx:1837-1839) but pixels never revert.
- Rewrite `useDecalHistory` as an adapter over `useHistoryEngine` (keep its exported signature, return shape `{commit,undo,redo,canUndo,canRedo}` and `EditSnapshot.label` so Editor.tsx:1837 and VehicleTextureEditor props keep working). Extend:
```ts
export interface EditSnapshot {
  vehicleId: string; decals: Decal[]; mainDecalId: number | null; label: string
  /** Captured ONLY for labels starting 'Paint' or 'Clear' — pre-mutation pixels. */
  diffusePng?: string            // canvas.toDataURL('image/png') of baseDiffuse
  customDiffuseUrl?: string | null  // vehicle's persisted url at capture time
}
```
- New hook params (added to the `useDecalHistory(getProject, setProject, getVehicleId, …)` call at Editor.tsx:136-160): `getDiffuseCanvas: () => HTMLCanvasElement | null` (returns `baseDiffuseRef.current`, declared Editor.tsx:481) and `onDiffuseRestored: (dataUrl: string) => void` (Editor side: draw onto `baseDiffuseRef.current`, copy to the overlay canvas, `bumpOverlay()`, `repaint()` — mirror the restore drawing at Editor.tsx:1474-1490).
- `capture`: when label starts with 'Paint' or 'Clear', read `getDiffuseCanvas()?.toDataURL('image/png')` and the vehicle's `customDiffuseUrl`. **Memory cap:** keep at most 8 pixel-bearing frames (`PAINT_SNAPSHOT_LIMIT = 8`); when exceeded, null out `diffusePng` on the oldest pixel-bearing frame (its decal part still restores — documented degradation).
- `restore`: apply decals/mainDecalId as today (decal-history.ts:72-89); additionally set `veh.customDiffuseUrl = snap.customDiffuseUrl` when the field was captured, and if `snap.diffusePng` call `onDiffuseRestored(snap.diffusePng)` after the setState.

### 2.5 Tests (Phase 2)

- NEW `src/lib/__tests__/editor-history.test.ts`: (1) beginGesture + 5 mutates + endGesture → exactly ONE undo step returning pre-gesture state; (2) undoable mutate pushes + clears redo; redo round-trip; (3) limit trims oldest (51st push); (4) custom adapter capture/restore round-trip; (5) `onPersist` fired on mutate, undo, redo; (6) re-entrancy: commit during restore is a no-op.
- NEW paint-restore test (in `editor-history.test.ts` or `decal-history.test.ts`): stub canvas with `toDataURL`, commit('Paint') captures `diffusePng` + `customDiffuseUrl`; undo calls `onDiffuseRestored` with it and restores the field; commit('Place decal') captures NO pixels; 9th paint commit drops the oldest `diffusePng`.
- BASELINE FIRST: run `npx vitest run src/lib/__tests__/editor-undo-redo-stack.test.ts src/lib/__tests__/decal-parity-features.test.ts` BEFORE refactoring and keep them green after; extend `decal-parity-features.test.ts` G9 section: a simulated drag gesture (begin → n mutates → end) is undone in one step.

**Done when:** all above tests green; tsc clean; manual CDP check: in skin editor paint a stroke → Ctrl+Z visibly reverts pixels; in faceplate drag a layer for 2 s → ONE Ctrl+Z returns it to start; in decal editor drag a decal → Ctrl+Z reverts the move.

---

## Phase 3 — Loading/persistence + F2 (P0)

**Files owned:** `src/App.tsx`; `src/lib/project.ts`; `src/lib/faceplate-project.ts`; `src/lib/decal-pack-project.ts`; `src/components/SavedProjectsList.tsx`; `src/components/Editor.tsx` (ONLY: line 240 envName init, lines 296-343 season-hold, lines 835-902 paintCanvas fallback, lines 914-926 persist effect); `src/components/Viewport.tsx` (ONLY if the one-line overlay-bind gate below proves necessary); NEW `src/lib/__tests__/project-index.test.ts`. Runs AFTER Phase 2 merges (Editor.tsx serialization).

### 3.1 App.tsx — kill FLIP holds + double mount (F2c/F1/F3)

- Delete `EDITOR_LOADING_MS` (App.tsx:95) and `EDITOR_LOADING_MIN_MS` (App.tsx:101) and `editorLoadStartRef` (155, 323, 523).
- `openFaceplate` (329-333) / `openDecalPack` (335-339): replace `setPhase('editor-loading'); window.setTimeout(() => setPhase('faceplate'), EDITOR_LOADING_MS)` with `withViewTransition(() => setPhase('faceplate'))` (resp. `'decal-pack'`) — no editor-loading detour, no timeout.
- `onEditorReady` (437-440): old `window.setTimeout(() => setPhase('editor'), Math.max(0, EDITOR_LOADING_MIN_MS - elapsed))` → new `setPhase('editor')` (immediate).
- **Single persistent Editor element:** the skin Editor is currently mounted in TWO different JSX branches (hidden at App.tsx:584-592 during 'editor-loading', visible at 607-618 during 'editor') → React unmounts/remounts at the phase flip = double parse/stringify/Viewport re-init. Restructure the component to ONE return tree so `<Editor>` keeps a stable position:
```tsx
return (
  <>
    <WindowControls />
    {loadError && (/* existing alert block, lines 563-578, unchanged */)}
    {inAuthShell && <AuthShell phase={phase}>{panel}</AuthShell>}
    {(phase === 'editor-loading' || phase === 'editor') && installRoot && (
      <Editor
        root={installRoot}
        onDisconnect={() => withViewTransition(() => setPhase('start'))}
        onClosePack={() => withViewTransition(() => setPhase('start'))}
        visible={phase === 'editor'}
        onReady={onEditorReady}
      />
    )}
    {phase === 'faceplate' && faceplateProject && (/* existing FaceplateEditor block, 624-632 */)}
    {phase === 'decal-pack' && decalPackProject && (/* existing DecalPackEditor block, 641-650 */)}
    <input /* existing hidden disk input, 593-600 */ />
    {bgWarmerNode}
  </>
)
```
Keep the fallback ConnectScreen branch for the impossible state. Editor's `visible`/`onReady` props are already optional (Editor.tsx:106-120). The 'probing' "Loading…" panel (App.tsx:547-552) stays — it never renders in Electron.

### 3.2 Editor.tsx — F2a winter flash, F2b stock render, season hold

- **F2a:** line 240 old `const [envName, setEnvName] = useState('mission_06')` → `useState(() => filterEnvsBySeason([...SKYBOX_ENVS], 'summer')[0] ?? 'mission_06')`, importing `SKYBOX_ENVS, filterEnvsBySeason, seasonOfEnv` from `@/lib/skybox` (defined skybox.ts:21, 96, 108). The `season` state (Editor.tsx:142) always initialises 'summer', so the default env must be summer-classified. Additionally in `handleSetSeason` (305-321): when the new season disagrees with `seasonOfEnv(envName)` (and the result isn't 'either'), `setEnvName(filterEnvsBySeason([...SKYBOX_ENVS], s)[0])`.
- **Season hold:** delete `SEASON_MIN_LOADING_MS` (line 298) and the elapsed/remaining math in `handleSeasonReady` (333-343) → `setSeasonLoading(false)` immediately. Keep the 8 s safety timeout (line 353). SeasonToggle's beam (`loading` prop) now reflects real readiness only.
- **F2b blank-project stock render:** in `paintCanvas` (835-902), `baseSource` (line 848) is `decalPreviewCanvasRef.current ?? baseDiffuseRef.current`; when both are null the overlay is published transparent → invisible vehicle. Change to: fall back to `vanillaDiffuseRef.current` (declared 489, seeded on model load at 1456-1463); if ALL three are null, `return` WITHOUT `bumpOverlay()` so the Viewport keeps the model's own SGA texture instead of binding an empty overlay. If a CDP check on a fresh project still shows a transparent vehicle, the permitted fallback is a one-line gate in Viewport.tsx (3852-3917 region): only attach the overlay `CanvasTexture` as the material map once `overlayVersion > 0`. Acceptance: fresh project (no customDiffuseUrl/camoPreset) shows the stock-textured tank on first frame.
- **Persist throttle:** the effect at 914-926 runs `persistActive(project)` on EVERY project change (brush dab, drag tick → multi-MB sync stringify). Replace with a 400 ms trailing debounce: keep latest project in a ref, `setTimeout` re-armed per change, flush pending write on unmount (effect cleanup) — and leave the explicit `persistActive(projectRef.current)` call at Editor.tsx:1120 (close-pack path) as the synchronous flush. Same pattern is NOT needed in FPE/DPE here — their per-mutation persist lives in the Phase-2 engine's `onPersist`; if profiling shows dab-flood there, debounce inside `onPersist` wrappers (optional, same 400 ms/flush-on-unmount rule).

### 3.3 Metadata index — kill blob parses (D §P0)

Storage today: per-id blobs `coh2.project.<id>` etc.; a 12-entry capped "recent" registry per type (`trackRecentProject` in project.ts, `coh2.recentFaceplates` faceplate-project.ts:544, `coh2.recentDecalPacks` decal-pack-project.ts:330). Two blocking paths: `listAll*` parses every blob (project.ts:647-680; faceplate-project.ts:930-960; decal-pack-project.ts:641-660), and `SavedProjectsList.getRealWorkshopId` (SavedProjectsList.tsx:141-159) full-parses a 5–20 MB blob per row per render via `loadById`/`loadFaceplateById`/`loadDecalPackById`.

Add to EACH of the three project libs (project.ts / faceplate-project.ts / decal-pack-project.ts):
- An index key (`'coh2.skinProjectIndex.v1'`, `'coh2.faceplateIndex.v1'`, `'coh2.decalPackIndex.v1'`) holding `Record<id, { name: string; lastEditedAt: number; workshopId: string | null; vehicleCount?: number }>` (vehicleCount skin-only).
- `readIndex()` / `upsertIndexEntry(id, entry)` / `removeIndexEntry(id)` helpers (tiny JSON, ~1 KB).
- Upsert from the persist function (`persistActive` project.ts:528-537; `persistFaceplate`; `saveDecalPackToLocal` decal-pack-project.ts:462-466) — derive entry fields from the project being saved. Also update from every `clear*WorkshopId` helper (project.ts:681+ and equivalents) and every delete-project helper (grep `localStorage.removeItem` calls that remove per-id blobs in each lib).
- **Lazy backfill (backward compatible, no eager rewrite):** `listAll*` iterates per-id blob keys as today, but uses the index entry when present; ONLY on index miss does it parse that one blob and write the entry back. First post-upgrade list pays the old cost once; every later call is parse-free. Keep merging thumbnails/faction from the existing recent registry exactly as the current code does (project.ts:650-674). Validity-gating of corrupt blobs moves to click time (pick handlers already `loadById` and error-toast — App.tsx:343-366).
- Export `getProjectMeta(id)` / `getFaceplateMeta(id)` / `getDecalPackMeta(id)` returning the (lazily backfilled) index entry, and from decal-pack-project.ts additionally `findDecalPackIdByWorkshopId(workshopId: string): string | null` (scan index values; needed by Phase 4).

### 3.4 SavedProjectsList.tsx

- Lines 105-115: replace the `loading` state + mount effect with synchronous lazy initialisers: `useState<RecentProjectEntry[]>(() => listAllSkinProjects())` (same for faceplates/decals); delete `loading` and the "Loading projects…" render branch (around lines 250-253) — the list renders on first paint.
- `getRealWorkshopId` (141-159): replace the three `load*ById(id)?.workshopId` calls with `get*Meta(id)?.workshopId` — zero blob parses. Keep the `refreshNonce` + ≤5e9 real-id check unchanged (the Workshop-delete flow must also call the lib's `clear*WorkshopId`, which now updates the index, so the nonce re-read still works).

### 3.5 Tests + verification (Phase 3)

- NEW `src/lib/__tests__/project-index.test.ts` (localStorage stub): (1) persistActive writes an index entry with name/lastEditedAt/workshopId; (2) GOLDEN COMPARE — seed legacy blobs WITHOUT an index, assert `listAllSkinProjects()` output deep-equals the pre-change implementation's output (copy the old loop into the test as reference) AND that the index is backfilled; (3) `getProjectMeta` on missing index parses once then serves from index; (4) clearWorkshopId nulls the index entry; (5) same minimal cases for faceplate + decal libs; (6) `findDecalPackIdByWorkshopId` round-trip.
- envName test: assert `filterEnvsBySeason([...SKYBOX_ENVS],'summer')[0]` exists and `seasonOfEnv` of it ≠ 'winter'.
- `npx tsc -b && npx vitest run src/lib/__tests__/project-index.test.ts src/lib/__tests__/editor-undo-redo-stack.test.ts`
- **Done when (CDP, app rebuilt):** open a saved skin — screenshot sequence shows NO winter frame (compare /tmp/coh2-evidence/feedback/F2-t0..t3.png baselines), no "Loading…" label, vehicle visible with stock texture on a fresh blank project; `[viewport] heavy effect run() start` fires ONCE per open (console); Load Project list renders instantly with correct names + Workshop badges; season toggle clears its beam as soon as textures bind.

---

## Phase 4 — Workshop plumbing + export reachability (P0 N1/N2/F5 + C-audit)

**Files owned:** `src/components/TopBar.tsx`; `src/components/TemplateDecalPills.tsx`; `electron/main.ts` (one handler line); `electron/preload.ts` (type only); `src/components/atlas/AtlasPreview3D.tsx`; `src/components/AuditRunner.tsx`; `src/components/Editor.tsx` (ONLY the decal-preview effect region, lines ~533-647). Runs AFTER Phase 3 (needs `findDecalPackIdByWorkshopId`; Editor.tsx serialization).

1. **N1 — Export entry point.** `ExportPanel` (TopBar.tsx:980, mounts `ExportSkinPackButton` at 1017) renders only when `activePanel === 'export'` (TopBar.tsx:345); the only setter is inside ViewPanel (TopBar.tsx:547) which itself has no opener — dead end. Fix: in the main `TopBar` component render (TopBar(p) at 169), directly after the `EditorHomeButton` block (TopBar.tsx:306-316), add a fixed top-LEFT-cluster "Export" pill button at `left: 56` (right of home, same `top: 'calc(12px + var(--app-top-inset, 0px))'`, `zIndex: 30`), gated on `p.onClosePack` like the home button, styled by mirroring `EditorHomeButton` (editor-primitives/EditorHomeButton.tsx) with a lucide `Upload` icon + "Export" label, `onClick={() => p.setActivePanel(p.activePanel === 'export' ? null : 'export')}` and `aria-expanded`. The existing panel container (TopBar.tsx:318-346, `glass-pop` popover below the buttons) then shows ExportPanel — design language preserved. Do NOT modify buildSkinPack/exportSkinPack or any SGA bytes.
2. **N2 — export gate.** TopBar.tsx:1932-1934 old: `v => (v.decals?.length ?? 0) > 0` → new: `v => (v.decals?.length ?? 0) > 0 || !!v.customDiffuseUrl` (painted-only vehicles unlock Export; the disabled gate at 2009 and counts at 2016-2017/2054 pick this up automatically).
3. **F5/N4 — Workshop items.** The lister itself (electron/detect-coh2.ts:702-735) and `detectWorkshopPath` (582+) are sound and the decal opener already uses them (TemplateDecalPills.tsx:121-183). Two gaps: (a) the IPC requires a root argument — calling `electronAPI.listWorkshopItems()` bare returns 0 (the live diagnostic's symptom). Fix electron/main.ts:523 old `ipcMain.handle('list-workshop-items', (_e, root: string) => listWorkshopItems(root))` → `(_e, root?: string) => listWorkshopItems(root || detectWorkshopPath() || '')` (`detectWorkshopPath` is exported from the same module; extend the main.ts:9 import list if absent) and mark `root` optional in preload.ts:202 + src/lib/native-fs.ts:163/357. (b) the TEMPLATE opener has no Workshop section — `templateOptions` (TemplateDecalPills.tsx:~100-114) lists only blank + saved + stock. Add a Workshop group using the decal menu's own async pattern (TemplateDecalPills.tsx:121-183): on template-menu open, `detectWorkshopPath()` + `listWorkshopItems(root)`, resolve display names from the SGA header exactly as lines 138-165 do; filter to skin-type packs by reusing the classification in `src/lib/workshop-skins.ts` (it already wraps `listWorkshopItems` at workshop-skins.ts:136 — grep its exports and reuse rather than re-implement). Selecting a Workshop template seeds the project through the SAME code path the existing stock options use (follow the `kind: 'stock'` handler in this file).
4. **Pill preview Workshop fallback (C-audit fix 1).** Editor.tsx:563 `const pack = loadDecalPackById(decalPackRef.id)` returns null for Workshop-sourced ids → preview silently blank. After it: `if (!pack) { const localId = findDecalPackIdByWorkshopId(decalPackRef.id); if (localId) pack = loadDecalPackById(localId) }` (change `const` to `let`; helper from Phase 3.3). Still-null keeps today's no-preview behavior (foreign packs never authored locally are out of scope).
5. **AtlasPreview3D fixes.** `src/components/atlas/AtlasPreview3D.tsx:43` hardcodes the old wrong rect `{x:896,y:1152,w:512,h:512}`; the authored King Tiger rect is `{410,1320,360,340}` in the registry. Replace the constant by importing from `@/lib/vehicle-uv-registry` (grep its exports; use the authored KT entry, falling back to `DEFAULT_BADGE_RECT {870,1150,320,312}` if the lookup API needs meshes). At the upscale site (lines 115-124) set `mCtx.imageSmoothingEnabled = true; mCtx.imageSmoothingQuality = 'high'` before `drawImage`, matching the verified Editor bake path (`rasteriseDecal(..., {supersample:4})` → downscale with 'high'); reuse `rasteriseDecal` for the part composite if it drops in cleanly, else high-quality smoothing alone satisfies the checklist. Update the same stale rect constant in `src/components/AuditRunner.tsx:62` (debug-only).
6. **Stale comment:** delete the "PackIdentityPopover → TemplateSelectSection" reference at TemplateDecalPills.tsx:8 (component never existed).
7. **F6 scrollbar (moved here for file ownership):** the template/decal opener menu list (`overflowY: 'auto'` style object at TemplateDecalPills.tsx:539) gets the `custom-scrollbar` class (defined index.css:308+; used by SavedProjectsList.tsx:299) — add `className="custom-scrollbar"` to that scroll container (keep the inline maxHeight).

**Tests:** NEW `src/lib/__tests__/edited-count.test.ts` — extract the predicate into an exported helper `isVehicleEdited(v)` in src/lib/project.ts and pin: decals-only ✓, paint-only ✓ (customDiffuseUrl), untouched ✗ (TopBar imports the helper). Extend `src/lib/__tests__/vehicle-uv-registry.test.ts` (or new file) asserting AtlasPreview3D's rect import equals the registry's KT rect. Supersample pin (P2 "if cheap"): new assert that `rasteriseDecal(d, img, {supersample:4})` yields a 512² canvas.
**Done when:** tsc + targeted vitest green; CDP: "Export" pill visible top-left in skin editor → opens Export panel; paint-only project enables Export; template opener shows a Workshop section listing item 3728271474; decal pill preview renders for a Workshop-applied pack that exists locally.

---

## Phase 5 — User-requested UI changes (P1)

**Files owned:** `src/components/Editor.tsx` (ONLY bottom-bar JSX region ~1700-1780 + explode removal lines 18, 217-232, the `explodeAll` state and its Viewport prop); DELETE `src/components/ExplodeButton.tsx` + `src/components/__tests__/ExplodeButton.test.tsx`; `src/components/SeasonToggle.tsx`; `src/components/VehicleMenu.tsx`; `src/components/editor-primitives/EditorTitlePill.tsx`; `src/components/Viewport.tsx`; `src/index.css` (scrollbar tweak if needed). Runs AFTER Phase 4.

1. **F7 toolbar layout.** Current bottom-center stack in Editor.tsx: a cluster div containing (conditional "Back to exploded view" button ~1738-1750) + `<SeasonToggle …>` (1751) + `<EditTextureButton …>` (1756-1761), THEN `<TemplateDecalPills …>` (1766-1773), THEN `<VehicleMenu …>` (1774+). Required: template + decal pills LEFT; season toggle + Edit Texture to the RIGHT of the decal pill, on the SAME row (not above). Restructure to:
```tsx
<div className="flex items-end justify-center gap-2">
  <TemplateDecalPills /* existing props 1766-1773 unchanged */ />
  <SeasonToggle value={season} onChange={handleSetSeason} loading={seasonLoading} />
  <EditTextureButton brushOn={textureEditorOpen} disabled={!vehicle} onClick={() => setTextureEditorOpen(true)} />
</div>
<VehicleMenu /* unchanged */ />
```
Keep the conditional "Back to exploded view" button where it is relative to the row (it is selectedPart-isolate UX); relabel its text/title to "Back to full view" (explode is gone). Preserve all existing wrapper positioning classes around the bottom stack.
2. **F4 explode removal.** ExplodeButton IS still mounted (Editor.tsx:1728). Remove: the import (line 18), the mount (1728), `toggleExplode` (220-228), the E-key explode listener effect (229-235 region — the custom-event listener described in the comment), and the `explodeAll` state — pass `explodeAll={false}` to the main `<Viewport …>` (prop near line 1605) so Viewport's API is untouched (App.tsx already passes a literal `false` at App.tsx:471). Delete `src/components/ExplodeButton.tsx` and `src/components/__tests__/ExplodeButton.test.tsx` (retires the known-failing "inactive variant" test). Run a final `grep -rn ExplodeButton src/` to confirm zero references.
3. **F8 title-menu scrim.** In `editor-primitives/EditorTitlePill.tsx` (150 lines; receives `popoverOpen`, `onToggle`, `popoverContent` — see TopBar.tsx:219-236 usage): when `popoverOpen`, render `<div aria-hidden className="fixed inset-0 bg-black/45" style={{ zIndex: <one below the pill/popover layer> }} onClick={onToggle} />` as a sibling BEFORE the popover content so the backdrop sits behind the menu but above the editor. Verify the pill's existing z-index in the file and slot the scrim one below. All three editors use EditorTitlePill → one edit covers skin/faceplate/decal.
4. **F9 season icons.** In SeasonToggle.tsx `Segment` (lines ~50-85): inactive segments must read as clickable neutral icon buttons — add `cursor-pointer`, an inactive style of reduced opacity (~0.55) with `hover:opacity-100` + subtle hover background (`rgba(255,255,255,0.08)`), a 150 ms transition, and `aria-pressed={active}`; keep the existing active tints (sun amber / snow blue). Compare against /tmp/coh2-evidence/feedback/F9-season-icons.png for the before state.
5. **F10 US vehicle-selector scrollbar.** VehicleMenu.tsx:102 row `className="flex flex-nowrap items-center gap-0.5 overflow-x-auto"` → append `custom-scrollbar`. Check index.css:308+ — if `.custom-scrollbar` only styles vertical (`::-webkit-scrollbar` width), extend the CSS block with a `height` for horizontal bars (same colors/radius). Visible affordance must appear for the 17-vehicle US rail (baseline /tmp/coh2-evidence/feedback/F10-us-scrollbar.png).
6. **F12 per-faction lighting.** In Viewport.tsx's lights effect (region 2100-2180: `renderer.toneMappingExposure = effectivePreset.exposure` at 2114, `new HemisphereLight(..., effectivePreset.hemi.intensity)` at 2123-2127, directional loop 2134+): add
```ts
const FACTION_LIGHT_BOOST: Record<string, number> = { british: 1.3, aef: 1.3 }
const boost = FACTION_LIGHT_BOOST[vehicle?.faction ?? ''] ?? 1.0
```
(export the map for testing), apply `* boost` to `toneMappingExposure` and `hemi.intensity`, and add the vehicle-faction value to the effect's dependency array. Faction tokens verified: `'british'`, `'aef'` (soviet/german/west_german stay 1.0). Start at 1.3; tune 1.25–1.35 by comparing CDP screenshots against /tmp/coh2-evidence/feedback/F12-uk.png and F12-us.png (must be visibly brighter) while F12-de.png-equivalent (German) stays unchanged.

**Tests:** NEW small test for `FACTION_LIGHT_BOOST` (british/aef boosted, german/soviet/west_german = 1.0). Full `npx vitest run` must be green WITH the ExplodeButton test deleted.
**Done when:** tsc clean; full suite green; CDP screenshots: toolbar row order = [template pill][decal pill][season toggle][Edit Texture] left→right above the vehicle rail (compare F7-toolbar.png baseline); title-pill menu shows black scrim; UK/US viewport visibly brighter vs F12 baselines; US rail shows the custom scrollbar; no ExplodeButton anywhere.

---

## Phase 6 — Shared parity primitives (P1.5; each sub-item individually skippable if time-boxed)

**Files owned:** `src/components/editor-shared/*` (CanvasHandles.tsx + new files), NEW `src/lib/use-pan-zoom.ts`, `src/components/editor-primitives/keyboard-shortcuts-data.ts`, `src/components/DecalPackEditor.tsx`, `src/components/FaceplateEditor.tsx`, `src/components/VehicleTextureEditor.tsx`, `src/components/Editor.tsx` (ONLY if sub-item d2 is done). Runs LAST (depends on Phase-2 engine; DPE/FPE serialization).

a) **CanvasHandles generalization → DPE.** `editor-shared/CanvasHandles.tsx` is faceplate-typed (props take a FaceplateLayer + image). Refactor props to geometry-only: `{ x, y, rotation, scale, scaleY?, bboxW, bboxH, viewScale, onResize(t), onRotate(deg), onGestureStart?, onGestureEnd? }`; FPE mount (FaceplateEditor.tsx:1764-1784) adapts by passing layer fields. Mount in DecalPackEditor on the active decal in select mode (beside the existing snap-guide rendering in the canvas stage, near the drag surface used by beginCanvasDrag at 864): uniform scale only (no scaleY), rotate handle wired to the decal's rotation, gesture props → Phase-2 `history.beginGesture('Transform decal')`/`endGesture`. Today scale/rotate require the Transform peel sliders (DPE:2865-2891) — those stay.
b) **Shared numeric transform inputs.** NEW `editor-shared/TransformInputsRow.tsx`: compact X / Y / W / H / angle number inputs (commit on blur/Enter, step 1; reuse the existing X/Y input styling found at DPE:3010/3046 and FPE:2802-2825). Mount in the DPE Transform peel next to the X/Y inputs (W/H derived from natural size × scale, writes scale back; angle ↔ rotation with normaliseRotation DPE:3313) and in the FPE select peel (replacing/extending its X/Y-only row).
c) **Shared zoom/pan/fit.** NEW `src/lib/use-pan-zoom.ts`: `{ scale, offset, handlers }` implementing wheel-zoom-at-cursor (0.25–8×), Space-held or middle-button drag pan, `Ctrl+0` fit-to-window (computed from container/content rects — fixes DPE's hardcoded "Fit"=4× at DPE:2335), `Ctrl+1` = 100%. Wire to: DPE stage transform (current wheel zoom DPE:746-752 + pill DPE:2292-2374 — pill buttons call the hook), FPE stage (wheel at FPE:621-630; do NOT re-add the zoom pill — it was removed by design (FPE:2525-2526); shortcuts/pan only, which does not conflict with that rationale), and VTE's blit rect (VTE:250-285 — fixed-fit today; painting a 2048² atlas needs zoom). Add `[`/`]` brush-size keys to VTE's key handler (VTE:233-239, mirroring DPE:632-644).
d) **Shortcut overlay + truthful data.** (d1) Mount `editor-primitives/KeyboardShortcutsOverlay` in FPE: copy DPE's F1 toggle (DPE:616-620) + mount (DPE:1709) + `?` button (DPE:1677 pattern). (d2, optional) Feed the skin editor's existing ShortcutHelpSheet (Editor.tsx:1847) from keyboard-shortcuts-data.ts so there is ONE truth source. (d3) Make KSD:37-48 truthful by IMPLEMENTING the missing bindings in DPE (don't delete entries): `N` = new blank decal slot (or, if no blank-layer factory exists in decal-pack-project.ts, re-point N to "Import image" and update the row text); `Ctrl+D` = duplicate (handler already exists as a button near DPE:2860 — bind it in the key effect at 607-713); `[`/`]` = move decal down/up ONLY when `activeTool === 'select'` (draw mode keeps brush-size per G7; update both KSD rows to note the mode). Add Esc-deselect in DPE. Update the Vehicle-editor 'E' row (explode removed in Phase 5).
e) **Faceplate polish** (each its own commit, skippable): flip H/V buttons in the select peel — model already renders flipH/V (FPE:1508); mirror the skin editor's flip buttons (TopBar.tsx:919-946). Layer rename — copy DPE's dbl-click pattern (DPE:1977-2029) into the FPE layer strip. Drag-reorder layers — copy DPE:824-853. Grid snap — copy DPE:902-907 + the 4/8/16/32 control (DPE:2634) into beginDrag's snap targets. Opacity for ALL layer kinds — generalize the shape-only SliderPopover (FPE:3145-3155). BlendModeSelect for text/shape/paint peels — reuse the image-layer pattern (FPE:1997-2008). Image-layer align bounds bug — FPE:3440-3456 returns 0 for image layers; compute `img.width × layer.scale` from `project.images[layer.imageId]`.

**Tests:** NEW `src/lib/__tests__/use-pan-zoom.test.ts` (zoom clamps, fit math, 100% reset); extend `decal-parity-features.test.ts` for N/Ctrl+D/[-] select-mode reorder logic; FPE align-bounds fix gets a unit test on the extracted bounds helper. CDP: F1 overlay opens in faceplate editor; handles visible on selected decal in DPE.

---

## Sequencing & parallelism verdict

- **Wave 1 (parallel worktrees):** Phase 1 ∥ Phase 2 — file-disjoint (P1: scripts/ + faceplate-mod-build.ts; P2: lib history + editors). Merge P1 first (small), then P2.
- **Waves 2–5 (strictly serial, merge in order):** Phase 3 → Phase 4 → Phase 5 → Phase 6. Hot files force this: Editor.tsx is touched by 2/3/4/5(/6-optional) in disjoint regions but the same file; TopBar.tsx is owned solely by Phase 4; App.tsx solely by Phase 3; TemplateDecalPills.tsx solely by Phase 4; DPE/FPE by 2 then 6.
- After each merge: `npx tsc -b` + that phase's targeted vitest. After Phase 6: full `npx vitest run` + a CDP screenshot pass over the F2/F7/F8/F9/F10/F12 checks + (if any sga-writer change happened in Phase 1) the full three-pack game-harness re-verify.

## Top 3 break risks + guards

1. **Metadata index vs existing blobs** (stale names/workshop ids, broken delete flows). Guard: lazy parse-on-miss backfill; index updated in persist/clearWorkshopId/delete helpers; golden-compare test asserting `listAll*` output is identical to the legacy implementation on seeded legacy storage; validity gate retained at click time.
2. **FLIP-hold removal regressing open transitions** (black flash, AuthShell stuck on a phase it no longer receives). Guard: keep the 'editor-loading' phase for the skin editor (onReady-driven, just no minimum hold); faceplate/decal opens wrapped in `withViewTransition`; AuthShell itself untouched; CDP screenshot sequence (t0–t3) compared against /tmp/coh2-evidence/feedback/F2-t*.png before merging.
3. **Shared-history migration breaking pinned editor behaviors** (editor-undo-redo-stack.test.ts, decal-parity-features.test.ts, VTE prop contract). Guard: run those suites green BEFORE refactoring as baseline; preserve `mutate`/`undo`/`redo`/`commit` signatures at every call site via thin wrappers; migrate one editor per commit with targeted vitest between commits; `EditSnapshot.label` and VehicleTextureEditor props unchanged.
