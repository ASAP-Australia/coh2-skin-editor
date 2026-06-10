# Aura.build brief — redesigning the CoH2 vehicle editor

Paste the **DESIGN SYSTEM** + **PROMPT** blocks below into Aura, and attach
`vehicle-editor-2x.png` (this folder) as the reference image. Aura outputs
**HTML + Tailwind**, so treat the result as a layout/visual study to port back
into our React components — not drop-in code. Keep the colour/blur/radius values
below so the output speaks our visual language.

---

## How to use (workflow)

1. New Aura project → **Image-to-HTML**. Upload `vehicle-editor-2x.png`.
2. Paste the **DESIGN SYSTEM** block (tokens) so Aura matches our palette.
3. Paste the **PROMPT** block (what to keep / what to redesign).
4. Iterate with short follow-ups ("make the bottom bar a single floating dock",
   "try the vehicle rail as a left sidebar", etc.).
5. Export HTML/Tailwind → **port** the class structure into our components:
   - `Editor.tsx` (overall chrome layout, bottom-center strip)
   - `VehicleMenu.tsx` (vehicle rail)
   - `TemplateDecalPills.tsx` (template + decal-pack pills)
   - `TopBar.tsx` (title pill), `ScenePanel.tsx` (right scene presets),
     `FactionPanel.tsx` (left faction/vehicle column)
   - Swap raw colours for our tokens, re-apply the glass recipe, wire handlers.
6. Leave the 3D viewport (`<canvas>`) alone — it's Three.js, not chrome.

---

## DESIGN SYSTEM (paste into Aura)

> Design language: **dark iOS/visionOS glassmorphism**. Surfaces are translucent
> dark glass with heavy backdrop blur + saturation, hairline strokes, soft deep
> shadows, and a subtle inset top highlight. Never flat/opaque panels. The 3D
> viewport is the hero; all chrome floats over it as glass.
>
> Font: Geist Variable / SF Pro / system-ui. Antialiased. Tight, small UI text.
>
> Color tokens:
> - App background: near-black `#0a0b0e` (cool tint)
> - Glass surface base: `rgba(15,17,22, 0.62–0.80)` over a `linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03))`
> - Bottom-bar pills use base `rgba(20,22,28,0.72)`
> - Strokes (hairline): `rgba(255,255,255,0.10)` default, `0.18` elevated — width 0.5px
> - Text: primary `#f5f6f8`, secondary `rgba(255,255,255,0.70)`, tertiary `rgba(255,255,255,0.45)`
> - Accent / selection: selection-blue `rgba(74,145,255,0.18)` (the app has no orange — neutral glass + blue selection only)
> - Active/selected pill: bright `rgba(255,255,255,0.95)` bg with black text (high-contrast), OR `inset 0 0 0 1.5px rgba(255,255,255,0.85)` ring
>
> Glass recipe (apply to every panel/pill):
> `background: rgba(15,17,22,0.7); backdrop-filter: blur(28–44px) saturate(150–180%); border: 0.5px solid rgba(255,255,255,0.10–0.18); box-shadow: 0 8–12px 32px rgba(0,0,0,0.45), inset 0 0.5px 0 rgba(255,255,255,0.08);`
>
> Radii: cards 18px, panels 22px, inputs 10px, pills fully rounded (9999px).
> Shadows: soft and deep, never harsh. Hairline inset top highlight on every surface.

---

## PROMPT (paste into Aura, after the design system)

> This is a desktop 3D vehicle skin editor (Company of Heroes 2). The center is a
> live 3D viewport (leave it as a large empty hero area / placeholder canvas — do
> NOT redesign it). Redesign the floating glass **chrome** around it using the
> design system above. Reproduce and improve these surfaces:
>
> - **Top center**: a small pill showing the pack title ("My Skin Pack") with an
>   edit affordance.
> - **Top left**: a single round glass "home/back" button.
> - **Left edge (vertical)**: a slim glass column — top item is the active faction
>   crest, below it a stack of vehicle/faction thumbnails.
> - **Right edge (vertical)**: 3 stacked round glass icon buttons (scene presets:
>   in-game field / studio grid / showcase).
> - **Bottom center (the focus of the redesign)** — a floating glass dock, stacked:
>   1. a control row: Explode · Summer/Winter season toggle · Edit texture
>   2. two "selector pills": **Template: Blank canvas** and **Decal pack: No decal pack**
>      (clickable, open dropdowns upward)
>   3. a **vehicle selector**: ~10 small text pills (Elefant, Tiger I, Brummbär,
>      StuG III, Ostwind, Panzerwerfer, Sd.Kfz. 222/251/250, Opel Blitz) — ALL
>      visible at once, wrapping onto multiple rows, the active one highlighted.
>
> Goals: make the bottom dock feel cohesive and less busy; keep everything as
> floating dark glass; ensure all vehicle labels are visible without scrolling;
> make the Template/Decal-pack pills read clearly as dropdown selectors. Give me
> 2–3 layout variations for the bottom dock (e.g. unified single bar vs. grouped
> segments vs. vehicle rail relocated to the left column).

---

## Notes / constraints for porting

- Aura emits HTML+Tailwind, **not** React/JSX — expect a `class→className`,
  self-closing-tag, and handler-wiring pass.
- Our glass look is partly hand-tuned inline styles AND partly Tailwind v4
  `@theme` tokens + `glass-1/2/3` utilities (see `src/index.css`). Prefer mapping
  Aura's output onto the existing `glass-*` utilities and `--color-*`/`--radius-*`
  tokens rather than introducing new raw hex values.
- The chrome **auto-fades on idle** (Editor.tsx) — that's a behaviour, not a
  layout concern; ignore it in Aura.
- Don't let Aura touch the `<canvas>` viewport, Three.js, or any stateful logic.
