# lab01.dev — Design Language Extraction

Source: **https://lab01.dev/** (Sebastiano Guerriero's UI experiments lab). Extracted read-only via `curl` on 2026-07-24. Reference for reskinning the **editor UIs** of the CoH2 skin-editor app.

## What was extracted

The homepage (`https://lab01.dev/`) iframes experiments **01, 02, 04–11** (03 and 12 exist but are not iframed on the landing page — 12 is actually the portfolio homepage itself reused). All **12 experiment slugs 01–12 return HTTP 200**. I fetched every experiment's `index.html` and its stylesheet(s):

| Exp | UI demonstrated | HTML | CSS source |
|-----|-----------------|------|-----------|
| 01 | Settings/appearance panel (theme picker, toggle switch, Save/Cancel) | `experiments/01/index.html` | `experiments/01/assets/css/experiment-01.css` (hand-written, 25 KB) |
| 02 | Context/command menu (action list, hotkey chips, sliding marker, Rive icons) | `experiments/02/index.html` | `experiments/02/assets/css/experiment-02.css` (3 KB) |
| 03 | Morphing custom-value input (Send Money / amount stepper, currency select) | `experiments/03/index.html` | `experiments/03/styles.css` (Tailwind v4, pretty-printed) |
| 04 | Email client — sidebar folder nav + context menu + message list | `experiments/04/index.html` | `experiments/04/styles.css` (Tailwind v4, pretty-printed) |
| 05 | Segmented control / tab switcher (Timeline·Extensions·Stats·Projects) + resizable aside | `experiments/05/assets/index-BxXa19hk.css` | Tailwind v4 minified |
| 06 | Time-picker / AM·PM draggable dial | `experiments/06/assets/index-BpIW5amz.css` | Tailwind v4 minified |
| 07 | Collapsible sidebar (nav groups, status list, resizable `--aside-width`) | `experiments/07/assets/index-aZ7LpI1O.css` | Tailwind v4 minified |
| 08 | Kanban board (columns To Do/Doing, task cards, progress rings, avatars) | `experiments/08/assets/index-BdEjUVn2.css` | Tailwind v4 minified |
| 09 | Animated favorite/star toggle button (SVG morph) | `experiments/09/assets/index-PuPxy7vx.css` | Tailwind v4 minified |
| 10 | Document editor toolbar (Undo/Redo/AI, status dropdown, version history menu) | `experiments/10/assets/index-D6cyOsHL.css` | Tailwind v4 minified |
| 11 | Right-click context menu (Comment/Ask AI/Delete/Duplicate + shortcut hints) | `experiments/11/assets/index-BSpTHrQ7.css` | Tailwind v4 minified |
| 12 | = the portfolio homepage (site chrome) | `experiments/12/index.html` | `assets/css/style.css` → imports `tw-output.css` + `legacy.css` |

**Two eras of code:**
- **Era A (hand-authored, richest for our purpose):** exp 01 + 02, and the site chrome (`legacy.css`). These contain the explicit "lab01 signature" recipes: layered near-black surfaces, `mask-composite` border-light rings, corner blooms, `feTurbulence` noise, radial-highlight buttons. **Geist + Geist Mono** fonts.
- **Era B (Tailwind v4 build output):** exp 03–11. Same *visual* signatures, but expressed through Tailwind utilities (`mask-clip-padding-only`, `inset-ring-*`, `bg-radial-[...]`, multi-stop `shadow-[...]`). These use `--font-sans: ui-sans-serif, system-ui` (system fonts, **not** Geist) and per-experiment accent colors.

All CSS below is verbatim from the fetched files. Where a bundle was minified, the recipe is quoted from its expanded twin (exp 03/04 are pretty-printed and share the utility set).

---

## Experiment 01 — Settings / Appearance panel (the canonical reference)

The single most useful experiment for an editor reskin: it's a floating settings card with a heading, a theme-picker row, a labeled toggle, and a Cancel/Save footer — structurally identical to an editor's properties/inspector panel.

**UI parts:** `.container` card → `.header` (title + icon close button) → body (theme picker radio-image group, toggle switch) → `.footer` (2-col grid Cancel/Save). Behind it: full-bleed background `<img>` per theme, two blurred corner `.light` blooms, and a `.bg-noise` grain layer.

### Palette — three live themes via `:has()` (dark / light / gold)
```css
/* experiments/01/assets/css/experiment-01.css */
body { font-family: "Geist Mono", system-ui, monospace; font-weight: 500; font-size: 0.8125rem; }
:root { --f-family-heading: "Geist", system-ui, sans-serif; }

/* GOLD theme */
--color-bg-light: #BA965A;  --color-bg: #BA965A;
--color-contrast-higher: #2F2212;  --color-contrast-highest: #101010;
/* DARK theme */
--color-bg-light: #1F1F1F;  --color-bg: #111111;
--color-contrast-higher: #fff;  --color-contrast-highest: #fff;
/* LIGHT theme */
--color-bg-light: oklch(77% 0 0);  --color-bg: oklch(77% 0 0);
--color-contrast-higher: black;  --color-contrast-highest: black;
```
Signature palette = **near-black `#111111` surface, `#1F1F1F` raised surface, warm gold `#BA965A` accent, white/black text at reduced alpha.** Note the default body font is **Geist Mono at 13px** — mono is the UI text, not just metadata.

### Surface card — translucent + backdrop blur + masked border-light ring
```css
.container {
  position: relative; z-index: 2; width: 444px; height: 440px;
  background: hsl(from var(--color-bg) h s l / .85);   /* 85% opaque near-black */
  backdrop-filter: blur(20px);
  border-radius: 24px;
  display: flex; flex-direction: column;

  &::after {                       /* the border-light RING */
    content: ''; position: absolute; inset: 0;
    border-radius: inherit; pointer-events: none;
    border: 1.25px solid transparent;
    mask: linear-gradient(black, black) padding-box, linear-gradient(black, black);
    mask-composite: exclude;       /* punches out the interior → only the border paints */
  }
}
/* the gradient FILL of that ring, per theme (dark shown): */
.main:has(input#theme-picker-dark:checked) .container::after {
  background: linear-gradient(160deg,
    hsl(from white h s l / .30),
    hsl(from white h s l / .02) 37%,
    hsl(from white h s l / .05) 70%,
    hsl(from white h s l / .1)) border-box;
}
```
**This `border:1.25px transparent` + `mask … padding-box` + `mask-composite:exclude` pattern is THE lab01 signature** — a 1px bright hairline that catches light on the top-left corner and fades around the edge. It recurs everywhere.

### Corner blooms + film grain
```css
.light {                         /* two of these, positioned at opposite corners */
  position: absolute; background: white;
  height: 196px; width: 196px; border-radius: 50%;
  z-index: 10; mix-blend-mode: overlay;
  filter: blur(150px);           /* EXPENSIVE — see cheap approximations below */
  pointer-events: none;
}
.bg-noise {
  position: absolute; inset: 0; pointer-events: none;
  filter: url(#noise-bg-fx) grayscale(100%);   /* SVG feTurbulence, see below */
  z-index: 10; mix-blend-mode: screen;
  /* opacity .1 (dark) / .15 (gold/light) */
}
```
```html
<!-- the noise filter, inline SVG in the page -->
<filter id="noise-bg-fx"><feTurbulence baseFrequency="0.8" /></filter>
```

### Buttons — dark base + radial top-highlight + masked ring + deep layered shadow
```css
.btn-primary {                   /* the masked ring, identical recipe to the card */
  &::after {
    content: ''; position: absolute; inset: 0; border-radius: inherit;
    pointer-events: none; border: 1.5px solid transparent;
    mask: linear-gradient(black, black) padding-box, linear-gradient(black, black);
    mask-composite: exclude;
  }
}
/* gold primary button surface: */
.btn-primary {
  color: hsl(from var(--color-contrast-higher) h s l / .83);
  text-shadow: 0 1px 0 hsl(from white h s l / .3);
  background: radial-gradient(ellipse at -20px top, hsl(from white h s l / .25), hsl(from white h s l / 0)), var(--color-bg-light);
  background-blend-mode: overlay, normal;
  box-shadow:
    inset 0 0 0 1px hsl(from white h s l / .04),   /* inner top highlight */
    0 0 0 1px hsl(from black h s l / .15),          /* 1px dark keyline */
    0px 40px 11px rgba(136,97,46,.01),              /* soft warm ambient stack */
    0px 26px 10px rgba(136,97,46,.05),
    0px 14px 9px  rgba(136,97,46,.17),
    0px 6px 6px   rgba(136,97,46,.29),
    0px 2px 4px   rgba(136,97,46,.33);
}
```
Buttons: `height: 38px`, `border-radius: 12px`, `transition: translate .1s`, `&:active { translate: 0 1px; }` (presses down 1px). Focus: `outline: 1.5px solid var(--color-contrast-highest); outline-offset: 2px;`.

### Toggle switch
```css
.switch {
  --switch-w: 44px; --switch-h: 22px; --switch-radius: 50em; --switch-p: 3px;
  border-radius: var(--switch-radius);
  transition: all var(--switch-trans-duration);
}
.switch-marker { border-radius: calc(var(--switch-radius) - var(--switch-p)); }
/* marker reuses .btn-primary surface recipe; slides via transform */
.switch-marker { transition: transform var(--switch-trans-duration); }
```
Toggle track = same dark masked-ring surface; the knob **is** a `.btn-primary` (radial-highlight pill). Reduced-motion: all transitions set to `none`.

### Type & spacing
- Body: **Geist Mono 500, 13px**. Headings: **Geist**, `letter-spacing: -0.025em`, `.title` at panel-heading size.
- `.text` = primary label, `.text-subtle` = muted description (color at reduced alpha per theme).
- Panel padding `24px`; section gaps `44px`; footer is a `grid-template-columns: 1fr 1fr; gap: 12px`.
- Radii: card **24px**, buttons/inputs **12px**, theme-preview tiles **15px**, switch pill.

---

## Experiment 02 — Command / context menu

Vertical action menu: each row = animated Rive `<canvas>` icon (24×24) + label + right-aligned monospace **hotkey chip** (`R`, `]`, `⇧R`, `⇧P`, `⇧H`). A `.menu-marker` element slides behind the hovered/active row (shared-element highlight). Fonts: **Inter** here (opsz axis). Directly reusable as an editor's right-click menu or command palette.

Key ideas: hotkey hints as quiet mono chips aligned right; a single moving highlight marker rather than per-row background swaps; icon+label+meta three-column row rhythm.

---

## Experiments 03–11 — Tailwind v4 era (same signatures, utility-expressed)

All share this Tailwind v4 theme base (from `experiments/03/styles.css`, `05` etc.):
```css
--font-sans: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", …;
--font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, …;
--spacing: .25rem;                       /* 4px base unit → size-3 = 12px, size-4.5 = 18px */
--radius-sm:.25rem; --radius-md:.375rem; --radius-lg:.5rem; --radius-xl:.75rem;
--ease-out: cubic-bezier(0,0,.2,1);
--default-transition-duration:.15s;
--default-transition-timing-function: cubic-bezier(.4,0,.2,1);
--font-weight-medium:500;
/* body: font-variant-numeric: slashed-zero; -webkit-font-smoothing: antialiased; */
```
Common icon size **`size-4.5` (18px)**, small dots `size-3` (12px). `font-variant-numeric: slashed-zero` on every body — a distinctive "engineered" numeric look.

### The masked border-light ring, as a Tailwind utility
```css
/* experiments/03/styles.css */
.mask-clip-padding-only {
  mask: linear-gradient(black, black) content-box, linear-gradient(black, black);
  mask-composite: exclude;
}
```
Combined with `inset-ring-1 inset-ring-white/3`, `bg-radial-[at_0%_0%] from-white/10 to-transparent`, and multi-stop `shadow-[...]` this reproduces the exp-01 raised-surface look purely in markup. Example "current/active" surface (exp 05/07 segmented control + sidebar item):
```
bg-linear-to-b from-white/… to-transparent
inset-shadow-2xs inset-shadow-white/… inset-ring inset-ring-white/… shadow-xs
transition-[transform,width] duration-… ease-out will-change-…
```

### Per-experiment accent palettes (all on near-black or near-white grounds)
```
exp 03  bg #242424 (raised #333) on #161616/#000; text #F5F5F5/#ADADAD/#6B6B6B; brand #F3BA2F (Binance gold); red #FB2C36
exp 04  LIGHT theme: bg #F6F8FC; text #202124; borders #EAECF0/#E8EDF7; muted #868FA0  (email client)
exp 05  bg #0C0C0C; text #FAFAFA/#B8B4B0/#7A736C; primary #FC49A0 (pink)   (segmented tabs)
exp 06  near-white #F3F1F1 ground; accent #FE9A00 / #FF8D00 (orange) on #292523   (time dial)
exp 07  contrast-high #090909; medium #333; low #99A1A8; chips #F4F6F8/#E9EBEC (light collapsible sidebar)
exp 08  bg #19181B (raised #252429/#323036); brand #EE4169 / #FF2866 (pink-red); text #F9F5FF   (kanban)
exp 09  contrast-high #070707 on #121212; low #A49F98   (star toggle)
exp 10  bg #08090A; text #F4F7F5; low #919793; brand #09BC8A (emerald)   (editor toolbar)
exp 11  bg #191919 (raised #303030/#252525); text #D6D6D6; low #636363; primary #DA4167 (rose)   (context menu)
```
Pattern: **one saturated accent per screen** over a monochrome near-black (or, for "app-chrome" screens like email/sidebar, near-white) ground. Accent is used sparingly — a status dot, an active tab, a primary button, a progress ring.

### Elevation via absurd multi-stop shadows (verbatim, exp 05/07)
```css
box-shadow:
  0 601px 168px rgba(9,9,9,.01), 0 385px 154px rgba(9,9,9,.05),
  0 216px 130px rgba(9,9,9,.17), 0 96px 96px rgba(9,9,9,.28),
  0 24px 53px rgba(9,9,9,.33), inset 0 1px 0 #FFFFFF;
```
Big floating panels get 5–6 stop shadows scaled to the element (hundreds of px blur on a `size-135` = 540px card) plus an `inset 0 1px 0 #FFF` top highlight. Cards get tighter versions: `0 0 0 1px rgba(9,9,9,.07), 0 26px 15px rgba(0,0,0,.02), 0 11px 11px rgba(0,0,0,.03), 0 3px 6px rgba(0,0,0,.03)`.

### Motion
- Default `transition-duration: .15s`, `ease` = `cubic-bezier(.4,0,.2,1)`; deliberate moves use `ease-out cubic-bezier(0,0,.2,1)` and `duration-500`.
- Shared-element sliding marker (segmented control exp 05, menu exp 02, sidebar exp 07) transitions `transform,width` with `will-change`.
- Micro-interactions: buttons press `translate: 0 1px`; collapse animations blur content `blur-[5px]` while shrinking (`data-collapsing:blur-[5px]`, `data-too-small:opacity-30`).
- Everything respects `prefers-reduced-motion` → `transition: none`.

---

## Site chrome (`legacy.css`) — confirms the same signatures

```css
/* legacy.css — the button/chip border-light ring, same recipe as exp 01 */
&::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  border-radius: inherit;
  background: linear-gradient(120deg, hsl(0 0% 100% / .6), hsl(0 0% 100% / 0) 10%,
              hsl(0 0% 100% / 0) 90%, hsl(0 0% 100% / .25)) border-box;
  border: 1px solid transparent;
  mask: linear-gradient(black, black) padding-box, linear-gradient(black, black);
  mask-composite: exclude;
}
&:hover {
  box-shadow: inset 0 0 0 1px hsl(0 0% 100% / .1), 0 0 0 1px hsl(0 0% 0% / .075),
              0 .2px .3px -2px hsl(0 0% 0% / .06), 0 .7px .9px -2px hsl(0 0% 0% / .083),
              0 3px 4px -2px hsl(0 0% 0% / .14);
  background: hsl(0 0% 19%);      /* #303030-ish hover */
}
.bg-noise { inset: 0; pointer-events: none; opacity: .1;
            filter: url(#noise-bg-fx) grayscale(100%); }
.experiment-aside { background: url('../img/bg-stripes.svg'); clip-path: inset(2px); }
```
Chrome uses self-hosted **Geist Mono** (`GeistMono.woff2`) for mono/eyebrow text with `font-variant-numeric: slashed-zero` and `letter-spacing: var(--tracking-wide)`; `--font-sans: system-ui` for body. Dashed hairline dividers use `oklch(100% 0 0 / .08)`. Diagonal **stripe SVG textures** (`bg-stripes.svg`) mark inert/aside regions.

---

## Synthesized "lab01 design language" — token set for a Tailwind/React app

Drop-in tokens (CSS custom properties). Tuned to the **dark** signature (the editors should sit on near-black to recede next to the 3D viewport).

```css
:root {
  /* ---- surfaces (near-black, layered) ---- */
  --l01-bg:            #111111;   /* app / panel ground */
  --l01-surface:       #1F1F1F;   /* raised control */
  --l01-surface-2:     #303030;   /* hover / pressed */
  --l01-surface-alpha: hsl(0 0% 7% / .85);   /* translucent panel over viewport */

  /* ---- text (reduced-alpha whites) ---- */
  --l01-text:      hsl(0 0% 100% / .85);
  --l01-text-mute: hsl(0 0% 100% / .55);
  --l01-text-faint:hsl(0 0% 100% / .35);

  /* ---- accent (pick ONE per surface; gold = house accent) ---- */
  --l01-accent:      #BA965A;   /* house gold */
  --l01-accent-warm-shadow: 136 97 46;   /* rgb for warm ambient shadow stacks */

  /* ---- hairlines / rings ---- */
  --l01-hairline: oklch(100% 0 0 / .08);   /* dividers, dashed */
  --l01-ring-fill: linear-gradient(160deg,
      hsl(0 0% 100% / .30), hsl(0 0% 100% / .02) 37%,
      hsl(0 0% 100% / .05) 70%, hsl(0 0% 100% / .10));  /* border-light gradient */

  /* ---- radii ---- */
  --l01-r-panel: 24px;
  --l01-r-control: 12px;
  --l01-r-chip: 8px;
  --l01-r-pill: 50em;

  /* ---- type ---- */
  --l01-font-ui:   "Geist", system-ui, sans-serif;
  --l01-font-mono: "Geist Mono", ui-monospace, monospace;  /* labels, hotkeys, numbers */
  --l01-text-heading-tracking: -0.025em;
  --l01-text-eyebrow: /* uppercase, tracking-wide, mono, faint */ ;
  /* body 13px / 500; slashed-zero on numerics */

  /* ---- motion ---- */
  --l01-ease:     cubic-bezier(.4,0,.2,1);
  --l01-ease-out: cubic-bezier(0,0,.2,1);
  --l01-dur:      .15s;
  --l01-dur-slow: .5s;
}
```

**Reusable recipes (mixins):**

1. **Border-light ring** — put on any panel/button/chip `::after`:
   ```css
   .l01-ring::after{content:'';position:absolute;inset:0;border-radius:inherit;
     pointer-events:none;border:1.25px solid transparent;
     background:var(--l01-ring-fill) border-box;
     mask:linear-gradient(#000,#000) padding-box,linear-gradient(#000,#000);
     mask-composite:exclude;}
   ```
2. **Raised control surface** — dark base + radial top highlight + inner hairline:
   ```css
   .l01-raised{background:radial-gradient(ellipse at -20px top,
       hsl(0 0% 100% / .12),hsl(0 0% 100% / 0)),var(--l01-surface);
     box-shadow:inset 0 0 0 1px hsl(0 0% 100% / .04),0 0 0 1px hsl(0 0% 0% / .15),
       0 2px 4px hsl(0 0% 0% / .33),0 6px 9px hsl(0 0% 0% / .17);}
   ```
3. **Primary/accent button** = `.l01-raised` with gold base + warm rgb(136 97 46) shadow stack + `.l01-ring`; `:active{translate:0 1px}`.
4. **Sliding highlight marker** — one absolutely-positioned element that `transition: transform,width` behind the active tab/menu-row, instead of toggling per-item backgrounds.
5. **Hotkey / metadata chips** — mono, faint, right-aligned, `--l01-r-chip`, quiet.
6. **Film grain** — one fixed `.bg-noise` layer over the whole editor (`mix-blend: screen/overlay`, opacity .08–.12).

**Recurring signatures to hit for authenticity:**
- Near-black layered surfaces (`#111 → #1F1F1F → #303030`), translucent when floating over the viewport.
- The `mask-composite: exclude` **1px border-light ring** on every raised element (top-left bright, fades away).
- **Radial top-highlight** on buttons (`radial-gradient(ellipse at -20px top, white-alpha, transparent)`) + `background-blend-mode: overlay`.
- **Corner white blooms** (`blur(150px)`, `mix-blend: overlay`) + faint **feTurbulence grain**.
- **Mono UI text** (Geist Mono) for labels/numbers/hotkeys with `slashed-zero`; Geist sans with tight `-0.025em` tracking for headings; uppercase mono eyebrows.
- One saturated accent per screen; gold `#BA965A` is the house color.
- Deep, many-stop, warm-tinted shadows scaled to element size + `inset 0 1px 0 #FFF` top edge.
- Press-down `translate:0 1px`; shared-element sliding highlights; reduced-motion honored.
- 4px spacing grid; radii 24 / 12 / 8 px; 18px (`size-4.5`) icons.

---

## Expensive recipes + cheap approximations (target renders beside a live Three.js viewport)

The GPU is busy with the 3D scene; avoid per-frame compositor cost.

| Signature | Cost | Cheap approximation |
|---|---|---|
| `backdrop-filter: blur(20px)` on panels | **High** — full-screen readback every frame the viewport animates; worst offender next to a live canvas. | Use an **opaque** near-black panel (`#141414`, no translucency) OR translucency **without** blur (`hsl(0 0% 7% / .9)`). If blur is essential, apply only while the panel is static and drop it during viewport interaction (toggle a class on orbit/drag). |
| `filter: blur(150px)` corner blooms | **High** — huge blur radius = large offscreen buffer. | Bake into a **static radial-gradient PNG/CSS** background: `radial-gradient(circle at 12% -5%, rgba(255,255,255,.06), transparent 40%)`. Zero runtime blur, same look. |
| `feTurbulence` SVG noise | **Medium-High** — regenerated on resize; SVG filter pipeline. | Ship a **pre-rendered tiling noise PNG** (`background-image`, `mix-blend: overlay`, opacity .06). Data-URI a 128×128 tile. Never animate it. |
| 5–6 stop `box-shadow` on big panels | **Medium** — many shadow passes, repaints on move. | Collapse to **2 stops** (`0 1px 1px rgba(0,0,0,.2), 0 12px 24px rgba(0,0,0,.35)`) + keep the cheap `inset 0 1px 0 rgba(255,255,255,.06)` top edge. Visually ~indistinguishable at panel scale. |
| `mask-composite` border-light ring | **Low** — static, cheap. **Keep it** — it's the signature and costs almost nothing. | (none needed) Prefer a `::after` with the masked border over animating it. |
| `mix-blend-mode: overlay/screen` layers | **Low–Medium** — forces its own compositing layer; fine if static, avoid stacking many over the animating canvas. | Fine for static chrome. Don't put blend-mode layers *between* the viewport and UI; keep them inside opaque panels. |
| `will-change` on sliding markers | Low if scoped | Only set `will-change: transform` on the marker during interaction, then remove — permanent `will-change` wastes a layer. |

**Rule of thumb for this app:** keep the *static* signatures (masked border-light ring, radial-highlight buttons, layered near-black colors, mono type, baked-gradient glow, PNG grain, tightened shadows) — they're nearly free — and drop the *runtime* filters (`backdrop-filter`, `blur()` blooms, live `feTurbulence`) in favor of pre-baked equivalents so nothing competes with the Three.js compositor.
