# CoH2 Skin Editor (community)

A browser-based skin pack editor for **Company of Heroes 2** that runs entirely
on your own machine. You install Relic's CoH2 Mod Tools (free), then use this
web app to place decals on your tanks (shields, bortnummer, vehicle names,
kill rings) and export a buildable skin pack.

**Local-first by design.** Vehicle meshes and base textures come from your
local CoH2 Tools install — they're never uploaded to a server. The app is
just JavaScript running in your browser; the source you provide stays on
your machine.

## Status

Early scaffolding. The viewer + decal editor from
[`coh2-prinses-irene-skin`](https://github.com/jflessenkemper/coh2-prinses-irene-skin)
is being ported in here, with proper UI, multi-vehicle support, GitHub
Pages deployment, and a proper build pipeline.

## Develop

```sh
npm install
npm run dev
```

Open the URL Vite prints. You'll see a placeholder workspace in dark
glassmorphism style — actual viewport + decal placement is being wired in
next.

## Stack

- **Vite + React + TypeScript**
- **Tailwind CSS v4** (CSS-first config in `src/index.css`)
- **shadcn/ui** (Radix primitives, restyled for dark glassmorphism)
- **Three.js** (3D viewport, FBX loader, raycasting for decal placement)
- Pure-client compositor for the diffuse texture (no server)
- GitHub Pages for hosting

## Design

Dark iOS-glassmorphism. See `src/index.css` for the design token system —
glass surface alphas, hairline borders, oklch-based palette, deep soft
shadows, continuous corner radii.

## Why this exists

Relic's official Mod Tools workflow requires Wine/Proton, ModBuilder, raw XML
editing, and a deep understanding of Relic's pipeline — the barrier to entry
is too high. This editor compresses placement (the bit that needs a 3D
viewport) into a clean web UI, then emits the same TGA/XML files the official
tools would produce, so anyone can build a CoH2 skin pack without learning
the Mod Tools end-to-end.

## License

MIT. CoH2 game assets remain Relic/SEGA property — this app never redistributes
them. You must own CoH2 + the Mod Tools to use this editor.
