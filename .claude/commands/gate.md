---
description: Run every automated gate this project has, and report honestly which ones can actually fail
---

Run the full verification stack and summarise. For each, report the real output
and the exit code — never `| tail` a command whose exit code matters.

**Fast (always run):**
1. `npm run typecheck` and `npx tsc --noEmit -p tsconfig.electron.json`
2. `npm test` — the real gate on `src/`
3. `npm run lint`
4. `./.claude/hooks/guard-process-kill.test.sh` — the kill-guard, both directions

**Game-dependent (skip cleanly if CoH2 is absent, do not fail):**
5. `npx tsx --tsconfig tsconfig.node.json scripts/verify-unwrap-analytical.mts`
6. `npx tsx --tsconfig tsconfig.node.json scripts/verify-faceplate.mts`

   ⚠ These import NOTHING from `src/`. They validate our understanding of the
   GAME'S DATA, not this application's code — a regression in `src/lib/rgm.ts`
   does not move them. Never present them as a gate on a code change.

**Electron (needs a prior build):**
7. `npx playwright test e2e/electron-main.spec.ts --project=electron`

**On request only — say what you skipped and why:**
- `npm run ui:capture && npm run ui:visual` — 20 UI screens (minutes; launches Electron)
- `npm run mutate` — mutation testing, ~27 min, currently 39.58% with 177 survivors
- `npm run verify:visual` — the 30–45 min visual sweep

Finish with a table: gate, pass/fail, and **what it would NOT catch**. That last
column matters more than the first — a green board that nobody can interpret is
how a green-forever gate survived here undetected.
