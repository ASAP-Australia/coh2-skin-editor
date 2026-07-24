# Canvas Engine Research — coh2-skin-editor

**Research date:** 2026-06-13  
**Scope:** Evaluate canvas/image-editing engines for embedding under custom React editors in an Electron app.  
**Use cases:**
- **(A) Compositor** — object/layer compositing for decals and faceplates: objects, layers, move/scale/rotate with on-canvas handles, blend modes, opacity, z-order, serialization, text + shapes + image layers, bezier optional.
- **(B) Raster skin painter** — free-drawing brush on 2048² canvas feeding a live three.js `CanvasTexture` per stroke; needs raw `HTMLCanvasElement` access.

Existing context: custom undo/history engine and custom transform-handles component already in place.

---

## PRIMARY CANDIDATES

### 1. Konva.js (+ react-konva)

**License:** MIT (SPDX: `MIT`)  
No commercial caveats.  
Source: [GitHub konvajs/konva](https://github.com/konvajs/konva)

**Maintenance health (as of 2026-06-13):**  
- Latest version: **10.3.0** released **2026-04-30** (confirmed from CHANGELOG)
- Release cadence: 5+ releases in 2026 alone; 10.x series launched September 2025 with ESM migration and Skia render backend for Node.
- Single primary maintainer: Anton Lavrenov (@lavrton), funded via Patreon + Open Collective + GitHub Sponsors (Archon Systems Inc. is a named sponsor as of 2026). Active but one-person-core risk.
- NPM downloads: ~1.3 million/week (Key Ecosystem Project per Snyk).
- **Verdict: Actively maintained.** Not abandoned. Solo-maintainer model is the main continuity risk.

**React integration:**  
- Official first-party binding: **react-konva** v19.2.4 (published ~1 month ago as of June 2026), aligns with React 18/19.
- Fully declarative: `<Stage>`, `<Layer>`, `<Rect>`, `<Image>`, `<Text>`, `<Line>`, `<Transformer>` are React components.
- TypeScript: ships built-in `.d.ts` with the package — no `@types/konva` needed. Generic component interfaces. Quality is good but not generated from source (separate TS decl file). Works well in practice.

**Electron compatibility:**  
- **Known historical issue:** Konva ships `index-node.js` which requires `canvas` (node-canvas) for server-side use. With `electron-renderer` webpack target, webpack tries to bundle `canvas`/`jsdom`, causing `[ERR_REQUIRE_ESM]` or "Cannot find module 'canvas'" errors at build time.
- **v10.0.0 (Sep 2025)** fully migrated from CJS to pure ESM. This resolves the CJS/ESM conflict for Vite-based Electron stacks (electron-vite ≥ 2.0 supports ESM), but introduces a new surface: webpack 4-era Electron Forge setups may need `externals` config to exclude `canvas`/`jsdom`.
- **Recommended mitigation:** Use Vite-based Electron build (electron-vite), mark `canvas` and `jsdom` as external for the renderer bundle. For renderer-only use (no server-side export), the issue is cosmetic (build-time, not runtime).
- Sources: [Issue #277](https://github.com/konvajs/konva/issues/277), [Issue #1519](https://github.com/konvajs/konva/issues/1519), [vue-konva Issue #163](https://github.com/konvajs/vue-konva/issues/163)

**Feature fit — COMPOSITOR use case:**

| Feature | Status |
|---|---|
| On-canvas transform handles | **`Konva.Transformer`** — built-in, first-class. Rotate anchor, scale anchors, snap, custom anchor styling. Added `rotateAnchorAngle` in Jan 2026. |
| Layers / z-order | **Native.** `Stage → Layer → Group → Shape` scene graph. Multiple canvas-backed layers. z-index via `zIndex()` and `moveToTop()`/`moveToBottom()`. |
| Blend modes | **Supported** via `node.globalCompositeOperation('multiply')` — any valid CSS composite op on any shape or layer. |
| Per-object opacity | `node.opacity(0.5)` — native. |
| Text objects | `Konva.Text` — font, size, align, style. In-place editing requires custom overlay (no built-in click-to-edit). |
| Image objects | `Konva.Image` — native, loads `HTMLImageElement`/`HTMLCanvasElement`. |
| Shape primitives | Rect, Circle, Ellipse, RegularPolygon, Star, Line, Arrow, Path (SVG path data). |
| Bezier/curve | `Konva.Line` with `tension > 0` gives Catmull-Rom splines; `Konva.Path` accepts SVG `C`/`Q` bezier commands. Not a full bezier editor (no on-canvas handle drag for control points out of the box). |
| JSON serialize/deserialize | `stage.toJSON()` / `Konva.Node.create(json, container)`. **Limitation:** does not serialize filters, image data (URLs must be re-fetched), or event listeners. For complex apps, official docs recommend external state serialization (matches your architecture). |
| External undo integration | **Excellent.** Official docs explicitly show storing history in React state/refs and driving Konva from that state — Konva itself has no history system. Plug-and-play with your engine. |

**Feature fit — RASTER PAINT use case:**

- Free drawing: `Konva.Line` with `tension=0` accumulates points on `mousemove`. Works for basic brush simulation. **No built-in brush engine** (no pressure, texture, spray, smear). Lines are stored as vector objects — hundreds of strokes cause measurable slow-down (documented explicitly).
- Eraser: set `globalCompositeOperation('destination-out')` on the line.
- Raw canvas access: Konva **does not recommend** writing directly to its internal canvas. The documented approach is to create an independent `HTMLCanvasElement`, do pixel painting on it manually, then wrap it with `Konva.Image`. This means you maintain a parallel raw canvas entirely outside Konva — defeating the point of using Konva for raster paint.
- For a 2048² raster paint surface feeding three.js `CanvasTexture`, **Konva adds zero value** — you are better off with a bare `<canvas>` element and your own pointer-event handlers. The `CanvasTexture.needsUpdate = true` pattern works trivially on a naked canvas.
- **Verdict for raster: Do not use Konva for the raster skin painter.**

**Bundle size:**  
- Full bundle: ~45 KB minified (per DeepWiki / konvajs docs); minimal core ~26 KB.
- react-konva adds minimal overhead (~thin React reconciler wrapper).
- Konva v10 is pure ESM — tree-shakeable in theory but the core is monolithic enough that savings are modest.

**Migration ergonomics:**  
- External undo: no conflict — Konva has none.
- `toDataURL()`: `stage.toDataURL()` or `layer.toCanvas()` returning a real `HTMLCanvasElement`.
- Coexists cleanly with your external transform-handles if you bypass `Konva.Transformer` for specific nodes.

---

### 2. Fabric.js (v7 — current as of June 2026)

**License:** MIT (SPDX: `MIT`)  
No commercial caveats.  
Source: [GitHub fabricjs/fabric.js](https://github.com/fabricjs/fabric.js)

**Maintenance health (as of 2026-06-13):**  
- Latest version: **7.4.0** published ~17 days ago (June 2026). Previous 7.x releases came rapidly in 2026 including security patches (CVE-2026-44311 SVG export XSS, CVE-2026-27013 stored XSS).
- v7.0.0 was a relatively small step from v6 (same TypeScript rewrite base, origin default change, multi-touch gesture support, Node ≥20 required).
- Contributors: 277+; 23k+ GitHub stars; actively merged PRs.
- Funded: community/open-source, no single corporate sponsor. More distributed maintainer base than Konva.
- **Verdict: Actively maintained**, healthy cadence. Security patch velocity in 2026 is encouraging.

**React integration:**  
- **No official React binding.** Fabric is imperative — you `new Canvas(el)` in `useEffect`, then call imperative methods (`canvas.add()`, `canvas.setActiveObject()` etc.).
- Community wrapper: `fabricjs-react` (npm) provides a `useFabricJSEditor` hook but is not official and lags on v6/v7 TypeScript support.
- Pattern is workable but breaks React's declarative model; state must be manually synced. Notably more friction than react-konva for a React-first team.
- TypeScript: entire library rewritten to TypeScript in v6+; ships its own `.d.ts`. Quality is high — full generics on objects. Better TS quality than Konva.

**Electron compatibility:**  
- No specific major v7 Electron issues documented. `createPngStream` (node-canvas) had historical issues; not relevant for renderer-only use.
- Fabric is browser-first (uses `document`, `window`); works in Electron renderer process without configuration issues since Electron exposes a full DOM.
- No `ERR_REQUIRE_ESM` history comparable to Konva's node entrypoint problem.
- v7 drops Node 18 support (Node ≥20). Electron 29+ ships Node 20+ so no conflict.

**Feature fit — COMPOSITOR use case:**

| Feature | Status |
|---|---|
| On-canvas transform handles | **Built-in, first-class controls.** Scale handles, rotation handle, move — appear automatically on selection. Fully customizable control points. Cropping controls added in v7.1–7.2. |
| Layers / z-order | No dedicated layer abstraction — z-order is `canvas.bringToFront()`, `sendToBack()`, `bringForward()` on objects. All objects live in one z-indexed flat list. For multi-layer semantics you'd need stacked Fabric instances or group-based simulation. |
| Blend modes | `object.globalCompositeOperation = 'multiply'` — supported on FabricObject. |
| Per-object opacity | `object.opacity` — native. |
| Text objects | `fabric.IText` — in-place double-click editing, cursor, selection built in. Best-in-class among these libraries. |
| Image objects | `fabric.FabricImage` — native. |
| Shape primitives | Rect, Circle, Ellipse, Triangle, Polygon, Polyline, Path (full SVG path). |
| Bezier/curve | `fabric.Path` with SVG `C`/`Q` commands — renders bezier paths. No interactive bezier point editor out of the box. |
| JSON serialize/deserialize | `canvas.toJSON()` / `canvas.loadFromJSON()`. More complete than Konva's: serializes object styles, custom properties. `loadFromJSON` callback changed in v6+; third-party `fabric-history` plugin needed for undo (lacks v6/v7 TypeScript support per GitHub issue #10011). |
| External undo integration | **More friction.** Fabric has no built-in history, but the canonical pattern is `canvas.toJSON()` snapshot + `canvas.loadFromJSON()` restore. This conflicts with an external pure-state engine — you need to roundtrip through JSON which involves async image re-loading. The `loadFromJSON()` behave-differently-in-v6 bug (GitHub #10011) is a live concern. |

**Feature fit — RASTER PAINT use case:**

- Built-in brush engine: `canvas.isDrawingMode = true` activates `canvas.freeDrawingBrush` (PencilBrush, SprayBrush, CircleBrush). Better out of the box than Konva.
- Eraser: `fabric.EraserBrush` (with `erasable` per-object property). First-class eraser support.
- Raw canvas access: `canvas.lowerCanvasEl` exposes the actual `HTMLCanvasElement`. However Fabric docs note it "should never be written to or manipulated." Reading for three.js `CanvasTexture` is technically possible but Fabric may repaint the lower canvas independently of your read cadence, and the upper canvas (event capture overlay) adds DOM complexity.
- Performance at 2048²: Each free-drawing stroke eventually becomes a `fabric.Path` object added to the canvas. At 2048², the viewport and object model still incur overhead on every `renderAll()`. Performance reports for high-stroke-count raster painting are poor.
- **Verdict for raster: Usable but non-ideal.** Same fundamental issue as Konva — the library wants to manage strokes as objects; exposing a raw canvas for live three.js readback is fighting the framework.

**Bundle size:**  
- Bundlephobia shows v6 listing (~550 KB minified, ~150 KB gzip) — Fabric is notably large. v7 migrated to ESM and improved tree-shaking but the core OOP hierarchy means limited practical savings for a full install. Expect ~120–160 KB gzip in practice.
- Source: [Bundlephobia fabric](https://bundlephobia.com/package/fabric)

**Migration ergonomics:**  
- External undo: requires JSON roundtrip for state capture; async `loadFromJSON` complicates synchronous undo. More work to integrate than Konva.
- `canvas.toDataURL()` works fine. `lowerCanvasEl` accessible for export.
- No `Transformer` equivalent (controls are per-object, not a separate node) — but since you have custom transform handles, you can disable Fabric's native controls (`object.hasControls = false`) and drive transforms externally via `object.set({left, top, scaleX, scaleY, angle})` + `canvas.renderAll()`.

---

## ALTERNATE CANDIDATES (brief screen)

### Pixi.js v8 (v8.16.0, June 2026)

**License:** MIT  
**Maintenance:** Very actively maintained. v8.16.0 published 6 days ago. Corporate backing (Goodboy Digital). @pixi/react rebuilt from scratch for v8 with TypeScript + React 19 support.  
**Compositor fit:** Pixi is a **WebGL/WebGPU renderer** first — exceptional performance for sprites and 2D game rendering, but selection handles, text editing, SVG paths, and serialization require building from scratch or third-party plugins. No built-in transform selection UI. Designed for real-time rendering, not design-editor use cases. **Not recommended for compositor unless you want to build most of the editor layer yourself.**  
**Raster fit:** Could work — you can blit pixel operations via `extract.canvas()` and use a `RenderTexture`. But the overhead of a WebGL stack for a 2048² paint canvas is unnecessary when a bare 2D canvas suffices.

### Paper.js (v0.12.18)

**License:** MIT  
**Maintenance:** Last npm publish ~2 years ago; last commit ~July 2024. Effectively in **maintenance/slow-development mode**. No TypeScript types shipped natively — requires `@types/paper` (DefinitelyTyped). No React binding. Requires a Paperscript or complex imperative setup. Excellent vector/bezier editing but community is shrinking.  
**Compositor fit:** Strong bezier/path editing model, but no built-in UI controls (no selection handles), no React integration, no active development. **Not recommended.**  
**Raster fit:** Not a raster library.

### Two.js (v0.8.23)

**License:** MIT  
**Maintenance:** v0.8.23, last publish ~5 months ago. Moderate update cadence. Renderer-agnostic (SVG/Canvas/WebGL backends) but a thin abstraction layer with limited community. No official React binding. No transform selection UI, no text editing, no raster paint. **Not recommended for either use case.**

---

## RASTER PAINT SPECIAL CASE: No Engine

For use case (B) — the 2048² skin painter feeding a live `CanvasTexture` — the recommendation is:

**Use a bare `<canvas>` element with vanilla pointer-event handlers, no canvas engine.**

Rationale:
- All major engines (Konva, Fabric, Pixi) ultimately maintain an object model that conflicts with raw pixel manipulation at 2048².
- The live three.js `CanvasTexture` integration is trivial with a naked canvas: `new THREE.CanvasTexture(canvasRef.current)` + `texture.needsUpdate = true` in your `onPointerMove` handler.
- You already have a custom undo engine — snapshot `getImageData()`/`putImageData()` or maintain a `ImageData[]` stack.
- Your custom transform-handles component is irrelevant to a raster paint surface.
- Free-draw brush: `ctx.beginPath()`, `ctx.moveTo()`, `ctx.lineTo()`, `ctx.stroke()` with `lineJoin: 'round'`, `lineCap: 'round'`. Eraser: `globalCompositeOperation = 'destination-out'`.
- This approach eliminates all three Electron/ESM/bundle concerns for this editor.

If you insist on a library for the raster surface (e.g. for the brush engine): **Fabric.js EraserBrush + PencilBrush** covers basic brush/eraser without building it, but requires careful `lowerCanvasEl` extraction and fighting Fabric's render loop for live readback. Not worth it vs. 100 lines of vanilla canvas code.

---

## RANKED RECOMMENDATIONS

### Compositor editor (use case A): **Konva.js + react-konva**

**Rationale:**
1. First-class React component model — no imperative `useEffect` management; shapes map 1:1 to components.
2. `Konva.Transformer` covers on-canvas move/scale/rotate handles out of the box; since you have custom handles already, it can be bypassed or supplemented cleanly.
3. External undo is explicitly the recommended pattern in official docs — zero conflict with your engine.
4. ESM-only as of v10 works cleanly with Vite/electron-vite; the legacy `canvas` module issue is a non-problem in renderer-only use.
5. 45 KB minified full bundle vs Fabric's ~550 KB minified.
6. Blend modes, opacity, z-order, layers, JSON serialize all available.

**Biggest risk:** Solo maintainer dependency (Anton Lavrenov). If maintenance lapses, the react-konva React reconciler in particular could fall behind React versions. Mitigate: pin versions, monitor the GitHub.

**Second choice for compositor: Fabric.js v7** — if in-place text editing and richer built-in object controls outweigh the React integration friction and large bundle. The undo/history JSON roundtrip is the biggest pain point with your existing history engine.

### Raster skin painter (use case B): **Bare `<canvas>` — no engine**

**Rationale:** All engines fight the live-canvas-readback requirement. 2048² pixel painting with per-stroke `CanvasTexture` updates is a ~80-line vanilla canvas problem, not an engine problem. The custom undo engine already exists; add `getImageData`/`putImageData` snapshots.

**Biggest risk:** You own the brush interpolation (Catmull-Rom smoothing between mouse events). This is well-understood but requires ~50 additional lines vs. Fabric's PencilBrush.

---

## FLAGS: Assumptions that differ from 2023-era common knowledge

1. **Fabric v6 is NOT current.** As of June 2026, Fabric.js is on **v7.4.0**. v6 was the TypeScript rewrite; v7 is the stable successor. Much 2023–2024 content references v5 APIs that are now removed.
2. **Konva v10 is ESM-only.** The historical CJS/ESM conflict in Electron is a build-config problem now, not a fundamental incompatibility — but Vite-based stacks are required for seamless use. Webpack 4 Electron Forge setups need manual `externals`.
3. **Fabric has no built-in history in v6/v7.** GitHub issue #10011 (still open) confirms this. The `fabric-history` npm plugin does not have proper v6/v7 TypeScript support. Factor this if you rely on Fabric's state for undo.
4. **Konva.Transformer is the preferred handles approach.** In 2023 this was sometimes described as "requires manual attachment"; it is now mature API with `rotateAnchorAngle` and full customization added through 2025–2026.
5. **Paper.js is effectively stalled.** If you were evaluating Paper.js for its bezier editing story, last commit is July 2024 and npm is 2+ years old. Eliminate it.

---

## SOURCES

- [Konva.js CHANGELOG](https://github.com/konvajs/konva/blob/master/CHANGELOG.md)
- [react-konva npm](https://www.npmjs.com/package/react-konva)
- [Fabric.js CHANGELOG (raw)](https://raw.githubusercontent.com/fabricjs/fabric.js/master/CHANGELOG.md)
- [Fabric.js v7 upgrade guide](https://fabricjs.com/docs/upgrading/upgrading-to-fabric-70/)
- [Fabric.js Canvas API](https://fabricjs.com/api/classes/canvas/)
- [Fabric.js Undo/Redo issue #10011](https://github.com/fabricjs/fabric.js/issues/10011)
- [Konva Native Context Access](https://konvajs.org/docs/sandbox/Native_Context_Access.html)
- [Konva React Free Drawing](https://konvajs.org/docs/react/Free_Drawing.html)
- [Konva React Undo/Redo](https://konvajs.org/docs/react/Undo-Redo.html)
- [Konva Electron Issue #1519](https://github.com/konvajs/konva/issues/1519)
- [vue-konva Electron ESM Issue #163](https://github.com/konvajs/vue-konva/issues/163)
- [Konva DeepWiki architecture overview](https://deepwiki.com/konvajs/konva)
- [Fabric.js + Three.js texture forum](https://discourse.threejs.org/t/seeking-advice-integrating-fabric-js-and-three-js-for-dynamic-texture-updates/67820)
- [DEV Community: React comparison Konva vs Fabric](https://dev.to/lico/react-comparison-of-js-canvas-libraries-konvajs-vs-fabricjs-1dan)
- [PixiJS blog v8.16.0](https://pixijs.com/blog/8.16.0)
- [Paper.js GitHub](https://github.com/paperjs/paper.js)
- [Konva Open Collective](https://opencollective.com/konva)
- [Bundlephobia fabric](https://bundlephobia.com/package/fabric)
- [Bundlephobia konva](https://bundlephobia.com/package/konva)
