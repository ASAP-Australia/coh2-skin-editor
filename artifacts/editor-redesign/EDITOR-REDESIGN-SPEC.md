# EDITOR-REDESIGN-SPEC — lab01 reskin of the three editors

**Self-contained implementation brief. You do NOT need to reopen the groundwork docs
(`lab01-design-language.md`, `current-chrome-inventory.md`) — every fact, value, and
file:line you need is inlined here.** Repo: `/var/home/jflessenkemper/dev/coh2-skin-editor`.
Stack: React 19 + TS 6 + **Tailwind v4** (CSS `@theme` in `src/index.css`, **NO `tailwind.config.*`**)
+ Three.js + Electron/Vite. Fonts already Geist (variable).

---

## 0. HARD CONSTRAINTS (read first, they gate every edit)

1. **RESKIN ONLY — zero behavior change.** Every event handler, `aria-label`, `title`,
   `data-testid`, keyboard shortcut, `role`, and DOM structure that a test queries **stays byte-identical**.
   You change *colors, gradients, shadows, blur values, border recipes, fonts, radii* — never structure,
   never props that carry behavior.
2. **Keep these NAMES (change only their VALUES/looks), or update the pinned test in lockstep with justification in §4:**
   - CSS `@utility` names: `glass-1 glass-2 glass-3 glass-hud glass-pill glass-pop glass-frame glass-frame-inner`.
   - `@theme` token names: `--color-glass-1..4`, `--color-stroke-1..3`, `--color-text-1..3`, `--color-accent*`, `--color-app-bg*`, all `--radius-*`, `--shadow-*`.
   - The active-pill marker class **`bg-white/95`** (used by VehicleMenu/ScenePanel/FactionPanel/AtlasViewPanel active state — 2 are test-pinned).
   - Toast kind-classes **`bg-black/60` (info), `bg-emerald-600/30` (success), `bg-red-700/40` (error)** and their `text-white / text-emerald-100 / text-red-100`.
3. **OFF-LIMITS — do not touch** (already redesigned; this IS the reference aesthetic):
   `src/components/StartScreen.tsx`, `src/components/StartScreenCard.tsx`, `src/components/AuthShell.tsx`,
   `src/components/WindowControls.tsx`, and the `glass-frame` / `glass-frame-inner` utilities. Also do not
   restyle the shadcn `src/components/ui/**` primitives (they read `:root`/`.dark`/`@theme inline` shadcn vars,
   NOT the glass tokens) beyond what the shared token changes cascade automatically.
4. **PERF — this chrome floats over a LIVE Three.js viewport.** Every `backdrop-filter: blur()` over the
   viewport re-samples the GPU framebuffer each frame. **Keep blur ≤ 40px on `glass-hud / glass-pill / glass-pop`
   and on every inline `backdropFilter` literal that sits over the viewport.** Prefer the cheap approximations
   (baked radial-gradient glows instead of `blur(150px)` blooms; a pre-rendered noise PNG instead of live
   `feTurbulence`; ≤2-stop shadows instead of 5–6). Never add a live `backdrop-filter` blur where the current
   code has none. The `glass-1..4` (menus/dialogs over dimmed content) are NOT viewport-critical — heavier blur is fine there.

---

## 1. DESIGN DIRECTION (the lab01 language → a pro editing tool)

lab01.dev's signature (extracted from Sebastiano Guerriero's experiments 01/02/05/07/10/11 + site chrome) is:
**near-black *layered* surfaces** (`#111 → #1F1F1F → #303030`), a **1px "border-light" ring** on every raised
element (a `mask-composite: exclude` hairline that's bright top-left and fades away), **radial top-highlight
buttons** (`radial-gradient(ellipse at -20px top, white-alpha, transparent)` + `background-blend-mode: overlay`),
**Geist Mono** for all labels/numbers/hotkeys with `slashed-zero`, **Geist** sans with tight `-0.025em` tracking
for headings, **one saturated accent per screen used sparingly**, deep warm multi-stop shadows, corner white
blooms + faint film grain on large static panels, and press-down `translate:0 1px` micro-interactions.

**How that maps onto these three editors:**

- **Surfaces recede, viewport is hero.** Editors sit over the 3D scene, so we go **darker and more opaque**
  than the current cool-blue-tinted glass. Current glass base is `rgb(15 17 22)` / `rgb(20 22 28)` (cool,
  bluish). New base is **neutral near-black `rgb(17 17 17)` = `#111111`** (the lab01 `--l01-bg`), raised
  controls `#1F1F1F`, hover/pressed `#303030`. This kills the blue cast and reads as a serious tool.
- **The masked border-light ring is the through-line.** We add a single reusable CSS class `.l01-ring`
  (a `::after` masked hairline) and adopt it on raised chrome (pills, docks, popovers, buttons). It's
  **static and nearly free** — keep it everywhere. This is the #1 authenticity signal.
- **Radial top-highlight** goes on the raised control surfaces (buttons, active pills, tool segments).
- **Geist Mono is the UI text for metadata/values/hotkeys.** Section headings, slider value readouts,
  hex inputs, transform number inputs, hotkey chips, faction/vehicle labels → mono with `font-variant-numeric: slashed-zero`.
  Geist sans (already loaded) stays for prose/titles with `-0.025em` tracking.
- **Corner blooms + grain ONLY on large static panels** (LayersPanel, PropertiesPanel, AdjustmentPanel,
  GlassModal) — never on chrome over the live viewport, and always as **baked CSS gradients / a PNG grain
  tile**, never live `blur(150px)` or `feTurbulence`.

### THE ACCENT DECISION (pinned — implement exactly this)

The house gold is **`#BA965A`**. There are currently **two** accent roles in the editors:
- **Brigade orange** `--color-accent` (`oklch(0.66 0.180 45)`) — "we did the thing you asked" (brush ON,
  accept, callout, the `.bg-orange-400` dirty-dot).
- **Blue** `EDITOR_ACCENT = rgba(120,180,255,0.95)` — "this is the thing you picked" (selection: CanvasHandles,
  active LayerRow, slider thumbs, ToggleChip on-state).

**Decision: gold `#BA965A` becomes the single SELECTION/FOCUS accent in the editors, replacing the blue
`EDITOR_ACCENT` family. Orange `--color-accent` STAYS as the action/dirty accent (do not touch it).**

Rationale:
- lab01's canonical "gold theme" (exp 01) uses `#BA965A` exactly as the *selected/primary* surface color —
  so gold-as-selection is faithful to the source.
- The blue was *deliberately* chosen to not collide with brand orange; gold likewise doesn't collide with
  orange (warm-vs-warm but clearly distinct in hue/chroma), so the two-accent semantic split survives.
- Selection/focus is the accent the user sees constantly while editing → it should be the house color.
  Orange stays reserved for the rarer "action committed" moments, so gold is used *sparingly enough* to
  stay special. **Do NOT globally replace orange with gold** — they coexist, gold=picked, orange=did.
- `CanvasHandles` on-canvas fill must move to gold too (it's the visual anchor the active LayerRow "rhymes"
  with per `tokens.ts` comment). Keep them equal.

Concretely: `EDITOR_ACCENT` → gold, and its `_FILL / _BORDER / _FILL_STRONG` derivatives → gold-alpha
(exact values in Phase 1). Focus rings on editor controls → gold. The `bg-white/95` active-pill marker
(VehicleMenu/ScenePanel/FactionPanel) is a **separate** high-contrast "primary selected" treatment and
**stays white** (test-pinned) — do not gold it.

---

## 2. PHASE 1 — tokens + shared primitives (ONE implementer, lands + verifies FIRST)

Phase 1 is a single commit-able unit. It restyles `src/index.css`, `editor-primitives/tokens.ts`, the two
docked panels, and every shared primitive. Phase 2 depends on it, so **Phase 1 must land, typecheck, test,
and build GREEN before any Phase 2 work starts.**

### 2.0 — Add the Geist Mono font dependency (REQUIRED — it is NOT currently installed)

`package.json` has `@fontsource-variable/geist` but **not** `geist-mono`, and `index.css` has **zero**
`Geist Mono` references. Add it:

```bash
npm install @fontsource-variable/geist-mono
```

Then in `src/index.css`, directly after line 4 (`@import "@fontsource-variable/geist";`) add:

```css
@import "@fontsource-variable/geist-mono";
```

And add a mono font token inside the `@theme { … }` block (after the existing font mapping / near the color
block — Tailwind v4 exposes `--font-mono`). Add this line inside `@theme`:

```css
  --font-mono: 'Geist Mono Variable', ui-monospace, 'SF Mono', Menlo, monospace;
```

(There is already a `--font-sans: 'Geist Variable', …` mapping in the `@theme inline` block around line 317 —
leave it; just add `--font-mono` so `font-mono` / `var(--font-mono)` resolve to Geist Mono.)

### 2.1 — `@theme` token value changes in `src/index.css` (lines 29–68)

Replace the VALUES below; **keep every token NAME.** Verbatim before → after:

```css
/* --- surfaces: neutralize the cool-blue tint → lab01 neutral near-black --- */
/* BEFORE line 31 */  --color-app-bg:        oklch(0.155 0.015 260);
/* AFTER  */          --color-app-bg:        oklch(0.155 0 0);          /* #111-family, neutral */
/* BEFORE line 32 */  --color-app-bg-deep:   oklch(0.115 0.013 260);
/* AFTER  */          --color-app-bg-deep:   oklch(0.115 0 0);          /* deeper neutral */

/* --- glass white-tints: keep names/alphas; they layer over the new neutral base --- */
/* (leave --color-glass-1..4 alphas as-is: 0.04 / 0.07 / 0.10 / 0.14 — they still read correctly) */

/* --- strokes: keep --- (rgb 255 255 255 / .06 / .10 / .18) */

/* --- text: neutralize the cool tint → pure grayscale whites --- */
/* BEFORE line 46 */  --color-text-1: oklch(0.97 0.005 260);
/* AFTER  */          --color-text-1: oklch(0.97 0 0);
/* BEFORE line 47 */  --color-text-2: oklch(0.78 0.010 260);
/* AFTER  */          --color-text-2: oklch(0.78 0 0);
/* BEFORE line 48 */  --color-text-3: oklch(0.60 0.015 260);
/* AFTER  */          --color-text-3: oklch(0.60 0 0);

/* --- accent: KEEP orange (--color-accent) exactly — it is the ACTION accent. --- */
/* Do NOT change lines 51-53. */

/* --- radii: adopt lab01's 24/12/8 rhythm (keep names) --- */
/* BEFORE line 60 */  --radius-card:   18px;
/* AFTER  */          --radius-card:   16px;    /* panels/cards read tighter, pro */
/* BEFORE line 61 */  --radius-panel:  22px;
/* AFTER  */          --radius-panel:  20px;
/* line 62 */         --radius-pill:   9999px;  /* keep */
/* BEFORE line 63 */  --radius-input:  10px;
/* AFTER  */          --radius-input:  12px;    /* lab01 control radius */

/* --- shadows: warm the ambient stack slightly + keep the inset top-edge --- */
/* BEFORE line 66 */  --shadow-glass: 0 8px 32px rgb(0 0 0 / 0.40), 0 1px 0 rgb(255 255 255 / 0.04) inset;
/* AFTER  */          --shadow-glass: 0 1px 1px rgb(0 0 0 / 0.25), 0 12px 28px rgb(0 0 0 / 0.42), 0 1px 0 rgb(255 255 255 / 0.05) inset;
/* BEFORE line 67 */  --shadow-pop:   0 24px 64px rgb(0 0 0 / 0.55), 0 1px 0 rgb(255 255 255 / 0.06) inset;
/* AFTER  */          --shadow-pop:   0 2px 4px rgb(0 0 0 / 0.30), 0 20px 48px rgb(0 0 0 / 0.52), 0 1px 0 rgb(255 255 255 / 0.07) inset;
```

Add a **house-gold accent token** to `@theme` (new name, additive — does not rename anything). Put it just
after the `--color-accent-strong` line (line 53):

```css
  /* House gold — the editor SELECTION / focus accent (lab01 #BA965A). */
  --color-editor-accent:        #BA965A;
  --color-editor-accent-fill:   rgb(186 150 90 / 0.14);
  --color-editor-accent-border: rgb(186 150 90 / 0.42);
  /* rgb triple for warm ambient shadow stacks on gold buttons */
  --l01-warm-shadow: 136 97 46;
```

### 2.2 — `@utility glass-*` recipe rewrites in `src/index.css`

**Neutralize the base tint (cool `15 17 22` / `20 22 28` → neutral `17 17 17` / `24 24 24`), keep blur ≤40px
on the viewport-critical trio, keep every hairline ≤1px and the inset top-edge highlight.** Verbatim recipes
to paste (replacing lines 87–145). **Keep the utility names.**

```css
@utility glass-1 {
  background-color: rgb(17 17 17 / 0.66);
  background-image: linear-gradient(180deg, rgb(255 255 255 / 0.045), rgb(255 255 255 / 0.02));
  backdrop-filter: blur(32px) saturate(120%);
  -webkit-backdrop-filter: blur(32px) saturate(120%);
  border: 0.5px solid var(--color-stroke-1);
  box-shadow: inset 0 0.5px 0 rgb(255 255 255 / 0.05);
}
@utility glass-2 {
  background-color: rgb(17 17 17 / 0.74);
  background-image: linear-gradient(180deg, rgb(255 255 255 / 0.06), rgb(255 255 255 / 0.03));
  backdrop-filter: blur(36px) saturate(125%);
  -webkit-backdrop-filter: blur(36px) saturate(125%);
  border: 0.5px solid var(--color-stroke-2);
  box-shadow: inset 0 0.5px 0 rgb(255 255 255 / 0.06);
}
@utility glass-3 {
  background-color: rgb(17 17 17 / 0.82);
  background-image: linear-gradient(180deg, rgb(255 255 255 / 0.08), rgb(255 255 255 / 0.04));
  backdrop-filter: blur(40px) saturate(130%);
  -webkit-backdrop-filter: blur(40px) saturate(130%);
  border: 0.5px solid var(--color-stroke-3);
  box-shadow: inset 0 0.5px 0 rgb(255 255 255 / 0.08);
}

/* HUD trio — over the LIVE viewport. Neutral base, blur ≤ 40px, tightened 2-stop float shadow. */
@utility glass-hud {
  background-color: rgb(20 20 20 / 0.68);
  backdrop-filter: blur(36px) saturate(125%);
  -webkit-backdrop-filter: blur(36px) saturate(125%);
  border: 0.5px solid rgb(255 255 255 / 0.10);
  box-shadow: 0 1px 1px rgb(0 0 0 / 0.30), 0 12px 30px rgb(0 0 0 / 0.46), inset 0 0.5px 0 rgb(255 255 255 / 0.10);
}
@utility glass-pill {
  background-color: rgb(20 20 20 / 0.68);
  backdrop-filter: blur(36px) saturate(125%);
  -webkit-backdrop-filter: blur(36px) saturate(125%);
  border: 0.5px solid rgb(255 255 255 / 0.10);
  box-shadow: 0 1px 1px rgb(0 0 0 / 0.28), 0 8px 20px rgb(0 0 0 / 0.44), inset 0 0.5px 0 rgb(255 255 255 / 0.10);
}
@utility glass-pop {
  background-color: rgb(22 22 22 / 0.78);
  backdrop-filter: blur(40px) saturate(130%);
  -webkit-backdrop-filter: blur(40px) saturate(130%);
  border: 0.5px solid rgb(255 255 255 / 0.10);
  box-shadow: 0 2px 4px rgb(0 0 0 / 0.34), 0 16px 38px rgb(0 0 0 / 0.5), inset 0 0.5px 0 rgb(255 255 255 / 0.08);
}
```

**Do NOT touch `glass-frame` / `glass-frame-inner` (lines 175–207) — window chrome, OFF-LIMITS.**

### 2.3 — The reusable masked border-light ring (add ONE new utility to `src/index.css`)

This is the lab01 signature. Add it near the glass utilities (e.g. right after the `glass-pop` block). It's a
`::after`-based utility so callers add it as a className on a `position: relative` element with a matching
`border-radius`. **Static, cheap — safe over the viewport.**

```css
/* lab01 border-light ring — a 1px hairline that's bright top-left and fades
 * around the edge. Put on any raised chrome (pills, docks, popovers, buttons).
 * Element MUST be position:relative and carry its own border-radius. */
@utility l01-ring {
  position: relative;
}
@utility l01-ring-after {
  /* apply on the element; paints the ring via ::after */
}
```

Because Tailwind v4 `@utility` cannot emit a bare `::after` with content from a single class cleanly in all
cases, ship the ring as a **plain CSS class** in the same file instead (add after the glass utilities, OUTSIDE
any `@utility`):

```css
/* Reusable masked border-light ring (lab01 signature). Add class `l01-ring`
 * to any position:relative raised element; it inherits border-radius. */
.l01-ring::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  border: 1px solid transparent;
  background: linear-gradient(
      160deg,
      rgb(255 255 255 / 0.30),
      rgb(255 255 255 / 0.02) 37%,
      rgb(255 255 255 / 0.05) 70%,
      rgb(255 255 255 / 0.10)
    ) border-box;
  -webkit-mask: linear-gradient(#000, #000) padding-box, linear-gradient(#000, #000);
          mask: linear-gradient(#000, #000) padding-box, linear-gradient(#000, #000);
  -webkit-mask-composite: xor;
          mask-composite: exclude;
}
@media (prefers-reduced-motion: reduce) { /* ring is static; no motion to disable */ }
```

Also add a **baked corner-glow + grain helper** as plain CSS classes (for large STATIC panels only — never
over the viewport). These are cheap (no runtime blur/turbulence):

```css
/* Baked corner bloom — replaces lab01's blur(150px) white blooms. STATIC panels only. */
.l01-bloom {
  background-image:
    radial-gradient(circle at 8% -6%, rgb(255 255 255 / 0.06), transparent 42%),
    radial-gradient(circle at 108% 112%, rgb(186 150 90 / 0.05), transparent 46%);
}
/* Film grain — pre-baked 64px tile, mix-blend overlay, very low opacity. STATIC panels only.
 * Implementer: generate a 64×64 monochrome noise PNG, base64 it into url(...) below, OR use the
 * SVG-noise data-URI shown here (rendered ONCE to a static image by the browser, not re-run per frame). */
.l01-grain::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  opacity: 0.05;
  mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><filter id='n'><feTurbulence baseFrequency='0.8'/></filter><rect width='64' height='64' filter='url(%23n)' opacity='0.5'/></svg>");
  background-size: 64px 64px;
}
```

> Note on grain: the data-URI SVG above renders the turbulence **once** into a static image the browser tiles —
> it does NOT re-run `feTurbulence` per frame (unlike an inline `<filter>` applied via `filter:`). It is safe on
> static panels. Still keep it OFF surfaces over the live viewport.

### 2.4 — `editor-primitives/tokens.ts` runtime-mirror rewrites (verbatim TS)

These are inline-`style` mirrors (they cannot reference `@utility` classes), so they must move in lockstep with
§2.1/§2.2. **Gold replaces the blue selection accent; text neutralizes; button surfaces gain the radial
top-highlight.** Keep every export NAME.

```ts
// ── Color atoms ──────────────────────────────────────────────────────────
// SELECTION / FOCUS accent is now house gold #BA965A (was blue). Matches CanvasHandles fill.
export const EDITOR_ACCENT = 'rgba(186,150,90,0.95)'
export const EDITOR_ACCENT_FILL = 'rgba(186,150,90,0.14)'
export const EDITOR_ACCENT_BORDER = 'rgba(186,150,90,0.42)'
export const EDITOR_ACCENT_FILL_STRONG = 'rgba(186,150,90,0.22)'

// Text — neutral grayscale whites (was faintly warm 247,247,250; go pure 245s to match neutral base).
export const EDITOR_TEXT_1 = 'rgba(245,245,245,0.92)'
export const EDITOR_TEXT_2 = 'rgba(245,245,245,0.70)'
export const EDITOR_TEXT_3 = 'rgba(245,245,245,0.50)'
export const EDITOR_TEXT_4 = 'rgba(245,245,245,0.35)'

export const EDITOR_STROKE_1 = 'rgba(255,255,255,0.06)'
```

Restyle the three button style objects to the **lab01 raised recipe** (radial top-highlight + neutral surface +
inner top hairline). Replace verbatim:

```ts
export const topbarButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px',
  background: 'radial-gradient(ellipse at -20px top, rgba(255,255,255,0.10), rgba(255,255,255,0) 60%), #1F1F1F',
  border: '0.5px solid rgba(255,255,255,0.10)',
  borderRadius: 12,
  color: EDITOR_TEXT_1,
  fontFamily: "'Geist Mono Variable', ui-monospace, monospace",
  fontSize: 12,
  fontWeight: 500,
  fontVariantNumeric: 'slashed-zero',
  boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.06), 0 1px 2px rgba(0,0,0,0.3)',
  cursor: 'pointer',
}

export const panelButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '6px 8px',
  background: 'radial-gradient(ellipse at -12px top, rgba(255,255,255,0.08), rgba(255,255,255,0) 60%), #1F1F1F',
  border: '0.5px solid rgba(255,255,255,0.08)',
  borderRadius: 8,
  color: EDITOR_TEXT_1,
  fontFamily: "'Geist Mono Variable', ui-monospace, monospace",
  fontSize: 11,
  fontWeight: 500,
  fontVariantNumeric: 'slashed-zero',
  boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.05)',
  cursor: 'pointer',
}

export const panelButtonLargeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '8px 12px',
  background: 'radial-gradient(ellipse at -16px top, rgba(255,255,255,0.09), rgba(255,255,255,0) 60%), #1F1F1F',
  border: '0.5px solid rgba(255,255,255,0.08)',
  borderRadius: 12,
  color: EDITOR_TEXT_1,
  fontFamily: "'Geist Mono Variable', ui-monospace, monospace",
  fontSize: 12,
  fontWeight: 500,
  fontVariantNumeric: 'slashed-zero',
  boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.05), 0 1px 2px rgba(0,0,0,0.25)',
  cursor: 'pointer',
}

export const sectionHeadingStyle: CSSProperties = {
  margin: 0,
  fontFamily: "'Geist Mono Variable', ui-monospace, monospace",
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: 1.5,
  textTransform: 'uppercase',
  fontVariantNumeric: 'slashed-zero',
  color: EDITOR_TEXT_3,
}
```

> The button objects don't get the masked ring (a `style` object can't emit `::after`). If a primitive wants
> the ring, add the `l01-ring` **className** to its root element (root must be `position:relative` with a
> `borderRadius`). Note per-primitive below where to add it.

### 2.5 — Per-primitive restyle notes (EVERY component in the inventory)

Files under `src/components/editor-primitives/**` and `src/components/editor-shared/**`. Unless stated, the
change is: **(a) any hardcoded blue `rgba(120,180,255,…)` → the gold token; (b) any cool glass base
`rgba(15,17,22,…)` / `rgba(20,22,28,…)` → neutral `rgba(17,17,17,…)` / `rgba(20,20,20,…)` keeping the same
alpha; (c) label/value/heading text → `fontFamily: var(--font-mono)` (Geist Mono) with
`fontVariantNumeric:'slashed-zero'`; (d) add `l01-ring` className to the raised root where noted.** Most
primitives already consume the tokens in §2.4, so they update automatically — the notes below are the deltas.

| Primitive | File | Restyle notes |
|---|---|---|
| **EditorTitlePill** | `editor-primitives/EditorTitlePill.tsx` | Pill root: neutralize any inline `rgba(15,17,22/20,22,28…)` base → `rgba(20,20,20,…)`; add `l01-ring` className to the pill root (it's `position:relative`). Pack-name text → Geist Mono. Keep BorderBeam behavior. |
| **BottomToolPill** | `editor-primitives/BottomToolPill.tsx` | Uses `glass-hud` className → surface updates for free. Active segment: swap blue tint for gold (`EDITOR_ACCENT_FILL_STRONG`); add `l01-ring` to the active segment. 56×56 segment geometry + captions UNCHANGED. Caption text → Geist Mono 10px. |
| **UndoRedoBar** | `editor-primitives/UndoRedoBar.tsx` | Two `glass-pill` chips → free. Add `l01-ring` to each 36×36 chip root. No behavior change. |
| **ToolOptionsPeel** | `editor-primitives/ToolOptionsPeel.tsx` | Inline surface at `:71-76` is `rgba(20,22,28,0.72)` blur32 → change base to `rgba(20,20,20,0.74)`, keep blur32 (over static work canvas anyway). Add `l01-ring`. Radius 14 → keep. |
| **PanelButton** | `editor-primitives/PanelButton.tsx` | Consumes `panelButtonStyle` + `EDITOR_ACCENT_FILL_STRONG` (active) → updates for free (active becomes gold). No structural change; keep the `active` prop wiring at `:66`. |
| **PanelHeading** | `editor-primitives/PanelHeading.tsx` | Consumes `sectionHeadingStyle` → Geist-Mono heading for free. |
| **IconButton** | `editor-primitives/IconButton.tsx` | 22×22 transparent — only change hover/active tint from blue→gold if it references `EDITOR_ACCENT*`; otherwise no-op. Keep geometry + aria. |
| **ToggleChip** | `editor-primitives/ToggleChip.tsx` | Wraps PanelButton; on-state uses gold via the token now. No structural change. |
| **SliderRow** | `editor-primitives/SliderRow.tsx` | Imports `EDITOR_ACCENT` (thumb) → gold for free. **Value readout** text → Geist Mono + `slashed-zero` + `tabular-nums`. `accent` prop default stays `EDITOR_ACCENT`; callers passing orange for the brush keep passing orange. |
| **SliderPopover** | `editor-primitives/SliderPopover.tsx` | 28×28 icon button → glass; vertical-slider thumb blue→gold via token. Add `l01-ring` to the popover surface. |
| **LayerRow** | `editor-primitives/LayerRow.tsx` | Active row uses `EDITOR_ACCENT_FILL` + `EDITOR_ACCENT_BORDER` (`:94-95`) → gold for free. Rename input + any index/opacity text → Geist Mono. Thumb geometry UNCHANGED. |
| **AdjustmentPanel** | `editor-primitives/AdjustmentPanel.tsx` | Grouped SliderRows → inherit. Panel is a large static surface → add `l01-bloom` + `l01-grain` classes to its root IF the root is `position:relative` (add `position:relative` only if absent — that's presentational, not behavioral). |
| **TransformPanel** | `editor-primitives/TransformPanel.tsx` | Same as AdjustmentPanel. Number inputs → Geist Mono + `slashed-zero`. |
| **GlassModal** | `editor-primitives/GlassModal.tsx` | Uses `glass-3`/glass surface → free. Add `l01-ring` + (static, over dimmed overlay) `l01-bloom` to the modal card root. Title → Geist heading tracking `-0.025em`; body values → Geist Mono. |
| **GlassToast** | `editor-primitives/GlassToast.tsx` | Editor-scoped toast. **If it uses the same `bg-black/60 | bg-emerald-600/30 | bg-red-700/40` kind-classes as `Toasts.tsx`, DO NOT rename them** (see §4). Text → Geist Mono ok. |
| **EditorHomeButton** | `editor-primitives/EditorHomeButton.tsx` | Inlines a cool glass literal at `:48-59` (`rgba(15,17,22,0.75)` blur40). Neutralize base → `rgba(17,17,17,0.78)`, keep blur40. Add `l01-ring` to the 36×36 root. Home icon + hover behavior UNCHANGED. |
| **ProjectMetaPanel** | `editor-primitives/ProjectMetaPanel.tsx` | Static panel → glass surface free; metadata values → Geist Mono + `slashed-zero`. Add `l01-bloom`/`l01-grain` if root is a large static panel. |
| **BlendModeSelect** | `editor-primitives/BlendModeSelect.tsx` | shadcn-select-derived → inherits shadcn/glass; option labels → Geist Mono if inline-styled. No structural change. |
| **GradientFillEditor** | `editor-primitives/GradientFillEditor.tsx` | Stop handles / numeric stops → gold selection + Geist Mono numbers. Gradient preview logic UNCHANGED. |
| **CurvesEditor** | `editor-primitives/CurvesEditor.tsx` | Curve control-point color blue→gold; axis/value labels → Geist Mono. Curve math + handlers UNCHANGED. |
| **HexColorInput** | `editor-primitives/HexColorInput.tsx` | The hex text field → Geist Mono + `slashed-zero` (this is the canonical "metadata/value" surface). Focus ring → gold. Parsing/validation UNCHANGED. |
| **CanvasPlaceholder** | `editor-primitives/CanvasPlaceholder.tsx` | Empty-state text → Geist Mono; no surface change needed. |
| **LayersPanel** (shared) | `editor-shared/LayersPanel.tsx` | Inlines glass-hud at `:98-104` (`rgba(20,22,28,0.62)` blur36). Change base → `rgba(20,20,20,0.68)`, keep blur36, tighten shadow to match §2.2 glass-hud. Large static panel → add `l01-bloom` + `l01-grain` to root (root already `position` context). Add `l01-ring`. |
| **PropertiesPanel** (shared) | `editor-shared/PropertiesPanel.tsx` | Inlines glass-hud at `:122-128` — identical treatment to LayersPanel. |
| **TransformInputsRow** (shared) | `editor-shared/TransformInputsRow.tsx` | X/Y/W/H/angle number inputs → Geist Mono + `slashed-zero` + `tabular-nums`. Focus ring gold. Inputs' `onChange`/parsing UNCHANGED. |
| **CanvasHandles** (shared) | `editor-shared/CanvasHandles.tsx` | Fill uses `EDITOR_ACCENT` → gold for free (keeps parity with active LayerRow). |
| **ImageDropZone** (shared) | `editor-shared/ImageDropZone.tsx` | Dashed outline uses `EDITOR_ACCENT` → gold for free. No visible-chrome change otherwise. |

---

## 3. PHASE 2 — per-editor adoption (3 PARALLEL implementers, DISJOINT files)

Only start after Phase 1 is green. Each implementer owns exactly one editor's shell file(s) + that editor's
private surface files. **The shared primitives/panels are already done in Phase 1 — do NOT edit them here.**

For every inline literal below: the primitive/utility recipes now carry the new look, so the goal is to
**replace the hand-rolled inline `backdropFilter` literal with either (a) the matching `glass-*` utility
className, or (b) the same neutral values the utility now uses** — so nothing looks "off" against Phase-1 chrome.
Keep blur ≤40px on everything over the viewport.

### Implementer 2A — Skin editor: `Editor.tsx` + `TopBar.tsx` + `VehicleTextureEditor.tsx` (+ its private sub-panels: `VehicleMenu.tsx`, `ScenePanel.tsx`, `FactionPanel.tsx`, `SeasonToggle.tsx`, `EditTextureButton.tsx`)

| Surface | File:line (verbatim current) | Target |
|---|---|---|
| HUD export pill inline literal | `Editor.tsx:2467-2472` — `background:'rgba(20, 22, 28, 0.72)'`, `backdropFilter:'blur(36px) saturate(160%)'`, `border:'0.5px solid rgba(255,255,255,0.18)'`, `boxShadow:'0 8px 22px rgba(0,0,0,0.45), inset 0 0.5px 0 rgba(255,255,255,0.10)'` | Replace inline with the `glass-pill` className (behavior/handlers stay). If className swap is risky, set base→`rgba(20,20,20,0.68)`, blur36 kept, `text` color→`EDITOR_TEXT_1`, add `l01-ring`. |
| Panels-toggle / export / HUD clusters | `Editor.tsx:2307, :2352, :2397` `className="glass-hud …"` | No edit — inherits Phase-1 glass-hud. Verify only. |
| Title pill + rename/publish popover | `TopBar.tsx` renders `EditorTitlePill` (Phase-1 done); popover at `TopBar.tsx:333` `glass-pop` | No edit — inherits. Add Geist-Mono to any hand-styled hotkey/label text in the popover. |
| Vehicle menu pills | `VehicleMenu.tsx:102` `glass-hud`; active pill `bg-white/95 text-black` | Surface inherits. **KEEP `bg-white/95` (test-pinned).** Vehicle displayName text → Geist Mono. `.bg-orange-400` dirty dot UNCHANGED. |
| Scene preset cards | `ScenePanel.tsx:39` `glass-hud`; active `bg-white/95 text-black`; inactive `--color-text-2` | Surface inherits. **KEEP `bg-white/95` + `--color-text-2` (test-pinned).** Preset labels → Geist Mono. |
| Faction switcher | `FactionPanel.tsx:35` `glass-hud`; active `bg-white/95` | Surface inherits. **KEEP `bg-white/95`** (not test-pinned but keep for consistency). Faction labels → Geist Mono. |
| Season toggle | `SeasonToggle.tsx:30` `glass-pill` (segmented) | Inherits. Add `l01-ring` to the active segment if desired. |
| "Edit texture" pill | `EditTextureButton.tsx:59` `glass-pill`; **active/brush-on inline literal** `:62-69` — `background:'rgba(160, 200, 90, 0.85)'`(green), blur36, `border:'0.5px solid rgba(255,255,255,0.30)'` | Base pill inherits glass-pill. The brush-ON state is the **orange/action** semantic — keep it a warm "active" but it currently uses a green literal; leave the green behavior/logic, just neutralize surrounding to match. (If tempted to gold it: DON'T — brush-on is action, not selection.) Keep blur36. |
| Texture editor HUD surfaces | `VehicleTextureEditor.tsx:530-538` (dropdown, `rgba(15,17,22,0.75)` blur40) and `:679-687` (bottom pill, same) | Replace base `rgba(15,17,22,0.75)`→`rgba(17,17,17,0.78)`, keep blur40. Add `l01-ring`. Value text → Geist Mono. |
| Texture editor bottom pill | `VehicleTextureEditor.tsx:776` `glass-pill` (`bottom:24`) | Inherits. |

**2A DO-NOT-TOUCH:** `DecalPackEditor.tsx`, `FaceplateEditor.tsx`, all `editor-primitives/**`, all
`editor-shared/**`, `index.css`, `tokens.ts`, `Toasts.tsx`, anything OFF-LIMITS in §0.3.

### Implementer 2B — `DecalPackEditor.tsx` (+ any decal-private surfaces it inlines)

| Surface | File:line (verbatim current) | Target |
|---|---|---|
| Decal per-decal strip / tool overlay | `DecalPackEditor.tsx:2243-2249` — `background:'rgba(16,18,24,0.72)'`, `backdropFilter:'blur(20px) saturate(160%)'`, `border:'1px solid rgba(255,255,255,0.08)'`, `borderRadius:10` | Base→`rgba(20,20,20,0.72)`, keep blur20 (over static canvas), border→`0.5px solid rgba(255,255,255,0.10)`, add `l01-ring`. |
| Popover/dropdown surface | `DecalPackEditor.tsx:2336-2342` — `rgba(15,17,22,0.75)` + gradient + blur40 | Base→`rgba(17,17,17,0.78)`, keep blur40, add `l01-ring`. This is over static content → could also become `glass-pop` className. |
| Overlay chip | `DecalPackEditor.tsx:2476-2482` — `rgba(16,18,24,0.72)` blur20, `borderRadius:8` | Base→`rgba(20,20,20,0.72)`, keep blur20, `l01-ring`. Text→Geist Mono. |
| Faction-color tag | `DecalPackEditor.tsx:2531-2537` — `backdropFilter:'blur(8px)'`, `color: FACTION_COLORS[…]` | Keep blur8. Label→Geist Mono. **Keep the `FACTION_COLORS[...]` color binding (behavioral/data-driven).** |
| Shared primitives (BottomToolPill, ToolOptionsPeel, PropertiesPanel, AtlasViewPanel, home cluster) | via imports | No edit — Phase-1 done. |

**2B DO-NOT-TOUCH:** `Editor.tsx`, `TopBar.tsx`, `VehicleTextureEditor.tsx`, `FaceplateEditor.tsx`, all
shared primitives/panels, `index.css`, `tokens.ts`, `Toasts.tsx`, OFF-LIMITS files.

### Implementer 2C — `FaceplateEditor.tsx` (+ any faceplate-private popovers it inlines)

| Surface | File:line (verbatim current) | Target |
|---|---|---|
| Faceplate shape/text popover (large) | `FaceplateEditor.tsx:2946-2952` — `rgba(15,17,22,0.75)` + gradient + blur40 | Base→`rgba(17,17,17,0.78)`, keep blur40, add `l01-ring`. Over static canvas → may become `glass-pop` className. |
| Faceplate secondary popover | `FaceplateEditor.tsx:3063-3069` — `rgba(20,22,28,0.88)`, `backdropFilter:'blur(24px) saturate(180%)'`, `border:'0.5px solid rgba(255,255,255,0.10)'`, `borderRadius:12` | Base→`rgba(20,20,20,0.88)`, keep blur24, add `l01-ring`. Text/values→Geist Mono. |
| Toolbar `role="toolbar"` | `FaceplateEditor.tsx:3196` | **Keep `role="toolbar"` and structure (test-relevant).** Surface via BottomToolPill (Phase-1). |
| Shared primitives (LayersPanel, PropertiesPanel, BottomToolPill, ToolOptionsPeel, AtlasViewPanel, EditorTitlePill) | via imports | No edit — Phase-1 done. |
| Fit insets constant `:553` | numeric | Do NOT change (layout behavior). |

**2C DO-NOT-TOUCH:** `Editor.tsx`, `TopBar.tsx`, `VehicleTextureEditor.tsx`, `DecalPackEditor.tsx`, all
shared primitives/panels, `index.css`, `tokens.ts`, `Toasts.tsx`, OFF-LIMITS files.

---

## 4. TEST IMPACT TABLE

Tests use `container.querySelector('.class')` + `className.toContain(...)` (no visual snapshots; no
`getByTitle/Label/Role` on chrome). So **class-name substrings are the only fragile surface** — we keep them.

| Test file:line | Asserts | Decision | Justification |
|---|---|---|---|
| `__tests__/Toasts.test.tsx:113,121,129` | `bg-black/60` (info), `bg-emerald-600/30` (success), `bg-red-700/40` (error) + `text-white/emerald-100/red-100`, `.fixed>div` structure | **KEEP unchanged** | These kind-classes are load-bearing test contracts; the reskin does not need to touch Toasts' Tailwind classes to look coherent. Toast is small and mostly off the viewport. No change → no update. |
| `__tests__/ScenePanel.test.tsx:147-153` | active `bg-white/95` + `text-black`; inactive NOT `bg-white/95` + `--color-text-2` | **KEEP `bg-white/95`, `text-black`, `--color-text-2`** | The white "primary selected" pill is a separate, intentional high-contrast treatment (not the gold selection accent). Preserving it keeps the test green and the visual hierarchy (white = the one active scene). Only the *label font* changes (not asserted). |
| `__tests__/VehicleMenu.test.tsx:243-247,260-262` | active `bg-white/95` + `text-black`; `.bg-orange-400` dirty dot present | **KEEP `bg-white/95`, `text-black`, `.bg-orange-400`** | Same white-active rationale; orange dot is the untouched action/dirty accent. Font-only change to the label (not asserted). |
| `__tests__/TokensPreview.test.tsx:100-108,158-161` | `--color-glass-1/-4`, `--color-app-bg(-deep)`, `--color-stroke-1`, `--color-text-1/-3`, `--color-accent` CSS vars RESOLVE; `.glass-1..4` elements render | **KEEP all token NAMES (values change freely)** | We only change token *values*, never names, and never remove a token. `TokensPreview.tsx` is an orphan (not shipped) but its test still guards the names — all preserved. `.glass-1..4` classes still emitted. GREEN. |
| `__tests__/WindowControls.test.tsx:114-273` | `fixed top-5 right-5 z-[9999]`, `h-10`, `hover:bg-red-500/70`, `hover:bg-white/10` | **KEEP (OFF-LIMITS file)** | WindowControls is not in scope; untouched. |
| `__tests__/AuthShell.test.tsx:310-311`, `OnboardingOverlay.test.tsx:63-65` | `.glass-3` present | **KEEP `glass-3` utility name** | We change glass-3's *values* only; the class still exists. AuthShell OFF-LIMITS; OnboardingOverlay in-scope only insofar as it renders glass-3 (name preserved). GREEN. |
| `CssGradientBackground.test.tsx:89`, `ShaderWaveBackground.test.tsx:92` | `.glass-frame-inner` present | **KEEP (glass-frame-inner OFF-LIMITS, name preserved)** | Not restyled. |

**Net: this spec authorizes ZERO test updates.** Every pinned class name (`glass-*`, `--color-glass-*`,
`bg-white/95`, the toast kind-classes, `.bg-orange-400`) is preserved by design — only values/fonts/added
`l01-ring`/`l01-bloom` classes change, and no test asserts absence of those additive classes. If an implementer
finds they *must* rename a pinned class, STOP and escalate — it means the plan was wrong, not the test.

---

## 5. VERIFICATION PLAN

Run after Phase 1 (gate to Phase 2), and again after all of Phase 2:

```bash
cd /var/home/jflessenkemper/dev/coh2-skin-editor
npx tsc --noEmit                 # typecheck — must be clean
npx vitest run                   # full suite (~2189 tests) — must be all-green
npm run build                    # production build — must succeed (source(none) guard already in index.css)
```

**Gate:** Phase 2 does not begin until the above three are green on the Phase-1 commit.

### Live DOM style-probe checklist (via preview eval, after build)

Start the app preview, open each editor, and assert computed styles. Concretely, for a `glass-hud` element:

```js
// EXPECT: neutral near-black base (not the old cool 20/22/28), blur ≤ 40px
const el = document.querySelector('.glass-hud');
const s = getComputedStyle(el);
s.backgroundColor;   // ~ rgb(20, 20, 20) family with alpha (was rgb(20,22,28))
s.backdropFilter;    // contains 'blur(36px)' — MUST be ≤ 40px
// ring present on a pill:
const pill = document.querySelector('.l01-ring');
getComputedStyle(pill, '::after').maskComposite; // 'exclude' (or webkit 'xor') → ring painting
```

Probe checklist:
- [ ] `getComputedStyle(.glass-hud).backgroundColor` is neutral `rgb(20 20 20 / …)`-family (no blue channel lift).
- [ ] `.glass-hud / .glass-pill / .glass-pop` `backdropFilter` blur radius **≤ 40px** (viewport FPS guard).
- [ ] A raised pill has a `::after` with `mask-composite: exclude` (the `l01-ring`).
- [ ] `--color-editor-accent` resolves to `#BA965A`; an active LayerRow / active BottomToolPill segment shows a gold-alpha fill (`rgba(186,150,90,…)`), NOT blue `rgba(120,180,255,…)`.
- [ ] `--color-accent` still resolves to the orange oklch (unchanged) and the `.bg-orange-400` dirty dot is still orange.
- [ ] A slider value readout / HexColorInput / TransformInputsRow input renders in Geist Mono (`font-family` contains `Geist Mono`) with slashed zeros.
- [ ] `.glass-1..4` still exist; TokensPreview test passes.

### What SHOULD look different, per editor (eyeball QA)
- **Skin editor:** vehicle/scene/faction rails and HUD pills read neutral near-black (not blue-tinted); a
  thin bright top-left hairline (the ring) on pills; the *active* scene/vehicle pill stays crisp white
  (unchanged); labels are Geist Mono.
- **DecalPackEditor:** decal strip / popovers neutral near-black + ring; active decal row fill is gold (was blue).
- **FaceplateEditor:** LayersPanel & PropertiesPanel gain a faint baked corner bloom + grain and the ring;
  active layer / selection handles are gold (was blue); transform/adjustment number inputs are Geist Mono.
- **Everywhere:** section headings + value readouts + hotkeys are mono; buttons have a subtle radial top
  highlight and press down 1px on active (if you also add `:active{translate:0 1px}` — optional, presentational).

---

## 6. SEQUENCING + ROLLBACK

- **Phase 1 is one commit** (`index.css` + `tokens.ts` + `+@fontsource-variable/geist-mono` in package.json/lockfile
  + the shared primitive/panel edits). It MUST land and pass §5's typecheck/test/build before Phase 2.
  Primitives feed all three editors, so Phase 2 against an unmerged Phase 1 would style against stale tokens.
- **Phase 2 is three disjoint commits** (2A skin, 2B decal, 2C faceplate) that can be authored in parallel
  and merged in any order — they touch non-overlapping files (enforced by the per-implementer DO-NOT-TOUCH lists).
- **Rollback:** each phase is an atomic, revertible commit. If Phase 1 regresses a test, revert it and the
  editors return to the current glass look with zero orphaned Phase-2 references (Phase 2 only swaps inline
  literals to equivalent values / utility classes — reverting Phase 1 does not break Phase 2 structurally, but
  the cleanest rollback is to revert in reverse order: 2C/2B/2A then 1).
- Do NOT bundle Phase 1 and Phase 2 into one commit — the gate (Phase 1 green before Phase 2) is the whole
  point of the split.
```

---

## IMPLEMENTED 2026-07-24 — reskin complete

**Phases landed:** 1 (tokens/fonts/primitives), 2A (skin editor), 2B (decal editor), 2C (faceplate editor) — all merged.

**Final scope-gap slice (this pass):** the skin editor's four private sub-panels that were deferred in §2A got their Geist-Mono label treatment:
- `src/components/VehicleMenu.tsx` — vehicle `displayName` text → `font-mono` (both the legacy text pill and the icon-pill name caption). `bg-white/95` active marker + `.bg-orange-400` dirty dot PRESERVED (test-pinned).
- `src/components/ScenePanel.tsx` — preset button → `font-mono`. `bg-white/95` + `--color-text-2` PRESERVED (test-pinned). (Buttons are icon-only; labels surface via `title` — `font-mono` added to the button className for consistency, zero visual/behavior change.)
- `src/components/FactionPanel.tsx` — faction button → `font-mono` (icon-only, same rationale as ScenePanel). `bg-white/95` PRESERVED.
- `src/components/SeasonToggle.tsx` — "Summer"/"Winter" segment labels → `font-mono`.

No numeric label text in these panels, so no `slashed-zero`/`tabular-nums` was needed (those remain reserved for numeric readouts per §2.0). All DOM/aria/behavior/handlers byte-identical. **Files touched: 4.**

**Gates green (merged tree, 2026-07-24):** `npm run typecheck` → exit 0 · `npm test` → 2189/2189 (zero test edits) · `npm run build` → success.
