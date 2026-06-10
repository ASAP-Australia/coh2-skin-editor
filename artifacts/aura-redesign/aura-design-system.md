# Building the CoH2 Skin Editor design system in aura.build

> Goal: take the glass design **already encoded in `src/index.css`** and turn it
> into a reusable, AI-driveable design system inside [aura.build](https://www.aura.build),
> so future screens/components are generated *on-brand* instead of re-derived.
>
> This is a **port + formalisation**, not a redesign. Everything below maps a
> token we already ship to the slot aura.build expects.

---

## 0. What aura.build gives us (the facts)

aura.build is an AI design/app builder. The pieces relevant to us:

- **Documentation** — https://www.aura.build/learn/documentation
- **Skills** — https://www.aura.build/skills — reusable capability bundles the
  builder applies when generating UI. This is where a "design system" lives:
  you teach it your tokens + component recipes once, and every generation
  reuses them.
- **How to design** — https://www.aura.build/learn/how-to-design

Per its own docs it targets **Tailwind CSS v4, design tokens, and reusable
React UI components** — which is *exactly* our stack (Tailwind v4 `@theme` +
`@utility`, React 19, shadcn/ui). So the port is near-lossless: our tokens are
already in the shape aura.build wants.

The mechanism: create a **Skill** that contains (a) the token table, (b) the
glass-surface utility recipes, (c) the component "do/don't" rules. The builder
then conditions every generation on that Skill.

---

## 1. The design language in one paragraph (the Skill preamble)

> Dark iOS-17 / visionOS glassmorphism. Near-black base `#0a0b0e` with the 3D
> viewport as the hero; all chrome **floats over it** as translucent dark glass.
> Heavy backdrop blur (≥36px) + saturation (160%), 0.5px hairline white strokes,
> soft deep shadows, an inset top-edge highlight, and large continuous-curve
> radii. **No brand colour** — the palette is neutral glass; the only accent is a
> cool selection-blue used sparingly for selected/active state. Typography is
> Geist Variable. Motion is short and eased (150–200ms, cubic-bezier(0.2,0.8,0.2,1)).

Paste this verbatim as the Skill description — it is the single sentence every
generation should be conditioned on.

---

## 2. Design tokens (port these into the Skill's token table)

These already exist in `src/index.css` (`@theme` + `:root`/`.dark`). aura.build
consumes design tokens directly, so copy them 1:1.

### Color / surface primitives
| Token | Value | Role |
|---|---|---|
| `--color-bg` | `#0a0b0e` (near-black) | app base, behind the viewport |
| `--color-glass` | `rgb(15 17 22)` | overlay-glass base tint |
| `--color-stroke` | `rgb(255 255 255 / 0.10)` | hairline border on every glass surface |
| `--color-text-1` | near-white | primary text |
| `--color-text-2` | muted grey | captions, inactive labels |
| selection-blue | `rgba(74, 145, 255, 0.18)` | **the only accent** — selected/active fills |

> Note: the legacy orange `--color-accent: oklch(0.66 0.180 45)` is **dead** —
> only `TokensPreview.tsx` references it. Do **not** carry it into aura.build.

### Radii / blur / motion
| Token | Value |
|---|---|
| radius (chrome) | `1rem`–`1.25rem` (rounded-2xl), pills `9999px` |
| radius (cards/dialogs) | `0.75rem` (rounded-xl) |
| blur | `36px` |
| saturation | `160%` |
| motion | `150–200ms cubic-bezier(0.2, 0.8, 0.2, 1)` |

---

## 3. The surface recipes (the heart of the system)

We ship **two glass families**. This split is the most important thing to teach
aura.build — it's *the* rule that keeps generated UI coherent.

### Family A — Overlay glass (`glass-1 / glass-2 / glass-3`)
For surfaces that sit **over dimmed content** (menus, dialogs, cards, popovers).
- base `rgb(15 17 22 / 0.65–0.80)`
- blur 32–44px, saturate 160%
- 0.5px white hairline
- **NO outset float shadow** (the dimmed backdrop already separates them)

Mapped onto shadcn/ui: `DropdownMenuContent`, `SelectContent`, `DialogContent`
use `glass-3`; `Card` uses `glass-2`.

### Family B — HUD glass (`glass-hud / glass-pill / glass-pop`)
For chrome that **floats over the live 3D viewport** with nothing dimmed behind it.
- base `rgb(20 22 28 / 0.62–0.72)` (slightly denser so it reads over bright 3D)
- blur 36px, saturate 160%
- 0.5px white hairline
- **WITH a deep outset float shadow** (this is what makes it "float")

```css
/* the three HUD recipes verbatim from src/index.css */
@utility glass-hud {   /* docks & rails: ScenePanel, FactionPanel, VehicleMenu, BottomToolPill */
  background-color: rgb(20 22 28 / 0.62);
  backdrop-filter: blur(36px) saturate(160%);
  -webkit-backdrop-filter: blur(36px) saturate(160%);
  border: 0.5px solid rgb(255 255 255 / 0.10);
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.45), inset 0 0.5px 0 rgb(255 255 255 / 0.10);
}
@utility glass-pill {  /* small toggles: SeasonToggle, ExplodeButton, EditTextureButton */
  background-color: rgb(20 22 28 / 0.62);
  backdrop-filter: blur(36px) saturate(160%);
  -webkit-backdrop-filter: blur(36px) saturate(160%);
  border: 0.5px solid rgb(255 255 255 / 0.10);
  box-shadow: 0 8px 22px rgb(0 0 0 / 0.45), inset 0 0.5px 0 rgb(255 255 255 / 0.10);
}
@utility glass-pop {   /* floating popover panels: TopBar settings panel */
  background-color: rgb(20 22 28 / 0.72);
  backdrop-filter: blur(36px) saturate(160%);
  -webkit-backdrop-filter: blur(36px) saturate(160%);
  border: 0.5px solid rgb(255 255 255 / 0.10);
  box-shadow: 0 16px 40px rgb(0 0 0 / 0.5), inset 0 0.5px 0 rgb(255 255 255 / 0.08);
}
```

**The rule for aura.build:** "Is the surface over dimmed content? → `glass-*`.
Is it floating over the live viewport? → `glass-hud/pill/pop`. Never invent a
new inline glass `background`/`backdropFilter` — always reference a utility."

---

## 4. Component recipes (the Skill's component library)

Each entry = a recipe aura.build can instantiate. Keep them token-driven so a
generation can't drift.

1. **Pill button** (`glass-pill`, rounded-full, px-3 py-1.5, text-[11px]):
   idle = neutral glass + `rgb(229,231,235)` text; active = a *single* tinted
   fill (warm for Explode, green for Edit-texture, selection-blue for generic
   selection) + inset highlight ring. Icon 13px, strokeWidth 2.
2. **Segmented control** (`glass-pill` wrapper, segments rounded-full): active
   segment = bright fill + `inset 0 0.5px 0 rgb(255 255 255 / 0.8)` ring; inactive
   = transparent, `text-2` → white on hover. (SeasonToggle, BottomToolPill.)
3. **Dock / rail** (`glass-hud`, rounded-2xl, p-1.5, fixed-positioned): vertical
   icon stack (ScenePanel/FactionPanel) or horizontal scrollable rail
   (BottomToolPill). 56×56 segments with 10px caption.
4. **Popover panel** (`glass-pop`, rounded-2xl, slide-in animation): the TopBar
   settings panel pattern.
5. **Dialog / Card / Menu** → shadcn primitives already re-skinned to `glass-3`/
   `glass-2`. Teach aura.build to use *those* rather than raw `bg-popover`.

---

## 5. Recommended workflow in aura.build

1. **Create a Skill** named e.g. *"CoH2 Glass HUD"*. Paste §1 as the description.
2. **Add the token table** (§2) into the Skill's design-tokens section — colors,
   radii, blur, motion.
3. **Add the two utility families** (§3) as the Skill's CSS layer (`@utility`
   blocks — aura.build supports Tailwind v4 `@utility`).
4. **Add the component recipes** (§4) as the Skill's component library, each with
   the "do / don't" note (especially the "never inline a new glass background"
   rule).
5. **Seed with a reference screenshot** — upload `vehicle-editor-2x.png` (already
   in this folder) so the builder has a visual ground-truth of the target.
6. **Generate against the Skill.** Every new screen now starts on-brand:
   neutral glass, blue-only accent, correct surface family, Geist type.

---

## 6. Gaps to close before/while porting (cheap wins)

- The few **intentional denser inline surfaces** (Editor back-pill 0.72,
  TemplateDecalPills 0.85/0.72, SliderPopover 0.96, BlendModeSelect/ToolOptionsPeel
  0.72, PackIdentityPopover 0.96, FaceplateEditor 0.88) are deliberate density
  variants. In the Skill, expose them as **named opacity steps** (e.g.
  `glass-pop`, `glass-solid`) rather than magic numbers, so generations pick a
  *named* step instead of an arbitrary alpha.
- Drop the dead orange token entirely once `TokensPreview.tsx` is retired.
- Codify selection-blue as a real `--color-selection` token so it's a first-class
  accent in the Skill, not a literal sprinkled around.

---

### TL;DR
Our `src/index.css` already *is* the design system — two glass families, a neutral
palette, a blue-only accent, Geist type, eased short motion. Porting to aura.build
means encoding those exact tokens + the two surface-family recipes + the
"reference-a-utility-never-inline-glass" rule as a **Skill**, seeding it with the
existing editor screenshot, and generating against it.
