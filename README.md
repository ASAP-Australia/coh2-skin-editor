# CoH2 Skin Editor (community)

![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Electron](https://img.shields.io/badge/Electron-41-47848F?logo=electron&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![tests](https://img.shields.io/badge/tests-1600%20passing-brightgreen)
![typecheck](https://img.shields.io/badge/typecheck-0%20errors-brightgreen)
![bundle](https://img.shields.io/badge/bundle-130%20kB-brightgreen)
![branch coverage](https://img.shields.io/badge/branch%20coverage-79%25-yellow)
![license](https://img.shields.io/badge/license-MIT-blue)

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
[![knip](https://github.com/ASAP-Australia/coh2-skin-editor/actions/workflows/knip.yml/badge.svg)](https://github.com/ASAP-Australia/coh2-skin-editor/actions/workflows/knip.yml)
[![lockfile-lint](https://github.com/ASAP-Australia/coh2-skin-editor/actions/workflows/lockfile-lint.yml/badge.svg)](https://github.com/ASAP-Australia/coh2-skin-editor/actions/workflows/lockfile-lint.yml)
[![native-lint](https://github.com/ASAP-Australia/coh2-skin-editor/actions/workflows/native-lint.yml/badge.svg)](https://github.com/ASAP-Australia/coh2-skin-editor/actions/workflows/native-lint.yml)
[![bench](https://github.com/ASAP-Australia/coh2-skin-editor/actions/workflows/bench.yml/badge.svg)](https://github.com/ASAP-Australia/coh2-skin-editor/actions/workflows/bench.yml)
[![electron-release](https://github.com/ASAP-Australia/coh2-skin-editor/actions/workflows/electron-release.yml/badge.svg)](https://github.com/ASAP-Australia/coh2-skin-editor/actions/workflows/electron-release.yml)
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

## Publishing skins to the Workshop

The CoH2 engine validates RSA signatures on SGA archives before loading them.
Exported skin `.sga` files cannot be dropped into your local mods folder and
loaded in-game — the engine rejects unsigned archives. The supported
distribution flow is **publishing to the Steam Workshop**. When you subscribe
to a Workshop item, Steam delivers a signed copy of the SGA. For local testing
before publication, use the editor's **Live Sync** feature, which writes to the
local mods folder under a flag the engine recognizes during development.

## Develop

```sh
npm install
npm run electron:dev     # runs Vite + Electron with hot reload
npm run test             # runs the Vitest suite (1577 tests)
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

| Workflow | Trigger | What it checks | Run locally |
|---|---|---|---|
| **CI** (`ci.yml`) | every PR & push | `tsc`, ESLint, Vitest (1577 unit + component tests), Playwright smoke | `npm run typecheck && npm run lint && npm test && npm run e2e` |
| **size-limit** (`size-limit.yml`) | every PR | bundle size budgets (250 kB main, 150 kB three, brotli) | `npm run size` |
| **accessibility** (`accessibility.yml`) | every PR | axe-core + pa11y-ci against WCAG 2.1 AA | `npm run a11y && npm run a11y:pa11y` |
| **html-validate** (`html-validate.yml`) | every PR | static HTML validity of renderer output | _(run via CI)_ |
| **knip** (`knip.yml`) | every PR | dead exports, unused dependencies | `npm run knip` |
| **lockfile-lint** (`lockfile-lint.yml`) | every PR | supply-chain: lockfile registry + package-manager hygiene | `npm run lockfile:lint` |
| **native-lint** (`native-lint.yml`) | push/PR touching `native/` | clang-tidy + cppcheck on the NAPI C++ addon | _(run via CI)_ |
| **CodeQL** (`codeql.yml`) | every PR | JS/TS static security analysis | _(run via CI)_ |
| **OpenSSF Scorecard** (`scorecard.yml`) | weekly | supply-chain & repository-hygiene scoring | _(run via CI)_ |
| **Dependency Review** (`dependency-review.yml`) | every PR | new direct deps with known CVEs | _(run via CI)_ |
| **OSV Scanner** (`osv-scanner.yml`) | every PR | Google OSV vulnerability database lookup | _(run via CI)_ |
| **Gitleaks** (`gitleaks.yml`) | every PR | secret-scanning on every commit | _(run via CI)_ |
| **bench** (`bench.yml`) | weekly + manual | Vitest perf benchmarks: BC3 encode, DDS wrap, full mod build | `npm run bench` |
| **electron-release** (`electron-release.yml`) | `v*` tag push + manual | builds Linux AppImage + Windows NSIS installer | `npm run electron:build` |

## License

MIT. CoH2 game assets remain Relic/SEGA property — this app never
redistributes them. You must own CoH2 (via Steam) to use this editor.
