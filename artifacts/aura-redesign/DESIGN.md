# DESIGN.md — CoH2 Skin Editor ("Dark visionOS Glass")

> Upload this file to aura.build via **Add DESIGN.md**. It encodes the editor's
> real design system (sourced verbatim from `src/index.css`) so every generated
> UI matches the app. Stack: **React + Vite + Tailwind CSS v4** (use the
> "React + Vite" output).

## Identity

Dark iOS-17 / visionOS glassmorphism. A near-black base with a 3D viewport as
the hero; all chrome **floats over it** as translucent, slightly-tinted dark
glass that bleeds the colour behind it through a heavy backdrop blur + saturate.
Hairline strokes, soft deep shadows, an inset top-edge highlight, large
continuous-curve radii. **No brand colour** — neutral glass; the only accent is
a cool selection-blue used sparingly for the selected/active item. Surfaces are
never pure white-on-dark; they're vibrant frosted glass.

Reference feel: iOS 17 Control Center, macOS Sonoma menubar, Vision Pro spatial
UI, Linear, Vercel dashboards, Arc browser sidebar.

## Colors

Base / depth:
- `--color-app-bg`: `oklch(0.155 0.015 260)` — near-black, slight cool tint (page background)
- `--color-app-bg-deep`: `oklch(0.115 0.013 260)` — deeper variant for depth

Glass tints (white overlays applied *over* a dark base — see Components):
- `--color-glass-1`: `rgb(255 255 255 / 0.04)` — faintest, large hero panels
- `--color-glass-2`: `rgb(255 255 255 / 0.07)` — default cards
- `--color-glass-3`: `rgb(255 255 255 / 0.10)` — hovered / elevated
- `--color-glass-4`: `rgb(255 255 255 / 0.14)` — active / focused

Strokes (hairlines — never stronger than 1px, use 0.5px):
- `--color-stroke-1`: `rgb(255 255 255 / 0.06)`
- `--color-stroke-2`: `rgb(255 255 255 / 0.10)`
- `--color-stroke-3`: `rgb(255 255 255 / 0.18)`

Text:
- `--color-text-1`: `oklch(0.97 0.005 260)` — primary
- `--color-text-2`: `oklch(0.78 0.010 260)` — secondary / captions
- `--color-text-3`: `oklch(0.60 0.015 260)` — tertiary / disabled

Accent (the ONLY accent):
- **selection-blue**: `rgba(74, 145, 255, 0.18)` — selected / active fills (e.g. the
  highlighted plan, the picked tool). Use it sparingly.

Semantic (status only, not decoration):
- `--color-blue`: `oklch(0.70 0.180 245)`
- `--color-green`: `oklch(0.74 0.180 145)`
- `--color-red`: `oklch(0.66 0.220 25)`

> Deprecated — DO NOT USE: an old `--color-accent` orange
> (`oklch(0.66 0.180 45)`) exists in the codebase but is dead. The system has
> **no orange**. Never introduce a brand hue.

## Typography

- Family: **Geist Variable** (`@fontsource-variable/geist`), system-ui fallback.
- Large headings: tight letter-spacing (`tracking-tight`), high weight.
- Body: `--color-text-1`; captions/labels: `--color-text-2` at 10–12px,
  often uppercase with `letter-spacing: 0.08em` for section labels.
- Control captions render as small as 10px (`text-[10px] leading-none font-medium`).

## Spacing & Radii

- Spacing: Tailwind v4 default scale. Chrome is **tight** — pills use
  `px-3 py-1.5`, rails/docks use `p-1.5`, panels `px-4 py-4`.
- Radii (continuous-curve, larger than typical web):
  - `--radius-panel`: `22px` (≈ rounded-2xl) — docks, rails, popovers
  - `--radius-card`: `18px` (≈ rounded-xl) — cards, dialogs
  - `--radius-input`: `10px` — inputs
  - `--radius-pill`: `9999px` — buttons, toggles, segmented controls

## Surfaces (the heart of the system — two glass families)

Every surface is one of two families. **Never inline a one-off glass
background** — always reference one of these classes.

### Family A — Overlay glass (`.glass-1 / .glass-2 / .glass-3`)
For surfaces over **dimmed content** (menus, dialogs, cards, popovers). Dark
base + faint white-tint gradient + heavy blur, **no outset shadow** (the dimmed
backdrop already separates them).

```css
.glass-1 { background-color: rgb(15 17 22 / 0.65);
  background-image: linear-gradient(180deg, rgb(255 255 255 / 0.04), rgb(255 255 255 / 0.02));
  backdrop-filter: blur(32px) saturate(140%); border: 0.5px solid rgb(255 255 255 / 0.06);
  box-shadow: inset 0 0.5px 0 rgb(255 255 255 / 0.05); }
.glass-2 { background-color: rgb(15 17 22 / 0.72);
  background-image: linear-gradient(180deg, rgb(255 255 255 / 0.06), rgb(255 255 255 / 0.03));
  backdrop-filter: blur(36px) saturate(150%); border: 0.5px solid rgb(255 255 255 / 0.10);
  box-shadow: inset 0 0.5px 0 rgb(255 255 255 / 0.06); }
.glass-3 { background-color: rgb(15 17 22 / 0.80);
  background-image: linear-gradient(180deg, rgb(255 255 255 / 0.08), rgb(255 255 255 / 0.04));
  backdrop-filter: blur(44px) saturate(160%); border: 0.5px solid rgb(255 255 255 / 0.18);
  box-shadow: inset 0 0.5px 0 rgb(255 255 255 / 0.08); }
```

### Family B — HUD glass (`.glass-hud / .glass-pill / .glass-pop`)
For chrome that **floats over a live/bright background** with nothing dimmed
behind it. Slightly lighter+cooler base so it stays legible over bright or dark
content, **with a deep outset float shadow** so it visibly lifts off.

```css
.glass-hud  { background-color: rgb(20 22 28 / 0.62);
  backdrop-filter: blur(36px) saturate(160%); border: 0.5px solid rgb(255 255 255 / 0.10);
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.45), inset 0 0.5px 0 rgb(255 255 255 / 0.10); }
.glass-pill { background-color: rgb(20 22 28 / 0.62);
  backdrop-filter: blur(36px) saturate(160%); border: 0.5px solid rgb(255 255 255 / 0.10);
  box-shadow: 0 8px 22px rgb(0 0 0 / 0.45), inset 0 0.5px 0 rgb(255 255 255 / 0.10); }
.glass-pop  { background-color: rgb(20 22 28 / 0.72);
  backdrop-filter: blur(36px) saturate(160%); border: 0.5px solid rgb(255 255 255 / 0.10);
  box-shadow: 0 16px 40px rgb(0 0 0 / 0.5), inset 0 0.5px 0 rgb(255 255 255 / 0.08); }
```

Always pair `backdrop-filter` with `-webkit-backdrop-filter`.

## Components

1. **Pill button** — `.glass-pill`, `rounded-full`, `px-3 py-1.5`, `text-[11px]
   font-medium`, icon 13px (strokeWidth 2) + label. Idle: neutral glass, text
   `--color-text-1`. Active: a single tinted fill (selection-blue for generic
   selection; a warm or green tint only for special modes) + brighter text.
2. **Segmented control** — `.glass-pill` wrapper holding `rounded-full`
   segments. Active segment: bright fill + `inset 0 0.5px 0 rgb(255 255 255 / 0.8)`
   ring; inactive: transparent, `--color-text-2` → white on hover.
3. **Dock / rail** — `.glass-hud`, `rounded-2xl`, `p-1.5`, fixed-positioned.
   Vertical icon stack or horizontal scrollable rail of 56×56 segments with a
   10px caption under each icon.
4. **Popover panel** — `.glass-pop`, `rounded-2xl`, slide-in
   (`200ms cubic-bezier(0.2,0.8,0.2,1)`).
5. **Card / Dialog / Menu** — shadcn/ui primitives reskinned: Card → `.glass-2`;
   Dialog/DropdownMenu/Select content → `.glass-3` with a deep drop shadow
   (`0 16px 40px rgba(0,0,0,0.5)`). App runs in dark mode (`<html class="dark">`).
6. **Inputs** — `rgba(0,0,0,0.3)` fill, `1px solid rgb(255 255 255 / 0.10)`
   border, `radius 8–10px`, focus brightens the border.

Shadows (tokens): `--shadow-glass: 0 8px 32px rgb(0 0 0 / 0.40), inset 0 1px 0 rgb(255 255 255 / 0.04)`;
`--shadow-pop: 0 24px 64px rgb(0 0 0 / 0.55), inset 0 1px 0 rgb(255 255 255 / 0.06)`.

## Motion

- Duration 150–200ms, easing `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- Apply to hover, active, and panel slide-in. Keep it short and crisp — no
  bouncy/long animations.

## Style rules (do / don't)

- **DO** pick a surface by context: over dimmed content → `.glass-*`; floating
  over live/bright content → `.glass-hud / .glass-pill / .glass-pop`.
- **DO** keep the palette neutral; reach for selection-blue only for the
  selected/active element.
- **DON'T** inline a new glass `background` / `backdrop-filter` — reuse a class.
- **DON'T** introduce a brand colour (no orange). Status colours (blue/green/red)
  are for state only.
- **DON'T** use heavy outset shadows on overlay glass, or thick (>1px) borders.
- **DO** use 0.5px hairline strokes and an inset top-edge highlight on glass.
- **DO** use Geist, tight tracking on big headings, 10–12px uppercase labels.
