# UX Best-Practices for a Decal / Texture / Skin Authoring Tool

Research to ground a later audit of the CoH2 Community Modding Tool (`/var/home/jflessenkemper/dev/coh2-skin-editor`) for "bad tools, unclear icons, too complex."
All external claims cited by URL. This is a research/synthesis doc — no code claims are made here except to point the audit at the app.

---

## TL;DR

- **Score against 10 well-established anchors, not opinion.** Nielsen's 10 heuristics still apply directly to creative editors: system status/live-preview, real-world language (not engine jargon), undo/redo as the emergency exit, consistency, error prevention, recognition-over-recall (visible tools > memorized ones), novice+expert flexibility (defaults AND shortcuts), minimalist surface, good errors, and in-context help. ([NN/G heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/))
- **The single biggest complexity killer is progressive disclosure**: show only what matters now, reveal the rest on demand. Done well it cuts time-to-first-action 30–50% while keeping 70–90% of feature discovery. ([UXPin](https://www.uxpin.com/studio/blog/what-is-progressive-disclosure/), [Userpilot](https://userpilot.com/blog/progressive-disclosure-examples/))
- **Icon-only toolbars are a top offense.** Every icon-only button needs a tooltip on *both* hover and keyboard focus plus an accessible label; ~300ms hover delay; tooltips are *supplementary* — if the info is required to do the task, it must be a permanent visible label, not a tooltip. Words beat cryptic symbols ("mystery meat"). ([NN/G tooltips](https://www.nngroup.com/articles/tooltip-guidelines/), [SubUX icon buttons](https://subux.pro/guides/article/icon-only-buttons), [ui-patterns anti-patterns](https://ui-patterns.com/blog/User-Interface-AntiPatterns))
- **A good 2D decal editor** offers: named layers with masks/blend modes, brush + alpha-stamp/stencil + projection tools, snapping (with angle snaps like 22.5°), non-destructive editing, and clear import/export. ([Mixos](https://www.mixos.io/), [PackCrafter](https://packcrafter.net/), [Substance decal](https://helpx.adobe.com/substance-3d-sampler/filters/generators/decal.html))
- **A good 3D previewer** offers: damped orbit/pan/zoom with clamped limits, focus-on-click pan target, loading progress, neutral studio lighting + PBR-faithful tone mapping, and live sync so 2D edits show on the model immediately. ([modelviewer.dev](https://modelviewer.dev/examples/stagingandcameras/), [Three.js viewer guide](https://altersquare.medium.com/building-3d-viewers-in-the-browser-three-js-implementation-guide-e3e87cbad1a7))
- **Non-destructive is the expected default**, per Photoshop's model: edits stored separately from source (layers, masks, adjustment/smart layers), a History panel/snapshots, nothing baked into the original. ([Adobe](https://helpx.adobe.com/photoshop/using/nondestructive-editing.html))
- **The anti-patterns to hunt**: kitchen-sink UI (everything on every screen), 40-icon toolbars, cryptic icons w/o labels, modal/tab overload, deep nesting, no sensible defaults, and **exposing engine internals to the user** (SGA/RGM/RGT/TEXCOORD1/UV2 terms leaking into UI). ([featurebloat.com](https://featurebloat.com/anti-patterns), [uxtigers UI annoyances](https://www.uxtigers.com/post/ui-annoyances))
- **Sensible defaults + presets/templates** are the fastest complexity reducer: preload working configurations so a user reaches a result without configuring anything first. ([UserOnboard](https://www.useronboard.com/onboarding-ux-patterns/sensible-defaults/), [Thoughtworks](https://www.thoughtworks.com/en-us/insights/topic/sensible-defaults))
- **Audit output**: use the numbered rubric at the bottom (12 checks, scored 0–2) to convert "feels too complex" into evidence.

---

## 1. Heuristics (established, applied to creative/asset editors)

**Nielsen's 10 heuristics** were developed 1990/refined 1994 and remain the industry baseline for heuristic evaluation. They are durable because they describe human↔machine mismatches, not any specific UI tech. ([NN/G](https://www.nngroup.com/articles/ten-usability-heuristics/), [UXtweak method](https://blog.uxtweak.com/usability-heuristics/)) Applied to a decal/skin editor:

1. **Visibility of system status** — the viewport IS the status: a live 3D/2D preview that updates as the user edits is the primary feedback loop. Show loading/progress for model+texture load (target <3s). ([NN/G](https://www.nngroup.com/articles/ten-usability-heuristics/), [Three.js guide](https://altersquare.medium.com/building-3d-viewers-in-the-browser-three-js-implementation-guide-e3e87cbad1a7))
2. **Match system ↔ real world** — use words a modder recognizes ("Decal", "Faceplate", "National insignia", "Skin"), not internal file-format/engine tokens. This is the heuristic most at risk in a modding tool that wraps a game engine.
3. **User control & freedom** — undo/redo is the canonical emergency exit; Photoshop's History panel is the textbook example. Support redo, clearly labeled Cancel, and easy "get back to where I was." ([NN/G](https://www.nngroup.com/articles/ten-usability-heuristics/), [DecisionLab](https://thedecisionlab.com/reference-guide/design/nielsens-heuristics))
4. **Consistency & standards** — same icon/word/gesture means the same thing everywhere; follow platform + creative-app conventions (e.g. `Ctrl+Z` undo, `[`/`]` brush size, layers panel on one side).
5. **Error prevention** — prevent bad states before they happen: constrain inputs, confirm destructive actions (delete layer, overwrite export), disable illegal operations rather than erroring after.
6. **Recognition rather than recall** — make tools, layers, and options *visible* so users recognize them instead of memorizing hidden ones. Minimize memory load. This directly indicts hidden/undiscoverable tools. ([NN/G](https://www.nngroup.com/articles/ten-usability-heuristics/))
7. **Flexibility & efficiency** — serve novices (defaults, visible controls) *and* experts (keyboard shortcuts, customization). Photo editors do both. ([shiftasia](https://shiftasia.com/community/applying-jakob-nielsens-10-usability-heuristics-for-better-ux-design/))
8. **Aesthetic & minimalist design** — exclude irrelevant info; every extra control competes for attention. Establish a clear visual hierarchy. Basis for "too complex" scoring.
9. **Help users recognize/diagnose/recover from errors** — plain-language messages that name the problem and suggest a fix, not error codes.
10. **Help & documentation** — searchable, in-context help (tooltips, inline hints, empty-state guidance) rather than a separate manual. ([NN/G](https://www.nngroup.com/articles/ten-usability-heuristics/))

**Progressive disclosure** (Nielsen, 1995) is the meta-technique that makes a complex editor feel simple: show only what's relevant now, reveal advanced options on demand via accordions, "Advanced" toggles, collapsible panels, or modals. Evidence: ~30–50% faster time-to-first-action while retaining 70–90% feature discovery; best for novices + complex tasks + limited screen space. ([UXPin](https://www.uxpin.com/studio/blog/what-is-progressive-disclosure/), [Userpilot](https://userpilot.com/blog/progressive-disclosure-examples/), [IxDF](https://ixdf.org/literature/topics/progressive-disclosure))

**Sensible defaults** — a pre-chosen value/config used absent a specific reason to change it. Defaults remove repetitive decisions, shorten the path to value, and help non-expert users reach a result immediately; templates/presets ("recipes") do the same at a coarser grain. ([UserOnboard](https://www.useronboard.com/onboarding-ux-patterns/sensible-defaults/), [Thoughtworks](https://www.thoughtworks.com/en-us/insights/topic/sensible-defaults), [Intercom onboarding](https://www.intercom.com/blog/five-essential-onboarding-tactics-for-complex-products/))

**Iconography with labels/tooltips** — words are read faster than cryptic symbols; "mystery meat" (ambiguous icons) forces guessing. Best practice: icon **+ text label** where space allows; where icon-only, a tooltip is mandatory. Tooltips must fire on **hover and keyboard focus**, appear after ~300ms hover (immediately on focus), use `aria-label`/`role="tooltip"`, be Escape-dismissable, and stay brief ("microcontent"). Crucially, **tooltips are supplementary — if the info is needed to complete the task, it must be a permanent visible label, not hidden in a tooltip.** ([NN/G tooltips](https://www.nngroup.com/articles/tooltip-guidelines/), [SubUX](https://subux.pro/guides/article/icon-only-buttons), [UX Design World](https://uxdworld.com/tooltip-guidelines/))

**Non-destructive editing** is the expected default in modern authoring tools: edits stored separately from source data so the original is never permanently altered; users can revisit, refine, remove, or redo any step even after save/reopen. Mechanisms: layers, layer/vector masks, adjustment layers, smart objects/filters, a History panel, and snapshots. ([Adobe](https://helpx.adobe.com/photoshop/using/nondestructive-editing.html), [PHLEARN](https://phlearn.com/tutorial/what-is-nondestructive-editing/))

---

## 2. Good-tool checklist

### A good 2D decal / texture editor should offer
- **Named layers** with visibility toggles, reorder, blend modes, opacity, and layer masks (non-destructive compositing). ([Adobe layers](https://helpx.adobe.com/photoshop/using/nondestructive-editing.html), Affinity Photo layer/mask/blend workflow per [wifitalents roundup](https://wifitalents.com/best/game-graphic-design-software/))
- **A small, coherent tool set**: brush, eraser, fill, picker, line/rect/circle, gradient — the PackCrafter set is a good "enough, not overwhelming" reference (16 named drawing tools). ([PackCrafter](https://packcrafter.net/))
- **Stamps / alpha stencils / projection painting** for placing decals and insignia (brush modes + alpha stamps + stencils, per Mixos). ([Mixos](https://www.mixos.io/))
- **Snapping** — position and, importantly, **angle snapping** (e.g. PackCrafter's symmetry axes snap to 22.5°); snap to grid/edges/other decals so placement is precise without pixel-nudging. ([PackCrafter](https://packcrafter.net/))
- **Live preview** of the edit (2D canvas and, ideally, the 3D result simultaneously).
- **Presets / templates** — starter decals, dirt/damage/graffiti packs, per-faction insignia presets so users aren't starting from a blank canvas (Decal Designer's 300+ built-in assets model). ([Decal Designer](https://www.fab.com/listings/d85387d2-09e8-4511-bf1a-86b58c2c457d))
- **Clear import/export** — obvious file formats, sane default output, named/labeled buttons (not an ambiguous icon), and feedback on success/failure/location of the written file.
- **Undo/redo + history** — multi-step, visible history where feasible. ([Adobe](https://helpx.adobe.com/photoshop/using/nondestructive-editing.html))

### A good 3D skin previewer should offer
- **Orbit/pan/zoom** with damping for smooth motion, and **clamped min/max distance + polar angle** so users can't get lost. ([modelviewer FAQ](https://modelviewer.dev/docs/faq.html), [Three.js guide](https://altersquare.medium.com/building-3d-viewers-in-the-browser-three-js-implementation-guide-e3e87cbad1a7))
- **Focus-on-click pan target** — when panning, show the pivot and refocus the camera on the picked model point so orbit doesn't spin around empty space. ([modelviewer camera](https://modelviewer.dev/examples/stagingandcameras/))
- **Loading progress** — indicator while model/textures load; target load <3s. ([Three.js guide](https://altersquare.medium.com/building-3d-viewers-in-the-browser-three-js-implementation-guide-e3e87cbad1a7))
- **Neutral studio lighting + PBR-faithful tone mapping** so the skin's colors read true (glTF/PBR "commerce" tone-mapping, neutral grayscale lighting is the reference standard). ([modelviewer FAQ](https://modelviewer.dev/docs/faq.html))
- **Saved / preset camera views** and, optionally, HTML annotations/labels pinned to model parts. ([Three.js guide](https://altersquare.medium.com/building-3d-viewers-in-the-browser-three-js-implementation-guide-e3e87cbad1a7), [modelviewer docs](https://modelviewer.dev/docs/))
- **Live 2D→3D sync** — a texture/decal edit appears on the model immediately (the "visibility of system status" heuristic in 3D form).

---

## 3. Anti-patterns that make such tools feel too complex

- **Kitchen-sink UI** — every control/option/feature visible on every screen with no prioritization or progressive disclosure ⇒ cognitive overload. Canonical examples: classic Word toolbars, early Salesforce. ([featurebloat.com](https://featurebloat.com/anti-patterns))
- **Toolbar / feature overload** — a 40-icon toolbar, a 12-section sidebar, a 6-tab modal, an 80-option settings page. Volume alone signals "too complex." ([featurebloat.com](https://featurebloat.com/anti-patterns))
- **Cryptic icons / "mystery meat" navigation** — ambiguous symbols with no label or tooltip force users to guess; words are faster to read. ([ui-patterns](https://ui-patterns.com/blog/User-Interface-AntiPatterns), [uxtigers](https://www.uxtigers.com/post/ui-annoyances))
- **Missing/weak tooltips** — icon-only buttons with no accessible label, hover-only tooltips (no keyboard focus), or tooltips that just repeat the label (redundant clutter). ([NN/G tooltips](https://www.nngroup.com/articles/tooltip-guidelines/))
- **Modal overload / deep nesting** — stacking modals, or burying core actions several panels/tabs/menus deep, breaks flow and hides features from recognition. (violates recognition-over-recall + minimalist design — [NN/G](https://www.nngroup.com/articles/ten-usability-heuristics/))
- **No sensible defaults** — dumping a blank canvas or a wall of un-preset options on the user, forcing configuration before any result. ([UserOnboard](https://www.useronboard.com/onboarding-ux-patterns/sensible-defaults/))
- **Configuration overload** — one of the ten structural causes of feature bloat: too many knobs, indefinitely-kept flags, ungrouped options. ([featurebloat.com](https://featurebloat.com/anti-patterns))
- **Exposing engine internals to the user** — leaking implementation vocabulary into the UI (file-format names like SGA/RGM/RGT, channel names like TEXCOORD1/UV2, atlas/bake internals, AppId, path guts). This violates "match system ↔ real world": the user thinks in *decals, skins, faceplates, insignia*, not the engine's serialization. This is the highest-value thing to flag in a modding tool that wraps a game engine.
- **Destructive-by-default editing** — baking edits into the source with no layers/history, so mistakes are unrecoverable (opposite of the [Adobe non-destructive model](https://helpx.adobe.com/photoshop/using/nondestructive-editing.html)).
- **Inconsistent iconography/behavior** — the same action drawn/worded differently in different places; shortcuts that don't match platform norms.

---

## 4. Audit Rubric (numbered checks)

Apply each check to the editor. **Score 0 = fails / 1 = partial / 2 = meets.** Record file/screenshot evidence per check. Max 24; below is a suggested banding: **20–24 good, 13–19 needs work, ≤12 "too complex / bad tools" confirmed.**

1. **Live preview / system status** — Does every edit produce immediate visible feedback in the 2D canvas and/or 3D viewport, with loading progress on model/texture load? ([NN/G](https://www.nngroup.com/articles/ten-usability-heuristics/), [Three.js guide](https://altersquare.medium.com/building-3d-viewers-in-the-browser-three-js-implementation-guide-e3e87cbad1a7))

2. **Real-world language, no engine leakage** — Does the UI speak the user's terms (decal, skin, faceplate, insignia) and *not* expose engine internals (SGA/RGM/RGT/TEXCOORD1/UV2/atlas/AppId) in labels, buttons, or errors? ([NN/G #2](https://www.nngroup.com/articles/ten-usability-heuristics/))

3. **Undo/redo + history** — Is there multi-step undo *and* redo, ideally a visible history, mapped to platform shortcuts (Ctrl+Z / Ctrl+Y or Ctrl+Shift+Z)? ([NN/G #3](https://www.nngroup.com/articles/ten-usability-heuristics/), [Adobe](https://helpx.adobe.com/photoshop/using/nondestructive-editing.html))

4. **Non-destructive editing** — Are edits stored separately from the source via layers / masks / adjustment layers (original never destroyed)? ([Adobe](https://helpx.adobe.com/photoshop/using/nondestructive-editing.html))

5. **Icon clarity (tooltips + labels)** — Does *every* icon-only control have a tooltip on both hover (~300ms) and keyboard focus, plus an accessible label; and is required info shown as a permanent label rather than hidden in a tooltip? Count any "mystery meat" icons. ([NN/G tooltips](https://www.nngroup.com/articles/tooltip-guidelines/), [SubUX](https://subux.pro/guides/article/icon-only-buttons))

6. **Tool-set restraint (no overload)** — Is the visible tool/control count reasonable (not a 40-icon wall / 80-option page), or is advanced stuff hidden behind progressive disclosure? Count top-level controls. ([featurebloat.com](https://featurebloat.com/anti-patterns), [UXPin](https://www.uxpin.com/studio/blog/what-is-progressive-disclosure/))

7. **Progressive disclosure** — Are advanced/rare options collapsed by default (accordions, "Advanced" toggles, collapsible panels) so a first-timer sees a clean surface? ([UXPin](https://www.uxpin.com/studio/blog/what-is-progressive-disclosure/), [IxDF](https://ixdf.org/literature/topics/progressive-disclosure))

8. **Sensible defaults + presets/templates** — On open, is there a working default state and starter presets/templates (insignia, dirt/damage, camo) so the user reaches a result without configuring first? ([UserOnboard](https://www.useronboard.com/onboarding-ux-patterns/sensible-defaults/), [Decal Designer](https://www.fab.com/listings/d85387d2-09e8-4511-bf1a-86b58c2c457d))

9. **Discoverability / recognition over recall** — Are tools, layers, and options visible and findable (not buried in deep menus/modals), so users recognize rather than memorize them? Count features reachable only via hidden paths. ([NN/G #6](https://www.nngroup.com/articles/ten-usability-heuristics/))

10. **Layers, snapping & placement precision** — Are there named layers with blend/opacity/masks, and does decal placement support snapping (grid/edge/angle, e.g. rotation snaps) for precise, non-fiddly positioning? ([Adobe](https://helpx.adobe.com/photoshop/using/nondestructive-editing.html), [PackCrafter](https://packcrafter.net/))

11. **3D viewport controls** — Damped orbit/pan/zoom with clamped limits, focus-on-click pivot, and neutral/PBR-faithful lighting so the skin reads true; no "lost in space" camera. ([modelviewer](https://modelviewer.dev/examples/stagingandcameras/), [modelviewer FAQ](https://modelviewer.dev/docs/faq.html))

12. **Import/export clarity + error handling** — Are import/export actions clearly labeled (not icon-only), with sane default output, success/failure feedback and the written file's location, and plain-language error messages that suggest a fix? ([NN/G #9](https://www.nngroup.com/articles/ten-usability-heuristics/), [NN/G tooltips](https://www.nngroup.com/articles/tooltip-guidelines/))

---

## Sources
- Nielsen 10 usability heuristics — https://www.nngroup.com/articles/ten-usability-heuristics/
- NN/G tooltip guidelines — https://www.nngroup.com/articles/tooltip-guidelines/
- Heuristic evaluation method (UXtweak) — https://blog.uxtweak.com/usability-heuristics/
- Applying Nielsen's heuristics (ShiftAsia) — https://shiftasia.com/community/applying-jakob-nielsens-10-usability-heuristics-for-better-ux-design/
- Nielsen's heuristics (Decision Lab) — https://thedecisionlab.com/reference-guide/design/nielsens-heuristics
- Progressive disclosure (UXPin) — https://www.uxpin.com/studio/blog/what-is-progressive-disclosure/
- Progressive disclosure examples (Userpilot) — https://userpilot.com/blog/progressive-disclosure-examples/
- Progressive disclosure (IxDF) — https://ixdf.org/literature/topics/progressive-disclosure
- Sensible defaults (UserOnboard) — https://www.useronboard.com/onboarding-ux-patterns/sensible-defaults/
- Sensible defaults (Thoughtworks) — https://www.thoughtworks.com/en-us/insights/topic/sensible-defaults
- Onboarding tactics for complex products (Intercom) — https://www.intercom.com/blog/five-essential-onboarding-tactics-for-complex-products/
- Icon-only buttons (SubUX) — https://subux.pro/guides/article/icon-only-buttons
- Tooltip guidelines (UX Design World) — https://uxdworld.com/tooltip-guidelines/
- UI anti-patterns (ui-patterns) — https://ui-patterns.com/blog/User-Interface-AntiPatterns
- Feature bloat anti-patterns — https://featurebloat.com/anti-patterns
- Top UI annoyances (UX Tigers) — https://www.uxtigers.com/post/ui-annoyances
- Non-destructive editing (Adobe) — https://helpx.adobe.com/photoshop/using/nondestructive-editing.html
- Non-destructive editing (PHLEARN) — https://phlearn.com/tutorial/what-is-nondestructive-editing/
- Mixos browser 3D texture painter — https://www.mixos.io/
- PackCrafter Minecraft texture editor — https://packcrafter.net/
- Decal Designer (Fab) — https://www.fab.com/listings/d85387d2-09e8-4511-bf1a-86b58c2c457d
- Substance 3D decal filter — https://helpx.adobe.com/substance-3d-sampler/filters/generators/decal.html
- Game graphic design software roundup (wifitalents) — https://wifitalents.com/best/game-graphic-design-software/
- modelviewer.dev staging & cameras — https://modelviewer.dev/examples/stagingandcameras/
- modelviewer.dev FAQ (lighting/tone mapping) — https://modelviewer.dev/docs/faq.html
- Building 3D viewers with Three.js (AlterSquare) — https://altersquare.medium.com/building-3d-viewers-in-the-browser-three-js-implementation-guide-e3e87cbad1a7
