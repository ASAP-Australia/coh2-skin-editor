# UI Bug Findings

## BUG 1 — "Upgrades" toggle does nothing

### Is `showUpgrades` wired into Viewport?
**Yes.** `Editor.tsx:1323` passes `showUpgrades={showUpgrades}` into `<Viewport>`. `Viewport.tsx:125` declares `showUpgrades?: boolean`, `Viewport.tsx:626-628` syncs it into `showUpgradesRef` on every render.

### Does Viewport USE it?
The rAF loop at `Viewport.tsx:972-982` reads `showUpgradesRef.current` every frame and calls `mesh.visible = next` when an upgrade mesh's visibility differs. The loop always spins (`requestAnimationFrame(tick)` at line 919 is unconditional), so a ref change is picked up within one frame.

### Root cause
The toggle prop wiring and the rAF visibility logic are both correct in structure. The likely failure is that **real RGM submesh names for German upgrade geometry do not match the regex** at `Viewport.tsx:278`:

```ts
const re = /schurzen|skirt|side_armor|sidearmor|zimmerit|applique/i
```

CoH2 RGM files use FOLD/MESH chunk names like `panther_body`, `panther_turret`, etc. The schurzen geometry appears to be part of a merged material chunk rather than a separately named submesh — meaning there is no submesh named `*schurzen*` or `*skirt*` in the parsed mesh list. If all upgrade geometry is baked into the body submesh rather than split out, `isUpgradeMesh()` returns false for every entry in `submeshMapsRef`, so the loop body at line 977 never executes and `needsRenderRef` is never set.

**No code path today forces a re-render when `showUpgrades` flips** unless at least one submesh name matches the regex. There is no `useEffect([showUpgrades])` to trigger a re-render or set `needsRenderRef.current = true` independently.

### Proposed fix

Add a `useEffect` that fires when `showUpgrades` changes and forces a render tick, **and** extend the regex with the patterns that actually appear in CoH2 German vehicle RGMs (inspect via `console.log('[rgm] mesh name:', sub.name)` in `rgm.ts:87` to find real names):

**`Viewport.tsx` — after line 628:**
```ts
// OLD (lines 626-628):
const showUpgradesRef = useRef<boolean>(showUpgrades)
// (showUpgradesRef is updated on each render synchronously below)
showUpgradesRef.current = showUpgrades

// NEW — add a useEffect to force a render when the prop changes:
useEffect(() => {
  needsRenderRef.current = true
}, [showUpgrades])
```

This ensures the rAF loop renders at least one extra frame after the toggle, so the visibility block at lines 972-982 runs with the updated ref value.

Additionally, **expand the regex** at `Viewport.tsx:278` once real submesh names are confirmed. If the schurzen is part of a merged submesh (e.g., `panther_schuerzen` with German umlaut spelling, or `side_skirts` with underscore-s), add those patterns:

```ts
// OLD:
const re = /schurzen|skirt|side_armor|sidearmor|zimmerit|applique/i
// NEW (add common CoH2 spelling variants):
const re = /schurzen|schuerzen|skirt|side_sk|side_armor|sidearmor|zimmerit|applique/i
```

**Verification**: Add temporary logging in `rgm.ts:87` (`console.log('[rgm] submesh:', parentName || node.name)`) and check the browser console after loading a Panther/Tiger to see real part names, then tune the regex accordingly.

---

## BUG 2 — Vehicle selector missing pointer cursor

### Root cause
`VehicleMenu.tsx:180` — the **legacy text-only pill** (rendered when `iconResolver` is not provided) is missing `cursor-pointer`:

```tsx
// VehicleMenu.tsx:180 — CURRENT (no cursor-pointer):
className={`relative px-3 py-1.5 rounded-pill text-[11px] font-medium whitespace-nowrap transition-all duration-150 ${
  isActive
    ? 'bg-white/95 text-black shadow-...'
    : 'text-[var(--color-text-2)] hover:bg-white/10 hover:text-white'
}`}
```

The icon-dominant pill at line 201 already has `cursor-pointer`. The legacy path is missing it.

### Fix — `VehicleMenu.tsx:180`
```tsx
// OLD:
className={`relative px-3 py-1.5 rounded-pill text-[11px] font-medium whitespace-nowrap transition-all duration-150 ${
// NEW:
className={`relative px-3 py-1.5 rounded-pill text-[11px] font-medium whitespace-nowrap transition-all duration-150 cursor-pointer ${
```

One word added to the static class string.
