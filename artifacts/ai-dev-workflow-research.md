# AI-assisted development stack for the CoH2 Modding Tool
*Research synthesis, 2026-07-18. Sources: deep-research run (claims marked ✅ = adversarially verified 3-0; ⚠️ = sourced but verification incomplete due to usage cap) + first-hand findings from this project's own sessions (marked 🔧 = proven here).*

## 1. Tools — adopt now vs later

### Adopt now
| Tool | Why | Key facts |
|---|---|---|
| **Real-browser dev workflow** (already built) | The whole app — 3D viewport included — runs in a plain browser tab via `npm run dev` + the `/__coh2` dev bridge; WebGL works there, unlike the Claude Desktop preview webview (GPU disabled — 🔧 proven twice). | Zero-click auto-connect already implemented. HMR = instant review of Claude's edits without AppImage rebuilds. |
| **Claude-in-Chrome MCP** | Lets Claude see/drive the SAME browser tab the human watches — shared visual ground truth with WebGL. | Already available in this environment. |
| **Storybook + its official MCP server** | ✅ Official MCP server lets agents understand components, generate stories, run interaction + a11y tests, and self-heal (fix → re-run → confirm) without human intervention. ✅ Claude Code is an explicitly supported client. | ⚠️ Constraint (✅ verified): Development + Testing MCP tools ONLY work with a LOCAL Storybook dev server; the Chromatic-hosted `/mcp` route serves Docs tools only. Componentize the Konva editors' UI chrome first. Sources: storybook.js.org/docs/ai/mcp/overview, chromatic.com/docs/mcp |
| **Playwright for Electron E2E** | ✅ Playwright always launches Electron headfully; headless CI = wrap in Xvfb. ✅ Electron cannot start on displayless CI without it; `DISPLAY` env + Xvfb is the official fix, no app changes needed. | ✅ Gotcha: `xvfb-run` can fail with Playwright-Electron; the working pattern is a persistent server: `export DISPLAY=:99; Xvfb :99 -screen 0 1920x1080x24 &`. Locally (Wayland/XWayland) no Xvfb needed. Sources: electronjs.org testing-on-headless-ci, playwright#2609 |
| **Vitest in the deploy gate** | The tsc → build → atomic-deploy gate exists; add `vitest run` so a red test can never ship. | 🔧 Gate already scripted in this project. |

### Adopt later
- **Visual regression for the 3D viewport** — the existing `AUDIT_REAL` harness (deterministic per-vehicle captures via `capturePage`, fixed camera) is ~80% of a golden-screenshot suite; add pixelmatch/odiff diffing as a Vitest task. Hosted options (Chromatic/Percy/Lost Pixel) only if cloud baselines are wanted.
- **Claude Code GitHub Actions / CodeRabbit CI review** — ⚠️ Anthropic teams run Claude as an automated PR reviewer; only relevant once this repo pushes to GitHub CI.
- **electron-test-mcp** — ⚠️ MCP server driving Electron via Playwright incl. a CDP connect mode that attaches to an already-running app; our raw CDP rig already covers this, so it's a convenience upgrade.
- **Figma/design-context MCP** — ⚠️ Anthropic's design team feeds Figma files straight to Claude Code; only if design work moves into Figma.
- **Computer-use agents for desktop driving** — 🔧 proven slow/expensive/fragile here (CoH2 harness sessions); prefer deterministic scripts that Claude authors.

## 2. Production-workflow patterns worth copying
1. **Machine-checkable verification signal** (⚠️ Anthropic's core discipline): give Claude a pass/fail it can check itself — tests, build exit codes, linters, screenshot-vs-design — which converts supervised sessions into autonomous ones. Extend our gate with vitest + screenshot diffs.
2. **Give Claude eyes** — ⚠️ screenshot-driven iteration loops are the recommended UI workflow; 🔧 we already do this via CDP `Page.captureScreenshot` / `capturePage`.
3. **CLAUDE.md short, curated, durable** — ⚠️ Anthropic teams use CLAUDE.md as machine-readable onboarding docs. Ours + the llm-wiki already fill this role; keep pruning.
4. **Hard gates via hooks** — enforce "no deploy on red" mechanically (Claude Code hooks), not by convention.
5. **Deterministic tests stay deterministic; the agent explores** — ⚠️ Slack's agent-E2E finding: use the agent to author/triage tests, not to be the test runner per-run (cost/latency).
6. **Plan-driven multi-stage builds with filesystem handoffs** — 🔧 groundwork → synthesis plan → one-shot implementation; already this project's standard for big changes.

## 3. Recommended "mission control" architecture
**One real browser window, split from the chat:**
1. **Tab 1 — the live app**: `npm run dev` → localhost:5173 (WebGL works; auto-connects; HMR shows Claude's edits live). Electron-only paths (native fs, Steam) still verified in the dev Electron window / deployed AppImage via the CDP rig.
2. **Tab 2 — dashboard page** served by the same Vite server: latest Vitest JSON results, tsc status, last build/deploy timestamp (deploy script writes `status.json`), and Claude's latest verification screenshots. Small build (~an afternoon with Claude).
3. **Tab 3 — Storybook** (once componentized): the human reviews components; Claude runs the local Storybook MCP self-heal loop.
4. **Claude attached to the same tabs** via Claude-in-Chrome MCP (primary) or CDP screenshots of the dev Electron window (Electron-specific checks).
5. **HLS/PipeWire streaming rig**: reserved for "watch Claude drive a live app" moments; off by default (🔧 leak lesson).

**Trade-offs:** browser tab ≠ Electron runtime (keep the AppImage as release gate); Storybook needs upfront componentization; local pixel-diff means maintaining baselines; hosted visual regression adds cost/accounts.
