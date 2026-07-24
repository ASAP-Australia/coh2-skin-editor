---
name: verify-unwrap
description: Verify CoH2 skin-editor decal/national-insignia unwrap and faceplate rendering. Use when asked to verify unwrap, decals, skins, TEXCOORD1/TC1 badge placement, or faceplate rendering/export — runs the analytical + faceplate round-trip checks (fast, pure-Node), optionally the slow visual sweep, then summarizes PASS/FAIL per layer with the per-vehicle problem list.
---

# Verify unwrap (decals + faceplate)

This project has a three-layer verification suite for how vehicle national-insignia
decals unwrap onto the badge shader window (via TEXCOORD1 / "TC1") and how the
faceplate export pipeline survives its lossy BC3/DDS encode. Run the cheap layers
always; the visual sweep only on request.

All commands run from the repo root. Nothing here launches the app for the two fast
layers — they are pure Node. Only the optional visual sweep spawns Electron.

## Step 1 — Analytical check (ALWAYS run, fast, ~seconds)

Texel-exact TC1 verification of all 61 vehicles. No Electron/GPU. Parses each RGM
with the editor's own `parseRgm`, decodes TEXCOORD1 exactly as `rgm.ts` does, applies
the editor's gating, and tests whether the insignia decal lands in the badge shader
window.

```
npx tsx --tsconfig tsconfig.node.json scripts/verify-unwrap-analytical.mts
```

Writes `artifacts/verify-unwrap/analytical-results.json` + `analytical-report.md`.
Verdicts per vehicle: `RENDERS` / `MISSING` (bug) / `SMEAR-RISK` / `NO-TC1` (by design) /
`SKIPPED` (archive not found). Baseline is 61/61 RENDERS.

## Step 2 — Faceplate export round-trip (run, fast, ~seconds)

Composites a representative 692×204 faceplate atlas (image + text + shape layers),
encodes it with the ACTUAL export code (`encodeBc3` + `wrapBc3InDds` from
`src/lib/faceplate-mod-build.ts`), decodes it back with the app decoder (`decodeBc3`),
and compares per pixel. Also validates the DDS container (dimensions, `DXT5` FOURCC,
linearSize). Pure Node — the export encoder is pure JS, so this exercises the real
pipeline end-to-end with no unverified stages.

```
npx tsx --tsconfig tsconfig.node.json scripts/verify-faceplate.mts
```

Writes `artifacts/verify-unwrap/faceplate-results.json` + `faceplate-report.md`.
PASS requires mean per-channel delta ≤ 4/255 (whole atlas) AND max per-channel
delta ≤ 48/255 excluding hard-edge blocks AND exact DDS format.

## Step 3 — Visual sweep (OPTIONAL, SLOW ~30–45 min, spawns hidden Electron)

Only run this when explicitly asked for the full visual verification, or when the
analytical/faceplate layers surfaced something that needs pixel confirmation. It
renders every vehicle offscreen in Electron and golden-diffs the decal footprint.

```
npm run verify:visual
```

PID-HYGIENE WARNINGS (important):
- This spawns a HIDDEN Electron process. If it hangs or you interrupt it, the
  Electron process can linger. Find and kill it BY PID —
  `ps -eo pid,command | grep '[e]lectron'` then `kill <pid>`.
- NEVER `pkill -f electron` or any self-matching pattern — it can match unrelated
  processes (including your own tooling). Always target the specific PID.
- Do not run two sweeps concurrently; they contend for the offscreen renderer.

Writes `artifacts/verify-unwrap/visual-results.json` + `visual-report.md` and per-vehicle
PNGs/goldens under `artifacts/verify-unwrap/visual/` and `.../goldens/`.

If you only need to READ the last sweep verdict without re-running it (30–45 min),
just read `artifacts/verify-unwrap/visual-results.json` — do NOT re-run the sweep.

## Step 4 — Summarize

Read the three reports in `artifacts/verify-unwrap/`:
- `analytical-results.json` — `counts` {RENDERS, MISSING, SMEAR-RISK, NO-TC1, SKIPPED},
  `total`, and `results[]` (per-vehicle `verdict` + `evidence`).
- `faceplate-results.json` — `verdict`, `deltas`, `dds`, `thresholds`.
- `visual-results.json` (if the sweep was run) — `counts` {PASS, NO-DECAL, SMEAR,
  FLIPPED, DRIFT, LOAD-TIMEOUT}, `results[]`, `vflipFixed[]`.

Report PASS/FAIL per layer (analytical / faceplate / visual) and a per-vehicle
problem list: for the analytical layer, every vehicle whose verdict is MISSING,
SMEAR-RISK, or SKIPPED (with its `evidence`); for the visual layer, every vehicle
whose verdict is not PASS.

## Known anomaly — elefant (NOT a regression)

The `elefant` has degenerate point-cluster TC1 submeshes: some of its badge-cell
submeshes collapse to a near-zero-area point cluster in TEXCOORD1, which in the
VISUAL sweep light up as solid patches rather than a crisp badge. This is a known,
intrinsic property of that model's geometry — it is BASELINED in the elefant's
golden. Treat it as expected: it is only a problem if the golden-diff shows DRIFT
from that baseline. A solid-patch elefant that matches its golden is PASS, not a bug.

## MCP shortcut (optional)

The repo registers a `coh2-dev` MCP server (`.mcp.json` → `tools/coh2-dev-mcp/server.mjs`)
exposing `verify_unwrap_analytical`, `verify_faceplate`, and `verify_unwrap_visual_report`
(the last is READ-ONLY and does not run the slow sweep). If those tools are available in
your session you can call them directly instead of the shell commands above.
