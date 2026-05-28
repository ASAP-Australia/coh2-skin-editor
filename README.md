# CoH2 Skin Editor (community)

<!-- Badges. Order: build → quality → security → supply-chain → meta. Each
     badge points at a workflow committed to .github/workflows/. Drafts for
     lighthouse / mutation exist locally but are out of scope for v1.0. -->

[![CI](https://github.com/ASAP-Australia/coh2-skin-editor/actions/workflows/ci.yml/badge.svg)](https://github.com/ASAP-Australia/coh2-skin-editor/actions/workflows/ci.yml)
[![CodeQL](https://github.com/ASAP-Australia/coh2-skin-editor/actions/workflows/codeql.yml/badge.svg)](https://github.com/ASAP-Australia/coh2-skin-editor/actions/workflows/codeql.yml)
[![html-validate](https://github.com/ASAP-Australia/coh2-skin-editor/actions/workflows/html-validate.yml/badge.svg)](https://github.com/ASAP-Australia/coh2-skin-editor/actions/workflows/html-validate.yml)
[![size-limit](https://github.com/ASAP-Australia/coh2-skin-editor/actions/workflows/size-limit.yml/badge.svg)](https://github.com/ASAP-Australia/coh2-skin-editor/actions/workflows/size-limit.yml)
[![accessibility](https://github.com/ASAP-Australia/coh2-skin-editor/actions/workflows/accessibility.yml/badge.svg)](https://github.com/ASAP-Australia/coh2-skin-editor/actions/workflows/accessibility.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/ASAP-Australia/coh2-skin-editor/badge)](https://securityscorecards.dev/viewer/?uri=github.com/ASAP-Australia/coh2-skin-editor)
[![Gitleaks](https://github.com/ASAP-Australia/coh2-skin-editor/actions/workflows/gitleaks.yml/badge.svg)](https://github.com/ASAP-Australia/coh2-skin-editor/actions/workflows/gitleaks.yml)
[![OSV Scanner](https://github.com/ASAP-Australia/coh2-skin-editor/actions/workflows/osv-scanner.yml/badge.svg)](https://github.com/ASAP-Australia/coh2-skin-editor/actions/workflows/osv-scanner.yml)
[![Dependency Review](https://github.com/ASAP-Australia/coh2-skin-editor/actions/workflows/dependency-review.yml/badge.svg)](https://github.com/ASAP-Australia/coh2-skin-editor/actions/workflows/dependency-review.yml)
[![codecov](https://codecov.io/gh/ASAP-Australia/coh2-skin-editor/branch/main/graph/badge.svg)](https://codecov.io/gh/ASAP-Australia/coh2-skin-editor)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A desktop skin / decal / faceplate editor for **Company of Heroes 2** that
publishes directly to the **Steam Workshop**. Place decals on tanks (shields,
bortnummer, vehicle names, kill rings), build full skin packs, and ship them
to your subscribers — Steam handles distribution, multiplayer lobby
validation, and updates.

**Local-first by design.** Vehicle meshes and base textures come from your
local CoH2 install via Steam — they're never uploaded to a server. The
Workshop upload is the only outbound network call, and it goes straight
to Steam over their authenticated SDK channel.

## Status

**v1.0 — Steam-first desktop release.** The editor is shipped as an
Electron app that bridges to the Steamworks SDK for authentication and
Workshop publishing. The previous browser build (which couldn't publish
to Workshop) has been retired.

The Steam-first architecture fixes the pre-1.0 multiplayer-lobby
validation bug: every published item now carries a real Workshop ID, so
Steam recognises subscriptions when CoH2 asks during lobby join.

## Install

Grab the latest AppImage / `.exe` from
[Releases](https://github.com/ASAP-australia/coh2-skin-editor/releases).
You need:

- **Steam running** and signed into the account that owns Company of
  Heroes 2 (Steam App ID 231430).
- **CoH2 installed** through that Steam account.

The first launch authenticates against Steam, locates your CoH2 install
automatically, and (one-time) clears any stale packs from a pre-1.0
install of this tool from your mods folder.

## Develop

```sh
npm install
npm run electron:dev     # runs Vite + Electron with hot reload
npm run test             # runs the Vitest suite (~1500 tests)
npm run electron:build   # produces an AppImage in ./release
```

Steam must be running for `electron:dev` to authenticate — the SteamGate
screen will sit on the "no-steam" branch until you start the client.

## Stack

- **Electron + Vite + React 19 + TypeScript**
- **Tailwind CSS v4** (CSS-first config in `src/index.css`)
- **shadcn/ui** (Radix primitives, restyled for dark glassmorphism)
- **Three.js** (3D viewport, FBX loader, raycasting for decal placement)
- **steamworks.js** (Node.js binding to the Steamworks SDK)
- Pure-client compositor for the diffuse texture (no server)

## Design

Dark iOS-glassmorphism. See `src/index.css` for the design token system —
glass surface alphas, hairline borders, oklch-based palette, deep soft
shadows, continuous corner radii.

## Why this exists

Relic's official Mod Tools workflow requires Wine/Proton, ModBuilder, raw
XML editing, and a deep understanding of Relic's pipeline — the barrier
to entry is too high. This editor compresses placement (the bit that
needs a 3D viewport) into a clean Electron UI, packs the result into a
valid CoH2 `.sga`, and uploads it straight to the Workshop — so anyone
can ship a skin pack without learning the Mod Tools end-to-end.

## Security & quality gates

CI runs on every PR:

- **CI** — `tsc`, ESLint, Vitest (~1500 unit + component tests), Playwright
  smoke
- **CodeQL** — static analysis for JS/TS security issues
- **OpenSSF Scorecard** — supply-chain & repository-hygiene scoring
- **Accessibility** — axe-core + pa11y-ci against WCAG 2.1 AA
- **Dependency Review** — flags new direct deps with known CVEs
- **OSV Scanner** — Google's vulnerability database lookup
- **Gitleaks** — secret-scanning on every commit
- **Size limit** — guards against bundle-size regressions

## License

MIT. CoH2 game assets remain Relic/SEGA property — this app never
redistributes them. You must own CoH2 (via Steam) to use this editor.
