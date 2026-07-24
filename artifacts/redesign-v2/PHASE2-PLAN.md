# PHASE-2 STRUCTURAL REDESIGN — Implementation Plan

Self-contained brief for the Phase-2 structural work that VISION.md
(`artifacts/redesign-v2/VISION.md`) calls for but the Phase-1 reskin deferred
(GLITCH-LIST.md finding #8 + the "faction-first creation", "3D-left/canvas-right"
north stars). Every edit target below is cited `file:line` against the current
tree. The implementation agent should NOT need to re-read any source doc.

- Repo: `/var/home/jflessenkemper/dev/coh2-skin-editor`
- Stack: Electron 41 / React 19 / TS 6 / Tailwind v4 (CSS-config, NO `tailwind.config`) / Three.js / Vite 8. Vitest ~2189 tests.
- Pixel-proof harness: `electron/ui-capture.ts` (`UI_CAPTURE=1 electron .`), reads the module header for env vars. Outputs `artifacts/redesign-v2/ui-verify/<state>.png` (1600×1000, real GPU).
- Build/deploy per user policy: `npm run build && npm run electron:compile`; deploy the taskbar AppImage after each batch (the user tests the DEPLOYED build, not the dev window).

---

## Current-state facts the plan is built on (verified this session)

These correct several assumptions; read them before touching anything.

1. **Skin faction-first is HALF-BUILT and UNWIRED.** `FactionPicker.tsx` (5-faction
   vertical list, lab01-styled inside AuthShell) and `NewProjectForm.tsx` (pack
   name/desc/author + template) already exist and are tested. **But App.tsx does
   NOT use them for "New Skin Pack"** — `App.tsx:571-578` `onNewSkin` just clears
   `localStorage['coh2-skin-active-project']` and jumps straight to `phase='editor'`.
   The header comment in `StartScreen.tsx:8` ("New Skin Pack → FactionPicker →
   NewProjectForm → Editor") describes an INTENDED flow that is not wired.
2. **`Editor` already accepts `initialFaction?: Faction`** (`Editor.tsx:108`,
   destructured `:125`). It seeds `selectedFaction` (`Editor.tsx:182-183`) and the
   initial vehicle (`Editor.tsx:171`), and `selectedFaction` drives the bottom
   `VehicleMenu` via `factionVehicles = vehiclesForFaction(selectedFaction)`
   (`Editor.tsx:455`) and the `FactionPanel` tab (`Editor.tsx:2340-2345`). **App.tsx
   mounts `<Editor>` at `App.tsx:685-692` WITHOUT passing `initialFaction` or
   `initialProject`.** So the wiring gap is purely in App.tsx.
3. **Skin `faction` is NOT a stored top-level field** on `Coh2SkinProject`
   (`src/lib/project.ts` — no `faction:` key; faction is derived from
   `vehicles`/`factionDefaults`, e.g. `slot.factions: Faction[]` at `:144`). Legacy
   projects therefore have no faction; current behavior = derive from
   `lastVehicleId`/first vehicle. **Add an OPTIONAL `faction?: Faction`** so new
   packs remember their creation faction; absent = legacy = current behavior.
4. **The VehicleTextureEditor (VTE) is ALREADY a full-screen overlay**, opened by
   the `textureEditorOpen` boolean (`Editor.tsx:927`, opened at `:2395`, mounted at
   `Editor.tsx:2448-2468`). It is NOT a separate route. It reuses the skin editor's
   live `overlayCanvas` (`overlayCanvasRef.current`, `Editor.tsx:2450`). Today it is a
   **fullscreen 2D canvas** (`VehicleTextureEditor.tsx:568` on-screen canvas; blit at
   `:277`); the main editor Viewport is fully occluded behind it while open.
5. **`EditTextureButton.tsx` opens the VTE** (`Editor.tsx:2392-2396`, `onClick={() =>
   setTextureEditorOpen(true)}`). It lives in the mid control row
   (`Editor.tsx:2378-2397`), to the RIGHT of the SeasonToggle, ABOVE the VehicleMenu
   (`Editor.tsx:2398`). `brushOn={textureEditorOpen}` reflects VTE-open state.
   `data-testid="edit-texture-pill"`, `aria-label` toggles
   "Edit vehicle texture"/"Exit texture-edit mode" (`EditTextureButton.tsx:47`).
6. **Viewport already exposes the two live-preview props** the decal/texture 3D
   previews need: `overlayCanvas?` (`Viewport.tsx:80`, camo → material `.map`) and
   `badgeDecalSource?: string | HTMLCanvasElement | null` (`Viewport.tsx:193`, →
   `uDecalTex` through the TC1 badge shader, re-tinted on `vehicle.faction`,
   `Viewport.tsx:4374-4454`). The skin editor already feeds `badgeDecalSource` when a
   decal pack is selected. `ViewportGuard` wraps Viewport for no-WebGL (used at
   `App.tsx:543`).
7. **The decal editor already builds a live composite** of the active part:
   `refPreviewDataUrl` (`DecalPackEditor.tsx:315`, rebuilt in the effect at
   `:316-374`, a `DECAL_PACK_SIZE²` data URL of the active part's shared layers).
   This is the exact source to feed a left-side Viewport's `badgeDecalSource` (after
   rasterising into the badge cell — see Slice 4). Decal editor is react-konva
   (`DecalPackEditor.tsx:28`); it has `activeFaction?: DecalFaction | null` (which
   cell is edited, `:262`) but NO `targetFaction` (pack-level army). `DecalFaction`
   excludes "shared"; `FACTION_ORDER = ['aef','british','german','soviet','west_german']`
   (`decal-mod-templates.ts:32`).
8. **Faceplates have NO faction** and MUST NOT get a faction step (VISION + brief).
   `NewFaceplateForm.tsx` has zero faction refs; leave the faceplate flow untouched.

---

## Slice boundaries (DISJOINT — no file is owned by two slices)

| Slice | Owns (exclusive edit rights) | Never touches |
|---|---|---|
| **S1 Faction-first creation** | `src/App.tsx`, `src/lib/project.ts`, `src/lib/decal-pack-project.ts`, `src/components/FactionChooserStep.tsx` (NEW), `src/components/StartScreen.tsx` (only the two comment lines if desired — no behavior), `src/lib/decal-mod-templates.ts` (read-only, no edit) | Editor.tsx, VehicleTextureEditor.tsx, DecalPackEditor.tsx, EditTextureButton.tsx, VehicleMenu.tsx, ui-capture.ts |
| **S2 "Edit vehicle" affordance** | `src/components/EditTextureButton.tsx`, `src/components/EditVehicleAffordance.tsx` (NEW), `src/components/Editor.tsx` (ONLY the control-row + affordance region `~2350-2407`) | App.tsx, project.ts, VTE, DecalPackEditor, ui-capture.ts, VehicleMenu.tsx |
| **S3 Texture editor 3D-left/canvas-right** | `src/components/VehicleTextureEditor.tsx` (whole file) | App.tsx, Editor.tsx*, DecalPackEditor.tsx, EditTextureButton.tsx, project.ts, ui-capture.ts |
| **S4 Decal editor 3D-left/canvas-right** | `src/components/DecalPackEditor.tsx` (whole file), `src/components/DecalPreviewViewport.tsx` (NEW) | App.tsx, Editor.tsx, VTE, EditTextureButton.tsx, project.ts, ui-capture.ts |
| **S5 Harness updates** | `electron/ui-capture.ts` (whole file) | all `src/**` |

\* **S2/S3 boundary on Editor.tsx**: S2 edits ONLY the control-row/affordance region
(`Editor.tsx ~2350-2407`). S3 owns `VehicleTextureEditor.tsx` and does NOT edit
Editor.tsx. The one Editor.tsx line S3 needs (`initialFaction` for the VTE's Viewport)
is already present via the reused `overlayCanvas` prop — S3 adds NEW props to the VTE
mount at `Editor.tsx:2449-2467`. **To keep Editor.tsx single-owner, S3's VTE-mount
prop additions are delegated to S2** (S2 already edits that Editor.tsx region). See the
"Cross-slice handoff" note in S3. If sequencing S3 before S2 is preferred, invert: S3
owns the whole VTE-mount edit and S2 owns only `EditTextureButton.tsx` + the
`EditVehicleAffordance` insertion. **Pick ONE owner for Editor.tsx and state it in the
commit — do not let both slices edit it in parallel.**

**Recommended sequence:** S1 → S2 → S3 → S4 → S5 (S5 depends on the flows S1/S2/S4
introduce). S3 and S4 are independent of each other and can run in parallel.

---

## SLICE 1 — Faction-first creation

**Goal (VISION.md:16-18, 26):** clicking "New Skin Pack" or "New Decal Pack" opens a
FACTION CHOOSER (5 factions + emblems, lab01 black modal consistent with the
StartScreen card) BEFORE the editor. The chosen faction: (a) filters the skin editor's
bottom VehicleMenu + sets the FactionPanel tab; (b) sets the decal pack's target
faction context. Faceplates: NO faction step.

### Design decision: NEW `FactionChooserStep` (thin), not the full FactionPicker flow

`FactionPicker.tsx` is coupled to the skin `NewProjectForm` prefetch/preload flow
(`onPrefetch`, `enterDelay`, `picked` lock). Rather than reuse it (which would drag in
`NewProjectForm`, breaking the "generic default name, no form" VISION for the
declutter), create ONE new lightweight `FactionChooserStep.tsx` used by BOTH the skin
and decal new-flows. It renders the same 5 rows as `FactionPicker.tsx:104-159` (emblem
+ label + sublabel, `FACTION_ICON_SRC`/`FACTION_LABELS` from `src/lib/factions.tsx`)
inside AuthShell, but its `onPick(faction)` goes straight to the editor with a generic
default pack name (VISION: "generic default name; click the label to rename" — no
intermediate details form). This preserves the "simple but powerful, no boxes" north
star: chooser → editor, one click.

> Legacy `FactionPicker.tsx` + `NewProjectForm.tsx` remain in the tree (still tested,
> still importable for a future "advanced new" path) but are NOT wired by this slice.
> Do NOT delete them (their tests would fail; out of scope).

### S1 owner files + exact edits

**A. `src/lib/project.ts` — add optional stored faction.**
- Add to the `Coh2SkinProject` interface (near `factionDefaults` at `project.ts:204`):
  `/** Faction chosen at creation (faction-first flow). Absent on legacy projects → derive from vehicles. */ faction?: Faction`
- Extend `newProject(packName = 'My Skin Pack')` (`project.ts:338`) to
  `newProject(packName = 'My Skin Pack', faction?: Faction)` and set `faction` on the
  returned object when provided (place the field write next to `lastVehicleId`). Keep
  the 1-arg call sites working (optional param).

**B. `src/lib/decal-pack-project.ts` — add pack-level target faction.**
- Add to `Coh2DecalPackProject` (near `activeFaction` at `decal-pack-project.ts:343`):
  `/** Army this pack is authored for (faction-first flow). Absent on legacy packs → 'shared'/all-factions behavior unchanged. */ targetFaction?: DecalFaction`
- Extend `newDecalPackProject(packName = 'My Decal Pack')` (`:441`) to accept an
  optional `targetFaction?: DecalFaction` and set it + seed `activeFaction` to the same
  value so the editor opens on that faction's cell. Import `DecalFaction` type (already
  imported at `decal-pack-project.ts` via `decal-mod-templates`).

**C. `src/components/FactionChooserStep.tsx` (NEW).**
- Props: `{ exiting?: boolean; title: string; subtitle: string; onPick: (f: Faction) => void; onBack: () => void }`.
- Render exactly the row idiom of `FactionPicker.tsx:104-159` (copy the row markup;
  it's ~55 lines, self-contained) minus the `onPrefetch`/preload coupling. Reuse
  `FACTION_ICON_SRC`, `FACTION_LABELS` from `@/lib/factions`, `FACTIONS = ['german','west_german','soviet','aef','british']`,
  and `Stagger` for the entrance. Back button = `FactionPicker.tsx:75-87` markup.
- `title`/`subtitle` are passed by the caller ("Which faction?" / "Pick the army your
  skin belongs to." for skin; "Pick the army this decal pack is for." for decal) so
  ONE component serves both.

**D. `src/App.tsx` — wire the chooser between StartScreen and the editors.**
- Add two phases to the phase union (find the `phase` state type; it currently includes
  `'connect' | 'start' | 'saved-projects' | 'probing' | 'editor-loading' | 'editor' |
  'faceplate' | 'decal-pack'`): `'faction-chooser-skin' | 'faction-chooser-decal'`.
- Add a `chosenFaction` state (`useState<Faction | null>(null)`) to carry the pick from
  the chooser into the editor mount.
- **Rewire `onNewSkin`** (`App.tsx:571-578`): instead of jumping to `'editor'`, clear
  active-project (keep the `localStorage.removeItem` lines) and
  `withViewTransition(() => setPhase('faction-chooser-skin'))`.
- **Rewire `onNewDecalPack`** (`App.tsx:580`): from
  `openDecalPack(newDecalPackProject())` to
  `withViewTransition(() => setPhase('faction-chooser-decal'))`.
- **Leave `onNewFaceplate` (`App.tsx:579`) UNTOUCHED** (no faction step).
- Add the chooser panels to the `inAuthShell` panel switch (extend `inAuthShell` at
  `App.tsx:549-554` to include the two new phases; add branches after the `'start'`
  branch `App.tsx:567-588`):
  - `faction-chooser-skin`: `<FactionChooserStep title="Which faction?" subtitle="Pick the army your skin belongs to." onBack={() => setPhase('start')} onPick={f => { setChosenFaction(f); withViewTransition(() => setPhase('editor')) }} />`
  - `faction-chooser-decal`: `<FactionChooserStep title="Which faction?" subtitle="Pick the army this decal pack is for." onBack={() => setPhase('start')} onPick={f => { openDecalPack(newDecalPackProject('My Decal Pack', f as DecalFaction)); }} />` — where `openDecalPack` already sets `phase='decal-pack'`.
- **Pass faction into the skin `<Editor>` mount** (`App.tsx:685-692`): add
  `initialFaction={chosenFaction ?? undefined}` and
  `initialProject={chosenFaction ? newProject('My Skin Pack', chosenFaction) : undefined}`.
  Import `newProject` (already imports `newFaceplateProject`/`newDecalPackProject`
  pattern; add `newProject` from `@/lib/project`). Note: `Editor` already falls back to
  `loadActive() ?? newProject('My Skin Pack')` at `Editor.tsx:131-132`, so passing
  `initialProject` with the faction is the clean path; `initialFaction` additionally
  seeds `selectedFaction`/first vehicle.
- Map `Faction` → `DecalFaction`: both share the string literals
  (`'german'|'west_german'|'soviet'|'aef'|'british'`) so a cast is safe; add a tiny
  guard `faction as DecalFaction` at the decal call site (all 5 skin factions are valid
  `DecalFaction` members per `decal-mod-templates.ts:32`).

### S1 persistence + legacy defaults
- Skin: faction persists via `project.faction` (new optional field). Editor derivation
  is unchanged when absent → **legacy projects keep current behavior**.
- Decal: `targetFaction` persists on the pack; when absent the editor's existing
  `activeFaction=null` ("shared / all factions") path is unchanged → legacy behavior.
- The chooser is ONLY on the NEW-pack path. "Continue", "Load Project", and
  SavedProjectsList open editors directly with no chooser (unchanged).

---

## SLICE 2 — "Edit vehicle" affordance above the selector

**Goal (VISION.md:19):** clicking a vehicle in the bottom selector surfaces an
"Edit this vehicle" affordance ABOVE the selector that opens the texture editor for
that vehicle. Today the Edit-texture pill lives permanently in the mid control row
(`Editor.tsx:2378-2397`).

### Design decision: move the pill ABOVE the VehicleMenu, reveal-on-selection (vision-literal)

VISION is literal: the affordance appears "above the selector" and is the entry to the
texture editor. Implement as a dedicated `EditVehicleAffordance.tsx` row rendered
directly ABOVE `<VehicleMenu>` (`Editor.tsx:2398`), inside the same bottom cluster
(`Editor.tsx:2356` `flex flex-col gap-3 items-center`). It shows the currently selected
vehicle's name and an "Edit this vehicle" action. Keep `EditTextureButton.tsx`'s
behavior (opens VTE via the same `onClick`), but relocate it out of the mid control row.

### S2 owner files + exact edits

**A. `src/components/EditVehicleAffordance.tsx` (NEW).**
- Props: `{ vehicleName: string | null; onEdit: () => void; disabled?: boolean; editing: boolean }`.
- Render a single centered pill row: `Edit {vehicleName}` (e.g. "Edit Tiger I"). When
  `vehicleName` is null (no selection) render nothing (`return null`) so the affordance
  only appears once a vehicle is chosen — matching "clicking a vehicle … surfaces" the
  affordance. Reuse the exact glass-pill + `l01-ring` styling and the gold/green active
  treatment from `EditTextureButton.tsx:42-84` (copy the `className`/`style` blocks so
  the visual family is identical). Keep `aria-label` = `editing ? 'Exit texture-edit
  mode' : 'Edit vehicle texture'`, `aria-pressed={editing}`,
  `data-testid="edit-texture-pill"` (KEEP this testid — the harness + any test key off
  it; see S5 + Test-impact table). Keyboard: it's a native `<button>` (Enter/Space
  work); ensure `focus-visible` ring is preserved.

**B. `src/components/EditTextureButton.tsx`.**
- Option A (minimal): keep `EditTextureButton.tsx` as the internal pill and have
  `EditVehicleAffordance` render it, passing the vehicle name into the label. Simplest:
  add an optional `label?: string` prop to `EditTextureButton` (default
  `'Edit texture'`) and render `<EditVehicleAffordance>` as a thin positioning wrapper
  that passes `label={`Edit ${vehicleName}`}`.
- Option B (clean): fold `EditTextureButton`'s markup into `EditVehicleAffordance` and
  leave `EditTextureButton.tsx` re-exporting for back-compat. **Choose A** to minimize
  churn and keep `EditTextureButton.test`/`data-testid` green.

**C. `src/components/Editor.tsx` (control-row + affordance region ONLY, `~2350-2407`).**
- **Remove** the `<EditTextureButton …>` from the mid control row
  (`Editor.tsx:2392-2396`) — it currently sits after `<SeasonToggle>`.
- **Insert** `<EditVehicleAffordance vehicleName={veh?.name ?? vehicle?.id ?? null}
  editing={textureEditorOpen} disabled={!vehicle} onEdit={() =>
  setTextureEditorOpen(true)} />` directly BEFORE `<VehicleMenu …>`
  (`Editor.tsx:2398`), so the row order becomes:
  `[TemplateDecalPills + SeasonToggle]` → `[EditVehicleAffordance]` → `[VehicleMenu]`.
- Import `EditVehicleAffordance` at the top import block near `Editor.tsx:20`
  (replace/augment the `EditTextureButton` import).
- The affordance's visibility is naturally gated by `vehicleName != null`, and `vehicle`
  is always set once the editor has a selection (it defaults to a german vehicle), so
  "appears on selection" reads correctly; if a truly empty initial state is possible,
  the `return null` guard handles it.

### S2 keyboard/aria
- Native `<button>` → Enter/Space fire `onEdit`. Preserve `aria-pressed`, `aria-label`,
  `focus-visible:ring-*` from the copied styles. The existing `Esc`-to-exit inside the
  VTE (`VehicleTextureEditor.tsx:432`) is unaffected.

---

## SLICE 3 — Texture editor: 3D LEFT + canvas RIGHT

**Goal (VISION.md:20):** restructure the fullscreen 2D VTE into a split — live 3D
Viewport LEFT, texture canvas RIGHT, tools at the BOTTOM spanning, options-peel above
tools (already the pattern), back button top-left (already). One WebGL context; the main
editor Viewport is hidden behind the VTE today.

### Design decision: reuse the SAME live overlayCanvas via a fresh Viewport, remount-on-open

**Perf decision — remount, do NOT try to reparent the main editor Viewport.** The main
editor Viewport (`Editor.tsx`) is occluded (not unmounted) while `textureEditorOpen`.
Trying to move that live WebGL context into the VTE's DOM subtree mid-session is
fragile (React can't reparent a canvas without remount; the OrbitControls/scene state
would need transfer). Instead: **the VTE mounts its OWN `Viewport` on the left half**,
fed the SAME `overlayCanvas` prop (`p.overlayCanvas`, already passed at
`Editor.tsx:2450`) so it renders the live-painted diffuse in real time (`overlayCanvas`
→ material `.map`, `Viewport.tsx:4306`). This is a SECOND WebGL context only while the
VTE is open; the editor's context is idle behind it (occluded, not animating heavily).
Acceptable because (a) the VTE is a modal state, (b) the background context isn't
compositing chrome-over-viewport blur while covered. Wrap the VTE Viewport in
`ViewportGuard` (import from wherever `App.tsx:543` imports it — `@/components/ViewportGuard`)
so no-WebGL machines fall back gracefully to a canvas-only (current) layout.

> Alternative considered + rejected: single shared context via portal. Rejected —
> Three.js renderer + OrbitControls are bound to one canvas element; portaling the DOM
> node loses the GL state and forces a re-init anyway, which is what remount does more
> simply.

### S3 owner file + exact edits (`src/components/VehicleTextureEditor.tsx`, whole file)

- **Add props** to `Props` (`VehicleTextureEditor.tsx:103`): the data the left Viewport
  needs — `vehicle: VehicleSpec` (for mesh id + faction tint), `root: FileSystemDirectoryHandle`
  (install handle for RGM/RGT fetch), `season: 'summer' | 'winter'`, and optionally
  `badgeDecalSource?: string | HTMLCanvasElement | null` (so any selected decal-pack
  overlay also shows on the 3D preview). These are all already in scope in `Editor.tsx`
  at the VTE mount (`Editor.tsx:2448-2467`): `vehicle`, `root`, `season`,
  and the decal source — **plumb them through the VTE mount props (this Editor.tsx edit
  is owned by S2 per the boundary note; S3 hands S2 the exact prop list below).**
- **Restructure the JSX root** (currently a fullscreen container with the on-screen
  canvas at `VehicleTextureEditor.tsx:568`): make the main body a two-column flex/grid:
  - LEFT (~50% width, full height minus the bottom tool dock): a `<ViewportGuard><Viewport … /></ViewportGuard>`
    fed `overlayCanvas={p.overlayCanvas}`, `vehicle={p.vehicle}`, `root={p.root}`,
    `season={p.season}`, `badgeDecalSource={p.badgeDecalSource}`. Mirror the prop set
    the skin editor passes to its Viewport (grep `Editor.tsx` for `<Viewport` to copy
    the exact required prop names — do NOT invent prop names; the load-bearing ones are
    `overlayCanvas`/`badgeDecalSource` per `Viewport.tsx:80,193`).
  - RIGHT (~50% width): the existing on-screen paint `<canvas>` (`VehicleTextureEditor.tsx:568`)
    and its interaction handlers, moved into the right column. Keep the blit
    (`:277`) and UV-overlay (`:246-269`) logic intact.
  - BOTTOM (spanning both columns): the `BottomToolPill` tool dock
    (`VehicleTextureEditor.tsx` — grep for `BottomToolPill` render) with its
    `ToolOptionsPeel` ABOVE it (already the pattern per the tool-peel imports at `:49-50`).
  - TOP-LEFT: the Back pill + Undo/Redo cluster (`VehicleTextureEditor.tsx:589-621`)
    stays where it is (already top-left).
- **Sizing**: the paint canvas currently CSS-scales a `VIEW²` internal buffer to a
  square (`VehicleTextureEditor.tsx:83-86`). In the right column, constrain it to the
  right half's min dimension (keep it square, centered) so painting stays 1:1-ish. Pan/
  zoom (`use-pan-zoom.ts`) still applies to the right canvas only.
- **Real-time sync**: painting writes to `p.overlayCanvas` (the shared atlas) on every
  dab (`onComposite`/`onDabComposite`, `Editor.tsx:2457`), and the left Viewport already
  re-uploads `overlayCanvas` as the material map on prop change / `modelTick`
  (`Viewport.tsx:4306,4359`). Bump the `version` prop (`VehicleTextureEditor.tsx` uses
  `p.version` / `overlayVersion`) so the left Viewport's `overlayCanvas`-change effect
  re-fires; if the Viewport only re-uploads on referential change, force a texture
  `needsUpdate` by keying the Viewport re-render off `p.version` (pass a
  `overlayTick={p.version}`-style prop only if Viewport already supports it — otherwise
  rely on the existing `modelTick`/CanvasTexture `needsUpdate` path the skin editor uses
  live; confirm by grepping `Viewport.tsx` for how the skin editor's paint updates the
  map without remount).
- **No-WebGL**: `ViewportGuard` renders its fallback in the left column; the right
  canvas remains fully usable → the VTE degrades to "canvas only, no 3D preview" exactly
  like today's fullscreen canvas.

### Cross-slice handoff (S3 → Editor.tsx owner)
The Editor.tsx VTE-mount prop additions (`vehicle`, `root`, `season`,
`badgeDecalSource`) are made by **S2** (the Editor.tsx owner) at `Editor.tsx:2449-2467`.
S3 delivers the exact prop names + values (all already in scope there). If S2 and S3 are
done by the same agent, fold both; if parallel, S3 must NOT edit Editor.tsx.

---

## SLICE 4 — Decal editor: live 3D preview LEFT + canvas RIGHT (GLITCH-LIST #8)

**Goal (VISION.md:26-27, GLITCH-LIST #8):** embed a Viewport on the LEFT showing a
representative vehicle of the chosen faction with the decal pack's CURRENT canvas
content applied live through the TC1 badge pipeline (`badgeDecalSource`), debounced.
Canvas on the RIGHT. LAYERS/PROPERTIES pills adapt around it. Today: LAYERS-left /
canvas-center / PROPERTIES-right, no 3D.

### Design decision: new `DecalPreviewViewport` wrapper; feed the live composite as badgeDecalSource

The decal editor already computes a live `DECAL_PACK_SIZE²` composite of the active part
(`refPreviewDataUrl`, `DecalPackEditor.tsx:315-374`). Feed that into a left-side
Viewport as `badgeDecalSource` (the same mechanism `Editor.tsx` uses for skin-editor
decal preview → `uDecalTex` via TC1 shader, `Viewport.tsx:4374-4454`). The badge cell is
a small sub-rect of a 2048² atlas; per the wiki (coh2-vehicle-decal-rendering.md), the
editor rasterises the badge into `BADGE_CELL {x:586,y:80,w:104,h:96}` of a transparent
2048² wrapper before feeding `badgeDecalSource`. **Reuse that wrapper step**: grep
`Editor.tsx` for `BADGE_CELL` / how it builds the `badgeDecalSource` from a decal-pack
composite (`Editor.tsx:807-912` region per the wiki) and factor the identical
rasterise-into-cell helper for the decal editor's own composite.

### S4 owner files + exact edits

**A. `src/components/DecalPreviewViewport.tsx` (NEW).**
- Props: `{ faction: DecalFaction; installRoot: FileSystemDirectoryHandle | null; badgeSource: string | HTMLCanvasElement | null }`.
- Pick a REPRESENTATIVE vehicle for the faction: reuse `FACTION_DEFAULT_VEHICLE` /
  `defaultVehicleForFaction` (already imported in `Editor.tsx`, from `@/lib/vehicles`)
  — grep for the exact export name. Map `DecalFaction` → `Faction` (identical literals).
- Render `<ViewportGuard><Viewport vehicle={representative} root={installRoot}
  badgeDecalSource={badgeSource} season="summer" … /></ViewportGuard>` with the SAME
  required prop set the skin editor passes (copy from `Editor.tsx`'s `<Viewport`). The
  `vehicle.faction` drives the badge tint automatically (`Viewport.tsx:4454`).
- `ViewportGuard` fallback: a static representative-vehicle thumbnail or the existing
  `refPreviewDataUrl` `<img>` so no-WebGL machines still see the decal art.

**B. `src/components/DecalPackEditor.tsx` (whole file).**
- **Debounced badge source**: add state `badgeSource` derived from `refPreviewDataUrl`
  (`:315`). Add a debounced effect (~150-250ms) that, when `refPreviewDataUrl` changes,
  rasterises it into the badge cell wrapper (see the shared helper from `Editor.tsx`) and
  sets `badgeSource`. Debounce so rapid drags don't thrash the CanvasTexture upload.
- **Target faction**: read `project.targetFaction` (S1 added it; absent → default to
  `'german'` representative for the preview, or the current `activeFaction`). This is the
  faction whose representative vehicle the left Viewport shows.
- **Layout restructure**: the current layout is LAYERS-left / canvas-center /
  PROPERTIES-right (grep `DecalPackEditor.tsx` for the `LayersPanel` / canvas / `PropertiesPanel`
  container). Restructure to:
  - LEFT half: `<DecalPreviewViewport faction={project.targetFaction ?? 'german'}
    installRoot={_installRoot} badgeSource={badgeSource} />`.
  - RIGHT half: the existing Konva `<Stage>` decal canvas (`DecalPackEditor.tsx:28`
    import; the canvas container `canvasRef` at `:932`).
  - LAYERS + PROPERTIES: adapt to compact pills that flank the right canvas (they were
    already made compact content-sized pills in Phase-1, GLITCH-LIST #7 →
    `LayersPanel.tsx:110-111` / `PropertiesPanel.tsx:135`). Keep them anchored (LAYERS
    top-left-of-canvas, PROPERTIES top-right-of-canvas) so the LEFT half is the 3D
    preview, not a panel.
  - BOTTOM: the `BottomToolPill` + `ToolOptionsPeel` stay spanning at the bottom
    (unchanged pattern).
  - Back button top-left (unchanged, home cluster).
- **installRoot**: `DecalPackEditor` already receives `installRoot: _installRoot`
  (`DecalPackEditor.tsx:171`, currently unused-prefixed). Un-prefix and pass it to
  `DecalPreviewViewport`.

### S4 perf
- ONE WebGL context (the decal editor is otherwise 2D Konva → no existing context to
  conflict). Debounce the `badgeSource` upload. The representative mesh loads once;
  `badgeDecalSource` changes are pure prop flips (`Viewport.tsx:4374`), cheap.

---

## SLICE 5 — Harness updates (`electron/ui-capture.ts`, whole file)

**Goal:** the state drivers must follow the new flows. New states:
`faction-chooser-skin`, `faction-chooser-decal`, `texture-split`, `decal-3d-preview`.
The new-skin/new-decal navigation now goes THROUGH the faction chooser.

### S5 owner file + exact edits (`electron/ui-capture.ts`)

- **Add to `ALL_SCREENS`** (`ui-capture.ts:65-80`):
  `'faction-chooser-skin'`, `'faction-chooser-decal'`, `'texture-split'`, `'decal-3d-preview'`.
- **New-flow navigation now hits the chooser.** Every path that clicked "New Skin Pack"
  or "New Decal Pack" and expected the editor now lands on the FACTION CHOOSER first.
  Update these driver blocks:
  - `new-skin-form` (`:292-301`): after clicking "New Skin Pack" (`:293`), the app shows
    `FactionChooserStep` ("Which faction?"). Update the note; capture the chooser here OR
    add a distinct state (below). Then to reach the skin editor, click a faction
    (e.g. `clickWhenReady(wc, 'Wehrmacht', 'includes')` or match the German row by
    `FACTION_LABELS.german`) before the Tiger-I pick.
  - `skin-editor` / `skin-*` / `texture-editor` (`:320-383`): after "New Skin Pack"
    (`:325`), **insert a faction pick** — `await clickWhenReady(wc, 'Which faction', …)`
    is a text probe; click the German faction row (match by the emblem row's
    aria-label/`title` = `FACTION_LABELS.german`, e.g. `clickWhenReady(wc, 'German', 'includes')`).
    THEN proceed to the Tiger-I pick (`:330`) as before.
  - `decal-editor` / `decal-*` (`:386-425`): after "New Decal Pack" (`:389`), **insert a
    faction pick** (same German-row click) before waiting for the canvas.
- **New STATE: `faction-chooser-skin`** — click "New Skin Pack", DO NOT pick a faction,
  `capture()` the chooser. Confirm via `hasText('Which faction')`.
- **New STATE: `faction-chooser-decal`** — click "New Decal Pack", DO NOT pick, capture
  the chooser. (Same component; distinct because the subtitle text differs — probe
  `hasText('decal pack is for')`.)
- **New STATE: `texture-split`** — reach the skin editor (New Skin Pack → German →
  Tiger I → wait 3D), then open the VTE via the affordance
  (`clickWhenReady(wc, 'Edit vehicle texture', 'starts')` or the
  `edit-texture-pill` testid — the affordance KEEPS `data-testid="edit-texture-pill"`
  per S2). Capture with extra 3D settle so BOTH the left Viewport AND the right paint
  canvas are painted. (This supersedes/renames the old `texture-editor` state, which was
  the fullscreen 2D canvas — keep `texture-editor` too if a before/after is wanted, but
  it now shows the split.)
- **New STATE: `decal-3d-preview`** — reach the decal editor (New Decal Pack → German →
  wait 3D), capture with extra settle so the LEFT representative-vehicle Viewport has
  rendered with the badge composite. Confirm `!!document.querySelector('canvas')` (now
  there IS a 3D canvas in the decal editor, unlike today).
- **Affordance click label**: the "Edit vehicle texture" affordance (S2) exposes
  `aria-label="Edit vehicle texture"` + `data-testid="edit-texture-pill"`. The existing
  `texture-editor` driver already tries all three (`ui-capture.ts:372-375`) — keep that
  fallback chain; it will find the relocated affordance.

---

## Test-impact table (which tests pin the OLD flows)

| Test file | What it pins | Impact of this plan | Action |
|---|---|---|---|
| `src/components/__tests__/StartScreen.test.tsx` | Renders "New Skin Pack"/"New Decal Pack" tiles; `onNewSkin`/`onNewDecalPack` fire on click; button→`<div.text-[14px]>` DOM shape (`StartScreen.tsx:437`) | **S1** doesn't change StartScreen's own callbacks (App.tsx rewires what they DO). DOM shape unchanged. | **No change expected.** Verify green after S1. |
| `src/components/__tests__/NewProjectForm.test.tsx` | Skin `NewProjectForm` fields/submit | **S1 does NOT wire NewProjectForm** (chooser goes straight to editor). Component unchanged. | **No change.** Still passes (component still exists). |
| `src/components/__tests__/FactionPicker.test.tsx` | `FactionPicker` rows/pick/prefetch | **S1 does NOT touch FactionPicker** (new `FactionChooserStep` is separate). | **No change.** Add a NEW `FactionChooserStep.test.tsx` (5 rows render, `onPick` fires, `onBack` fires). |
| `src/components/__tests__/NewDecalPackForm.test.tsx` | Decal form fields/submit | **S1 bypasses this form** for new-decal (chooser → editor). Component still exists/tested. | **No change** to the test; component unused in the new path but retained. |
| `src/components/__tests__/NewFaceplateForm.test.tsx` | Faceplate form; NO faction | **Untouched** (faceplates get no faction step). | **No change.** |
| `src/components/__tests__/editorWiring.test.tsx` | Faceplate/decal panel internals (Noise slider, GradientFill, Eraser, BlendMode) — NOT the faction/VTE flow (`editorWiring.test.tsx:11-13,145-335`) | **S3/S4** restructure layout, not these panels. Selectors are content-based (`querySelector('.class')`, role). | **Likely green;** re-run after S3/S4. If a container-structure selector breaks, update the selector in lockstep. |
| `src/components/__tests__/VehicleMenu.test.tsx` | Active pill `bg-white/95`, `.bg-orange-400` dot (`VehicleMenu.test.tsx:245,247,260-262`) | **No slice edits VehicleMenu.tsx.** S2 inserts a sibling ABOVE it in Editor.tsx. | **No change.** Keep `bg-white/95` marker (test-pinned NAME). |
| `EditTextureButton.test` (if present) | `data-testid="edit-texture-pill"`, `aria-label` toggle, `aria-pressed` | **S2** relocates + wraps it. KEEP `data-testid="edit-texture-pill"` + the aria-labels. | **Keep testid/aria.** Update only if the test asserts the button's PARENT/position (it shouldn't — it queries by testid). |
| Editor / Viewport tests | Editor mount, Viewport props | **S2** changes the control row; **S3** adds VTE Viewport props. | Re-run; update any test asserting the old control-row order. |
| `App` / routing tests (if any) | Phase transitions | **S1** adds two phases + rewires `onNewSkin`/`onNewDecalPack`. | Update/add: New Skin Pack → `faction-chooser-skin`; New Decal Pack → `faction-chooser-decal`. |

**Test-safety rules carried from Phase 1:** keep `bg-white/95`, `.bg-orange-400`,
`glass-*` utility NAMES, Toasts kind-classes, `data-testid="edit-texture-pill"`. Values
free, names pinned.

---

## Verification checklist per slice (harness states + required pixels)

**S1 — Faction-first creation**
- Harness: `UI_SCREENS=faction-chooser-skin,faction-chooser-decal,start UI_CAPTURE=1 electron .`
- `faction-chooser-skin.png` MUST show: the lab01 black modal (patterned near-black
  card, corner-light ring) with the 5 faction rows (emblem + label + sublabel:
  Wehrmacht / OKW / Red Army / US Forces / British), a Back affordance, title
  "Which faction?". Consistent with the StartScreen card surface.
- `faction-chooser-decal.png` MUST show the same 5 rows with the decal subtitle
  ("Pick the army this decal pack is for.").
- Manual/`tsc`: new pack's `project.faction` set; opening the skin editor from the
  chooser lands with the German (or chosen) vehicles in the bottom VehicleMenu and the
  FactionPanel tab on that faction (verify against `skin-editor.png`).
- `tsc -b` clean; full `npm test` green (StartScreen/FactionPicker/NewProjectForm/App).

**S2 — Edit-vehicle affordance**
- Harness: `UI_SCREENS=skin-editor UI_CAPTURE=1 electron .`
- `skin-editor.png` MUST show the "Edit {vehicle}" affordance pill ABOVE the bottom
  VehicleMenu (between the control row and the vehicle rail), NOT in the mid control row.
  The pill reads e.g. "Edit Tiger I". Gold/green active family matching the old
  EditTextureButton.
- Clicking it opens the VTE (covered by S3's `texture-split`).
- `EditTextureButton`/aria tests green; `data-testid="edit-texture-pill"` present.

**S3 — Texture editor split**
- Harness: `UI_SCREENS=texture-split UI_CAPTURE=1 electron .` (extra 3D settle).
- `texture-split.png` MUST show: LEFT half = live 3D vehicle (the painted diffuse
  visible on the mesh, updating from the paint), RIGHT half = the paint canvas, BOTTOM =
  the tool dock spanning with the options-peel above it, TOP-LEFT = Back pill + Undo/Redo.
  Paint a stroke (or rely on the live overlayCanvas) → the left mesh reflects it.
- No-WebGL fallback: left column shows the ViewportGuard fallback, right canvas still
  paints.
- `tsc -b` clean.

**S4 — Decal editor 3D preview (GLITCH-LIST #8)**
- Harness: `UI_SCREENS=decal-3d-preview UI_CAPTURE=1 electron .` (extra 3D settle).
- `decal-3d-preview.png` MUST show: LEFT = a representative German vehicle rendered in
  3D with the decal-pack's current composite applied on the hull-side badge cell (via
  TC1), RIGHT = the Konva decal canvas, compact LAYERS/PROPERTIES pills flanking the
  right canvas, BOTTOM = tool dock. This resolves GLITCH-LIST #8 (was: LAYERS-left /
  canvas-center / PROPERTIES-right, no 3D).
- Debounce: dragging a decal updates the left mesh within ~200ms, not per-frame.
- No-WebGL fallback: left shows the `refPreviewDataUrl` thumbnail.

**S5 — Harness**
- `UI_CAPTURE=1 electron .` (full ALL_SCREENS) captures 18/18 states OK (14 old + 4 new)
  with the faction-chooser inserted on the new-skin/new-decal paths. Summary line prints
  `18/18 states captured OK`. Each new PNG read at full res to confirm the pixels above.

**Global gate (after all slices):** `npm run build && npm run electron:compile && npm test`
all green; `tsc -b` clean; re-run the full harness; update GLITCH-LIST.md to mark #8
FIXED with the `decal-3d-preview.png` evidence; deploy the taskbar AppImage.

---

## Risk notes
- **Two WebGL contexts (S3 while VTE open).** Idle-occlude the editor context; if FPS
  regresses, gate the editor Viewport's render loop to pause while `textureEditorOpen`.
- **Faction↔DecalFaction cast (S1).** Safe: identical literals, all 5 skin factions ∈
  `DecalFaction` (`decal-mod-templates.ts:32`). Add the cast at the App.tsx decal call site.
- **Editor.tsx single-owner (S2/S3).** Only ONE slice edits Editor.tsx. State the owner
  in the commit; never parallel-edit it.
- **Legacy projects.** No `faction`/`targetFaction` → existing derive-from-vehicles /
  shared-faction behavior unchanged. Verified: no code reads these fields as required.
- **Don't delete FactionPicker/NewProjectForm/NewDecalPackForm** — their tests pin them;
  they're retained for a possible future "advanced new" path.
