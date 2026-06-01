# Workshop UX Design Findings

> READ-ONLY investigation. Branch: `feat/atlas-faction-editor`. All citations
> are `file:line` verified. No code was modified.

---

## ITEM 1 — Title-bar parity

### Reference design: DecalPackEditor.tsx

The decal editor renders a **centered, fixed-position pill button** as its title bar. This is inline JSX — not a reusable component. Location: `src/components/DecalPackEditor.tsx:1214–1390`.

Structure (both branches are identical except for `BorderBeam` wrapper on first-open):

```tsx
// Outer positioning div (DecalPackEditor.tsx:1214)
<div style={{ position:'fixed', top:'calc(12px + var(--app-top-inset,0px))',
              left:'50%', transform:'translateX(-50%)', zIndex:50,
              WebkitAppRegion:'no-drag', display:'flex', flexDirection:'row',
              alignItems:'center', gap:8 }}>

  {/* Branch A — titleAcknowledged === false: pill inside <BorderBeam colorVariant="ocean" ...> */}
  <button type="button"
    style={{ display:'inline-flex', alignItems:'center', gap:6,
             height:36, paddingLeft:14, paddingRight:14, borderRadius:12,
             background:'rgba(15,17,22,0.75)',
             backgroundImage:'linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.03))',
             backdropFilter:'blur(40px) saturate(150%)',
             border:'0.5px solid rgba(255,255,255,0.08)',
             boxShadow:'inset 0 0.5px 0 rgba(255,255,255,0.05),0 4px 12px -4px rgba(0,0,0,0.2)',
             color:'rgba(247,247,250,0.88)', fontSize:14, fontWeight:700,
             maxWidth:'calc(100vw - 200px)', overflow:'hidden', textOverflow:'ellipsis' }}>
    <span>{project.packName || 'Unnamed Decal Pack'}</span>
    <span style={{ display:'inline-flex', flex:'none', transform:'scale(0.85)' }}>
      <StateIcon state={sync.state} />
    </span>
  </button>

  {/* PackIdentityPopover with publishSection prop (DecalPackEditor.tsx:1333) */}
  <PackIdentityPopover open={packNameEditOpen} onClose={...}
    publishSection={<PublishSection target={publishTarget} ... />} ... />
</div>
```

**Interaction**: single click on the pill toggles `packNameEditOpen`. `PackIdentityPopover` appears directly below. No hover menu. `StateIcon` is passive — hovering `title={liveSyncTitle}` reveals reason.

The pill is NOT itself a visibility control. Visibility lives inside `PackIdentityPopover` via the `publishSection` slot (`<PublishSection>`).

---

### FaceplateEditor.tsx title bar

Location: `src/components/FaceplateEditor.tsx:1568–1732`.

**Pixel-identical to the decal pill.** Same outer div, same two branches (BorderBeam vs plain), same button inline styles, same `StateIcon`, same `PackIdentityPopover` + `PublishSection` in `publishSection` prop. Only cosmetic differences:
- Fallback label: `'Unnamed Faceplate'` vs `'Unnamed Decal Pack'` (lines 1627/1673).
- `iconSlot.label` is `'Inventory icon'` vs `'Pack icon'`.
- No `extraSection` prop (decal adds an in-game-field-name note at line 1364).

**Conclusion: Faceplate already has parity with decal.** Both are inline JSX duplication.

---

### Vehicle editor (Editor.tsx + TopBar.tsx) title bar

No centered title pill. `TopBar.tsx` renders a **left-aligned floating glass bar** (`position:absolute, left:3`) containing: Home button | faction lobby icon | cluster buttons (Paint/Compose/Publish) | `LiveSyncBadge variant="inline"`. See `TopBar.tsx:301–495`.

Pack name edit is buried in Publish→Project sub-panel as a plain `<input>` at `TopBar.tsx:700–706`.

**Key differences from decal/faceplate:**
1. No centered top-center pill.
2. Pack name edit hidden in a panel sub-tab.
3. `LiveSyncBadge variant="inline"` (28×28, no glass) in the cluster row — not `StateIcon` inside a pill.
4. Uses legacy `PublishToWorkshopDialog` (full modal), not `PublishSection`-in-popover pattern.

---

### Is the title bar a reusable component?

No. The ~100-line JSX block is copy-pasted in two editors. Extraction target: `src/components/editor-primitives/EditorTitlePill.tsx`. Props: `packName`, `syncState`, `liveSyncTitle`, `liveSyncAriaLabel`, `titleAcknowledged`, `onToggle`, `onAcknowledge`, `popoverOpen`, `popoverContent`. Add to vehicle editor alongside the existing `EditorHomeButton`.

---

## ITEM 2 — Visibility control + default = "Unlisted"

### Visibility enum

Both `PublishSection.tsx:85` and `PublishToWorkshopDialog.tsx:96` define the same constant:

```ts
const VISIBILITY_OPTIONS: { value: 0 | 1 | 2 | 3; label: string }[] = [
  { value: 3, label: 'Unlisted' },    // k_ERemoteStoragePublishedFileVisibilityUnlisted
  { value: 2, label: 'Private' },     // k_ERemoteStoragePublishedFileVisibilityPrivate
  { value: 1, label: 'Friends only' },// k_ERemoteStoragePublishedFileVisibilityFriendsOnly
  { value: 0, label: 'Public' },      // k_ERemoteStoragePublishedFileVisibilityPublic
]
```

Valve SDK maps: Public=0, FriendsOnly=1, Private=2, Unlisted=3.

### Current defaults

| Editor | Component | Default | Exact location |
|--------|-----------|---------|---------------|
| Decal / Faceplate | `PublishSection.tsx` | Unlisted (index 0 → value 3) | `PublishSection.tsx:259` `useState<number>(0)` |
| Skin (vehicle) | `PublishToWorkshopDialog.tsx` | Unlisted (index 0 → value 3) | `PublishToWorkshopDialog.tsx:119` `useState<number>(0)` |

**All three already default to Unlisted.** No change required.

### Visibility storage in project model

Visibility is **ephemeral form state** — not persisted. It resets to index 0 (Unlisted) each time the publish UI opens. The only publish-related field persisted per-project is `workshopId?: string`:
- `src/lib/project.ts:162` (skin)
- `src/lib/faceplate-project.ts:458` (faceplate)
- `src/lib/decal-pack-project.ts:254` (decal)

### How visibility threads to the publish call

`PublishSection.handlePublish` (`PublishSection.tsx:283`) receives `clickedVisibility: 0|1|2|3` and passes it as `visibility: clickedVisibility` in `PublishWorkshopInput` (`PublishSection.tsx:347`). The Electron bridge call: `window.electronAPI!.steam.workshop.publish(input)` or `.update(workshopId, input)` (`PublishSection.tsx:353–362`).

### Click interaction (current)

`<GlassSegmented>` chip row — 4 options. **Single click = build (if needed) + publish at that visibility.** No hover menu. The currently previewed option shows a description via `AnimatedSwap` footer (`PublishSection.tsx:479–484`). Clicking any option immediately triggers `handlePublish(value, index)`.

---

## ITEM 3 — Auto-update existing Workshop listing on edit

### live-sync.ts

Singleton `LiveSyncManager`. `scheduleLiveSync(kind, project)` is called after every mutation in each editor. Debounced 1500 ms. `_build()` (`live-sync.ts:435`) builds SGA bytes for all three project types. `_writeFile()` (`live-sync.ts:555`) writes:
- Skin: `mods/skins/<stableNumericId>.sga`
- Decal: `mods/decals/subscriptions/<guid>.sga`
- Faceplate: `mods/faceplates/subscriptions/<guid>.sga`

**Live Sync does NOT call Workshop at any point.** It is local-only.

### LiveSyncBadge.tsx

`src/components/LiveSyncBadge.tsx:111`. Single icon button showing `StateIcon(state)`. Click routes to: `connectInstall()` if missing mods handle, `toggle()` if disabled, open inventory-icon popover if `iconPicker` prop supplied, else `toggle()`. The popover (`LiveSyncBadge.tsx:244`) shows status reason + inventory-icon picker (faceplate only).

### workshopId storage and publish/update decision

`workshopId` is set on first successful publish via `target.onPublished(workshopId)` callback:
- Decal: `DecalPackEditor.tsx` ~ line 1380 → `mutate(p => ({ ...p, workshopId }), { undoable: false })`
- Faceplate: `FaceplateEditor.tsx` ~ line 1722 → same pattern
- Skin: `TopBar.tsx:2314–2317` → `p.setProject({ ...p.project, workshopId }); persistActive(next)`

`isRealWorkshopId(workshopId)` (`PublishSection.tsx:72`, `PublishToWorkshopDialog.tsx:84`): `n > 0 && n <= 5_000_000_000`. This guard controls whether `.update()` or `.publish()` is called. **The update path is fully wired and functional.**

### steamworks.js API surface

From usage in `PublishSection.tsx:353` and `PublishToWorkshopDialog.tsx:212`:

```ts
window.electronAPI!.steam.workshop.publish(input: PublishWorkshopInput): Promise<PublishWorkshopResult>
window.electronAPI!.steam.workshop.update(workshopId: string, input: PublishWorkshopInput): Promise<UpdateWorkshopResult>

interface PublishWorkshopInput {
  contentPath: string; previewPath: string; title: string; description: string
  tags: string[]; visibility: 0|1|2|3; changeNote?: string
}
```

### What needs to change for auto-update

The infrastructure is complete. The gap: no automatic Workshop update when a published item is edited. To implement:
1. In `_runSync()` (`live-sync.ts:317`), after `_writeFile()` succeeds, check if `project.workshopId` is a real Workshop ID.
2. Call `window.electronAPI!.steam.workshop.update(workshopId, {...})`.
3. **Blocker**: Live Sync singleton has no access to the preview canvas (only available in React). Solution: either (a) pass previewCanvas into `scheduleLiveSync` from the editor, or (b) keep Workshop update as a manual action but pre-fill it with the already-synced SGA rather than re-building. Option (b) is lower risk and requires no singleton changes.

---

## ITEM 4 — Export pixel-match

### Editor preview path

Canvas: `overlayCanvasRef` — 2048×2048 `HTMLCanvasElement`, created once in `Editor.tsx:459–463`.

`repaint()` (`Editor.tsx:704–738`):
```ts
ctx.clearRect(0, 0, 2048, 2048)
if (baseDiffuseRef.current) ctx.drawImage(baseDiffuseRef.current, 0, 0, 2048, 2048)
paintDecals(renderCtx, veh.decals, activeDecalId)  // src/lib/decal-painter.ts
// hover ghost at globalAlpha=0.55
```

`baseDiffuseRef`: 2048×2048 canvas holding vanilla diffuse or custom AI diffuse + camo. Populated via `onModelLoaded` from Viewport.

`paintDecals` (`decal-painter.ts:45`): `ctx.translate(d.x, d.y); ctx.rotate(d.rot * Math.PI/180); drawByType(rc, d)`. Image decals use module-level `imageCache: Map<string, HTMLImageElement>` — returns `null` if image not yet decoded.

Viewport creates `CanvasTexture(overlayCanvas)` with `flipY=true` (`Viewport.tsx:2981`) — this only affects GPU sampling, not Canvas2D pixel data.

### Export path

`composeVehicleDiffuse()` — `src/lib/mod-export.ts:173–252`:
```ts
const out = document.createElement('canvas'); out.width = out.height = 2048
// 1. Base: customDiffuseUrl (data URL) OR decodeRgt → bcToCanvas (same as editor)
ctx.drawImage(baseCanvas, 0, 0, 2048, 2048)
// 2. Decals — SAME paintDecals from decal-painter.ts (mod-export.ts:39,244)
paintDecals(renderCtx, veh.decals, null)  // activeId=null (no highlight ring)
```

RGT encoding (`rgt-writer.ts:42`): BC1 (DXT1, format 13), `encodeBc1`. `compress:true` by default (zlib). Top mip only + empty placeholder entries for smaller mips.

### patch-signed-pack.mts

Writes **real composited content** (vanilla diffuse decoded from CoH2 archives), NOT placeholders. But: no user decals are composited (comment at `patch-signed-pack.mts:317`: "vanilla only — content doesn't matter for load test"). Uses **BC3 (DXT5, format 15)** via local `canvasToRgtBc3()`, NOT `canvasToRgt` from rgt-writer.ts, because the pre-signed template slots are 4 MB (BC3) and `canvasToRgt` produces 2 MB (BC1). This mismatch is documented at `patch-signed-pack.mts:51–55`.

### Divergence analysis

| Aspect | Editor preview | Export | Mismatch? |
|--------|---------------|--------|-----------|
| Canvas size | 2048×2048 | 2048×2048 | None |
| Base decode path | `bcToCanvas` → `baseDiffuseRef` | `bcToCanvas` → draw to canvas | None |
| Decal painter | `decal-painter.ts paintDecals` | Same function, same import | None |
| Decal transforms | `translate(x,y) rotate(rot°)` | Identical | None |
| Active highlight ring | Painted (cosmetic) | Not painted (`null` passed) | Visual only, not exported |
| Hover ghost | Painted at 0.55 alpha | Not painted | Correct |
| **Image decal async race** | Retries via `onReady` callback → `repaint()` | No retry — if `imageCache` miss at export time, image decal drawn as placeholder rect | **REAL MISMATCH** |
| flipY | GPU texture only (Viewport) | Not applied in rgt-writer | None (both top-down Canvas2D) |
| BC format | N/A (Canvas2D) | BC1 (rgt-writer) vs BC3 (patch-signed-pack) | Irrelevant to pixel content |

### The image-decode race

`decal-painter.ts getCachedImage()` returns `null` and draws a placeholder rectangle if the image hasn't finished decoding. In the editor, `onReady` fires `repaint()` after decode completes. In `composeVehicleDiffuse()` there is no such retry — `paintDecals` is called once immediately after setting up the canvas. If the image was never previously loaded in the same process session, the export will silently omit it.

**Fix**: in `composeVehicleDiffuse`, before calling `paintDecals`, pre-load all `type:'image'` decals using `createImageBitmap` or `Image.decode()` with explicit `await`, similar to `live-sync.ts renderDecalIcon` (`live-sync.ts:858–876`). This ensures `imageCache` is populated before `paintDecals` is called.

### Shared compose function status

**No shared function exists.** Two independent implementations both call `decal-painter.ts paintDecals`. Extracting a shared async `composeVehicleDiffuseCanvas(base, decals, renderCtx)` is optional — the only required fix is the image-decode race in `composeVehicleDiffuse`. Call sites of `composeVehicleDiffuse` if extracted: `mod-export.ts:405` (`exportSkinPack`), `mod-export.ts:503` (`patchExport`), `live-sync.ts` via `exportSkinPack`. `patch-signed-pack.mts` is vanilla-only and would not need updating.
