# AI-Engineering Toolchain — research report

Generated 2026-07-27 by a 20-agent research workflow (1.9M tokens, 868 tool calls).
Every recommendation was adversarially verified: fetch the cited URL, confirm the page
names the tool, check the exact package name, check it is still maintained, and default
to REFUTED when uncertain. Section 3 lists what did not survive.

Tracks: 8 · recommendations kept: 93 · refuted: 6

---

# Becoming a serious engineer with Claude Code — for the CoH2 Community Modding Tool

Everything below was checked against your actual repo or against a URL I fetched. Where I could not verify, I say UNVERIFIED. Three claims that circulated during research turned out to be wrong about your repo and are corrected in §3.

**First, a correction to the premise you were given.** You already have more infrastructure than you're being credited with. `/var/home/jflessenkemper/dev/coh2-skin-editor/.github/workflows/` has 14 workflows including `accessibility.yml`, `bench.yml`, `size-limit.yml`, `codeql.yml`, `gitleaks.yml`, `osv-scanner.yml`, `scorecard.yml`, `native-lint.yml`. Accessibility, perf benchmarking and bundle budget are already gated. You do not need tools for those.

What you're missing is not breadth. It's four specific things: **a habit, a build stamp, a persistent memory in-repo, and one mechanical test-power check.**

---

## 1. Start here — the 5 changes with the highest leverage

### #1 (a HABIT, not a tool) — Never trust an instrument until you've shown it can report a different answer

This is first because it covers five of your seven failure modes and costs nothing to install.

| Failure | The negative control that was missing |
|---|---|
| FM1 test that couldn't fail | never ran the test **red** |
| FM2 thresholds 5–12x loose | never measured the **unrelated-pair floor** |
| FM3a screenshots 2x dark | never pushed a **known-brightness swatch** through the same capture path |
| FM3b camera no-op | never checked the **output hash moved** |
| FM5 layers invented ad hoc | no layer had a **stated falsifier** |

All four are the same move on four surfaces: *change the thing the instrument measures, prove the instrument's answer changes.*

**First artifact** — six lines, dropped into the CLAUDE.md you create in #3:

```
## Instrument rule (non-negotiable)
No measurement is trusted until the instrument is shown to discriminate.
- New/changed test: paste the RED run before the fix. No red run shown = not verified.
- New threshold: paste the measured unrelated-pair baseline AND the self-vs-self sanity row.
- Render/capture claim: paste the pre- and post-change output hashes. Identical md5 = the change did nothing, however correct the wiring looks.
- Every verification result ends with a "Not proven by this work:" section.
```

That last line is you generalising your own retroactive discovery ("SCOPE — proves COLOUR TRANSPORT only"). Making it a required field turns a lesson into a form.

**Time: 10 minutes to write. Prevents: FM1, FM2, FM3, FM5.**

---

### #2 — Stamp the build into the binary. This is the one-line fix for failure mode 7.

I verified: `grep -rn "app.getVersion\|APP_VERSION\|BUILD_SHA" src/ electron/ vite.config.ts` returns **nothing**. Your app displays no version anywhere. Meanwhile `.github/ISSUE_TEMPLATE/bug.yml:48-50` has `id: version`, `label: Version`, `required: true` — **your bug report form demands a version number your application does not display.**

Three separate research tracks proposed three pieces of machinery to detect stale deploys (a Stop hook running sha256sum, a plugin `monitors/monitors.json` poller, a `Monitor` tool watch). A string in the title bar makes the condition self-evident, permanently, in every screenshot, for every user.

**First edit** — `vite.config.ts`:

```js
import { execSync } from 'node:child_process'
// ...
define: {
  __BUILD_SHA__: JSON.stringify(execSync('git rev-parse --short HEAD').toString().trim()),
  __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
}
```

Vite's docs: entries are "defined as globals during dev and statically replaced during build" and values "must be a string that contains a JSON-serializable value" (https://vite.dev/config/shared-options). Render `v1.1.0 · <sha> · <date>` in the window title, the About surface, and `console.log` it from the Electron main process on boot.

**Time: 30-60 min. Prevents: FM7 outright, and half of FM3 — every agent screenshot becomes self-dating.**

---

### #3 — A project CLAUDE.md, plus `.claude/rules/` for the long material

Verified: `ls -a .claude/` returns exactly `launch.json`, `settings.local.json`, `skills`, `worktrees`. **No CLAUDE.md, no rules/, no agents/, no hooks/, no commands/.** Your invariants reach a session only through the llm-wiki injection, and `.llm/` is gitignored so a slice of them is machine-local.

Two mechanisms, and it matters which you use for what (both from https://code.claude.com/docs/en/memory):

- **CLAUDE.md** — ~40 lines, loaded unconditionally every session. Only rules whose absence causes mistakes. Put here: the instrument rule from #1, the deploy ritual, the pkill rule, the layer A–E taxonomy in one sentence each.
- **`.claude/rules/*.md` with `paths:` frontmatter** — loaded *only when Claude reads a matching file*. This is where `RENDERING.md`-scale material goes.

Do **not** use `@path` imports for the big documents. The docs are explicit that imported files load at launch and enter the context window — imports organise, they do not defer. Only `paths:`-scoped rules actually defer loading.

**First command:** `/init` in the repo, then prune hard. Confirm with `/context` that it loaded under "Memory files."

**Time: 45 min. Prevents: FM6.**

---

### #4 — Fix the pkill problem at the cause, then add the guard

Three research tracks want to block `pkill`. Blocking alone makes it worse: the reason `pkill -f` got reached for is that a 30–45 min sweep spawns hidden Electron, gets interrupted, and leaves orphans **with no recorded PID**. Remove the blunt tool without giving a sharp one and orphans accumulate.

**Cause fix (do this first):**
- Run long jobs with the Bash tool's `run_in_background: true`, then tear down with `TaskStop` by task ID — targets a tracked task, not a pattern (https://code.claude.com/docs/en/tools-reference).
- In `scripts/run-verify-visual-all.sh`, launch Electron under `setsid`, capture the PGID, and `trap 'kill -- -$PGID' EXIT`. Now teardown is exact.

**Guard (second):** add to a new `.claude/settings.json` (verified: you have **zero** deny rules anywhere):

```json
{"permissions":{"deny":["Bash(pkill *)","Bash(pgrep -f *)"]}}
```

Deny is evaluated before allow and cannot be overridden. But it is **not sufficient alone** — the docs state prefix rules match the literal command string, so `Bash(rm *)` does not block `/bin/rm` or `find -delete` (https://code.claude.com/docs/en/debug-your-config). Same hole applies to `/usr/bin/pkill` and `bash -c 'pkill …'`. Pair it with a `PreToolUse` hook on `Bash` that regexes `.tool_input.command` and returns `permissionDecision: "deny"` — which blocks even under `--dangerously-skip-permissions` (https://code.claude.com/docs/en/hooks-guide).

Do **not** expect the Bash sandbox to help here. I found no documentation that it blocks signals to processes; it isolates filesystem and network. Recommending it for FM4 would repeat exactly the error you were burned by.

**Time: 45 min. Prevents: FM4.**

---

### #5 — StrykerJS, scoped to the six binary codec files only

This is the only thing in a JS toolchain that mechanically answers *"can this test fail?"* — the exact hole behind FM1. It rewrites production code one mutant at a time and re-runs tests; a surviving mutant is a test that cannot discriminate.

Do **not** point it at 134 test files. Point it at the code where byte-correctness is load-bearing:

```
src/lib/rgt.ts  rgt-core.ts  rgt-writer.ts  sga.ts  sga-writer.ts  rgm.ts  bc-encode.ts  bc-decode.ts
```

```bash
npm i -D @stryker-mutator/core@9.6.1 @stryker-mutator/vitest-runner@9.6.1
```

Both published 2026-04-10; the vitest-runner declares `peerDependencies {vitest: ">=2.0.0"}`, so your vitest 3.2.4 needs no upgrade. The runner force-overrides pool/threads/coverage in your Vitest config, so `vitest.config.ts` needs no change.

**Before you run it, measure how long `npm run test` actually takes.** That number governs whether Stryker (and Stop-hook gates, and agent reviewers) is viable at all. Nobody measured it, including me — I didn't want to burn 2231 tests of wall clock in a read-only pass.

**Time: 1-2 h for the first scoped run. Prevents: FM1, mechanically.**

---

## 2. The toolchain, by layer

### (a) Verification and testing

| Tool | What | Install | Rating |
|---|---|---|---|
| **StrykerJS** (`@stryker-mutator/core` + `@stryker-mutator/vitest-runner`) | Mutation testing — finds tests that cannot fail | `npm i -D @stryker-mutator/core@9.6.1 @stryker-mutator/vitest-runner@9.6.1` | **CORE** |
| **Playwright `_electron.launch()`** | Drives the actual Electron app, and can evaluate in the **main process** — where your IPC and N-API addon live | already have `@playwright/test`; add a spec using `_electron` (https://playwright.dev/docs/api/class-electron) | **CORE** |
| **ASan/UBSan build of the native addon tests** | Catches memory errors in C++ that clang-tidy cannot see | `-fsanitize=address,undefined` in a debug `binding.gyp` target | **CORE** (see below) |
| **`verify:visual` in CI** | Your biggest verification gap is that it *has no trigger* | see below | **CORE** |
| **Electron `crashReporter`, local-only** | `uploadToServer: false` → "crash reports will be collected and stored in the crashes directory, but not uploaded"; redirect with `app.setPath('crashDumps', …)` (https://www.electronjs.org/docs/latest/api/crash-reporter) | built into Electron, no dependency | **CORE** |

**The ungated script is the one that matters.** I grepped: `verify:visual`, `verify:visual:capture/diff/build`, `audit:capture`, `audit:faithful` appear in **zero** workflows. Every cheap check is gated (`lint`, `typecheck`, `test:coverage`, `e2e` at `ci.yml:103`, `a11y`, `bench`, `size`, `knip`, `lockfile:lint`). The layered verification architecture — the thing your whole llm-wiki exists to protect — is the one thing with no automated trigger. Gate the cheap layers (A analytical, B faceplate round-trip) on push; leave the 30–45 min visual sweep on-request. That split is already encoded in your `verify-unwrap` skill.

**The native addon is the least-defended surface, and it is not what you were told.** `native/coh2-workshop/src/workshop_addon.cpp:75-79` exports exactly five functions: `publishNewItem`, `updateExistingItem`, **`deletePublishedItem`**, `startCallbackPump`, `stopCallbackPump`. This is the Steam Workshop publish/update/**delete** path — irreversible remote operations against a user's Steam account, in C++, with 3 unit tests. `codeql.yml:22` runs `languages: javascript-typescript` only. `grep -rn "fsanitize\|ASAN\|valgrind"` across `native/`, `.github/`, `package.json` returns **nothing**. The answer here is sanitizers and a confirm-before-delete guard, not editor autocomplete.

### (b) Claude Code configuration

| Item | What | How | Rating |
|---|---|---|---|
| **CLAUDE.md + `.claude/rules/`** | See §1 #3 | `/init`, then prune | **CORE** |
| **`permissions.deny` + `PreToolUse` hook** | See §1 #4 | `.claude/settings.json` | **CORE** |
| **`verification-auditor` subagent** | Fresh context audits the evidence; the worker is never the grader | `.claude/agents/verification-auditor.md`, `tools: Read, Grep, Glob, Bash` | **CORE** |
| **`isolation: worktree` on that agent** | Runs in a temp git worktree; cannot corrupt your tree. `.claude/worktrees/` already exists and is unused | frontmatter field (https://code.claude.com/docs/en/sub-agents) | **CORE** |
| **`/goal`** | A *separate model* evaluates a completion condition each turn, and the condition can carry constraints like `and no file under artifacts/verify-unwrap/goldens is modified` | `/goal <condition>` (https://code.claude.com/docs/en/goal) | **CORE** |
| **`Stop` hook, `type: "command"`** | Deterministic turn gate. Prefer command over agent hooks — the docs mark agent hooks experimental | `.claude/settings.json` | **USEFUL** |
| **`hookify`** (official plugin) | Turns natural-language rules into real hooks | `/plugin install hookify@claude-plugins-official` | **USEFUL** — a faster path to #4's guard if you'd rather not hand-write it |
| **`typescript-lsp`** (official plugin) | Real diagnostics after every edit instead of end-of-session `tsc`. Maps `.mts` — which is your entire verification harness | `npm i -g typescript-language-server` **first**, then `/plugin install typescript-lsp@claude-plugins-official` | **USEFUL** |
| **`clangd-lsp`** (official plugin) | Same for the C++ addon | Fedora `clang-tools-extra`; add `compile_commands.json` | **USEFUL** |
| **`autoMemoryDirectory`** | Auto memory is ON by default and writing an uncurated parallel store your `/wiki-lint` never sees | `/memory` to inspect; then either `autoMemoryEnabled: false` or point it into `~/llm-wiki/` | **USEFUL — decide deliberately** |
| **`/context`, `/permissions`, `/hooks`, `claude --debug hooks`** | Everything above is only real if it loaded. A `matcher` given as a JSON array rejects the whole settings file; lowercase `"bash"` never matches | run them in that order after writing settings (https://code.claude.com/docs/en/debug-your-config) | **CORE** |

On the auditor's prompt: include an explicit **"what NOT to flag"** section. The docs warn that "a reviewer prompted to find gaps will usually report some, even when the work is sound." Cloudflare runs this shape at 131,246 reviews/month with a deliberate 1.2 findings per review and a coordinator judge pass (https://blog.cloudflare.com/ai-code-review/). One well-bounded auditor, not fourteen.

### (c) MCP servers

| Server | What | Install | Rating |
|---|---|---|---|
| **chrome-devtools-mcp** | First-party Chrome DevTools MCP; attaches to a **running** browser via `--browser-url=http://127.0.0.1:9222`. Electron supports `--remote-debugging-port` (https://www.electronjs.org/docs/latest/api/command-line-switches) — and your `electron:dev` script already passes it. Text-based `take_snapshot` / `evaluate_script`, no screenshots, which matches your rule about the shader canvas hanging capture | `claude mcp add chrome-devtools --scope user npx chrome-devtools-mcp@latest -- --browser-url=http://127.0.0.1:9222` | **CORE** |
| **Context7** | Version-specific library docs — Three.js, Konva, electron-builder 26, vitest 3.2.4, zod 4 are exactly where a model confabulates | `claude mcp add --scope user --transport http context7 https://mcp.context7.com/mcp` | **CORE** |
| **Serena** | LSP-over-MCP: `find_referencing_symbols`, `find_symbol`, symbol-level edits. Genuinely answers "does this test import the real helper or a local mirror?" — which is `decal-scope.test.ts`'s actual bug | `uv tool install -p 3.13 serena-agent`; then `claude mcp add serena -- serena start-mcp-server --context claude-code --project "$(pwd)" --open-web-dashboard False` | **USEFUL** |
| **GitHub MCP, read-only, security toolsets** | Lets the agent read CodeQL / OSV / gitleaks / Scorecard / Dependabot findings, which currently sit unconsulted in the GitHub UI. Also makes `actions` queryable | `docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server --read-only` | **USEFUL** |
| **Sentry MCP + `@sentry/electron`** | Only if you want hosted crash reporting. Two-step: instrument first, MCP is the read half | see §3 — try local `crashReporter` first | **MARGINAL** |

**Caveat on chrome-devtools-mcp:** issue #1197 records that v0.20.1 broke all Electron attachment (`Protocol error (Target.getDevToolsTarget)` — Electron doesn't implement that CDP command). The issue is closed and npm latest is 1.6.0, but **verify one tool call succeeds against your AppImage before trusting it.** Also note the debug port is unauthenticated while open.

**Budget these.** chrome-devtools-mcp alone ships 52 tools whose definitions load into every context window, on top of `repomix` and `kwin` already registered in `~/.claude.json`. The instrument for measuring this: `CLAUDE_CODE_ENABLE_TELEMETRY=1` with `OTEL_METRICS_EXPORTER=console` emits `claude_code.cost.usage` (USD) and `claude_code.token.usage`, attributed by `query_source` = `"main"` / `"subagent"` / `"auxiliary"` (https://code.claude.com/docs/en/monitoring-usage). That last attribute is the whole argument — it's the only way to find out whether your subagents earn their spend.

### (d) CI/CD and release

| Tool | What | Rating |
|---|---|---|
| **`verify:visual` (cheap layers) as a workflow** | The gap identified above | **CORE** |
| **ASan job in `native-lint.yml`** | You have static C++ analysis, zero runtime | **CORE** |
| **`electron-updater` 6.8.9** (MIT, part of electron-builder — https://registry.npmjs.org/electron-updater/latest) | Failure mode 7 is not a dev-laptop problem, it's your **shipped product's permanent problem**. Public MIT repo, `electron-release.yml` ships AppImages, zero update channel | **USEFUL.** AppImage-specific update behaviour: UNVERIFIED, check electron-builder's auto-update docs before committing |
| **`anthropics/claude-code-action@v1`** | Runs *your own skill* in CI on a `schedule:` trigger — e.g. nightly `/verify-unwrap`. Not generic PR review | **USEFUL** |
| **`claude --bare -p` with `--json-schema`** | Turns a judgement check into a scriptable gate: output `{"gate":"PASS|FAIL","measuredBaseline":n,"noiseFloor":n}` so a report *cannot* omit the baseline | **USEFUL** |

### (e) Code quality and security

Mostly done. `codeql.yml`, `gitleaks.yml`, `osv-scanner.yml`, `scorecard.yml`, `dependency-review.yml`, `knip.yml`, `lockfile-lint.yml`, `native-lint.yml`, `html-validate.yml` all exist and gate. The gaps are (i) CodeQL covers JS/TS only while the irreversible-operation code is C++, and (ii) the agent can't read any of these findings without the GitHub MCP.

**One thing nobody is watching:** `artifacts/` is 1.8 GB, `.git` is 100 MB, 108 tracked binary files (`.sga`/`.dds`/`.png`), no `.gitattributes`, `git-lfs` not installed. A byte-correctness project accumulating golden binaries in plain git has a clock on it. Also worth a deliberate decision: the licensing status of game-derived data in a **public** repo.

### (f) Stack-specific

- **`_electron.launch()` in your existing Playwright suite** — your 8 specs run against `vite preview`; Electron is untested end-to-end. This is the real e2e gap.
- **`pr-review-toolkit`** (official plugin) — of its six agents, three map onto your documented failures: `comment-analyzer` (your `applyTemplate()` comment that claimed to respect `templateScope` while ignoring it), `silent-failure-hunter` (the byte-identical camera), `pr-test-analyzer`. Honest limit: these are LLM judgements. They will not prove a test *can* fail. **USEFUL.**
- **i18n** — zero deps, zero mentions. CoH2's modding community is heavily German/Russian/Polish/Chinese. Not urgent, but it's an architectural fork that costs 10x once 134 test files harden English strings. Decide to defer it explicitly rather than by default.

---

## 3. What NOT to bother with

**Refuted during verification:**

- **`lua-lsp` + "Fedora package `lua-language-server`".** No such Fedora package exists — three independent checks agree (`src.fedoraproject.org` 404, dist-git API `total_projects: 0`, mdapi 400 on f43/f44/rawhide). And the premise fails on disk: one `.lua` file in the whole repo, a game-extracted artifact, not authored SCAR. This is precisely the "confidently-named package that produces *No match for argument*" failure you warned about.
- **The Bash sandbox as the fix for `pkill`.** No documentation says it blocks signals. Filesystem and network only.
- **`permissions.deny` alone for `pkill`.** Prefix rules match the literal string, not the executable.
- **"You have no accessibility / perf / bundle gates."** You do — `accessibility.yml` (`npm run a11y` → `scripts/a11y-axe.mts`, plus `pa11y-ci` and `e2e/a11y.spec.ts`), `bench.yml` (`vitest bench --run`, `src/lib/__tests__/perf.bench.ts`), `size-limit.yml`. This claim was made confidently by research that never read the workflow filenames.
- **"The native addon writes SGA/RGT output."** It doesn't. It's the Steam Workshop publish/delete path.
- **"Serena's find-references would have caught the camera bug."** It wouldn't. The override *was* called; it produced a byte-identical render. Find-references returns the call site and confirms "wired up correctly" — the exact wrong conclusion you already reached. Serena is a good tool; that justification is fabricated. Adopt it for the local-mirror-vs-real-helper question instead.

**Deliberately rejected:**

- **Write-locking test files (`Edit(**/*.test.ts)` in `deny`).** This is the most persuasive-sounding recommendation in the corpus because it cites a measured effect size — but it's a category error. ImpossibleBench measures agents *cheating*: given a spec/test conflict, the agent deletes the failing test. **FM1 was not cheating.** The test was written honestly and lacked the context that triggered the bug. A write-lock does nothing to a test that was always going to pass, and it actively blocks the correct remediation, which is repairing the test. (The cited per-model rates come from a LessWrong summary, not the paper.) Use Stryker instead — it targets the actual defect.
- **DeepWiki MCP.** AI-generated summaries of code, recommended to someone whose operating rules are "Never Guess" and a mandatory `file:line` citation contract. Its own advocates concede "treat outputs as leads to verify."
- **Grep MCP / grep.app.** "Read a dozen real BC1/BC3 encoders first" is a licence-contamination path into a public MIT repo and a source of plausible-looking wrongness. Nothing in your seven failure modes says you lacked examples.
- **Generic image-diff MCP servers.** Your own wiki forbids these by name — `scripts/compare-render.mts` already does SSIM + edge-IoU + hue-histogram against a *measured* unrelated-pair baseline. No off-the-shelf server ships a calibrated baseline, which is the entire point of FM2.
- **`microsoft/playwright-mcp`.** Excellent, but you already own `@playwright/test` 1.60, and it doesn't solve your Electron gap (issue #994 closed with no resolution).
- **Ghidra MCP.** Decompiles executables. Your binary problem is *authoring* correct data files.
- **Memory / knowledge-graph MCP servers, and Beads.** You already run llm-wiki with hooks, a 25 kB schema, contradiction callouts, and a citation contract. A third store means three places a fact can go stale.
- **Filesystem MCP.** Redundant with Read/Glob/Grep, and routes file access *around* the permission model you're tightening.
- **Any database MCP.** No database.
- **Meta-plugins (`plugin-dev`, `skill-creator`, `mcp-server-dev`, `claude-md-management`).** Four tools for building Claude Code artifacts, for a solo dev with one shipping product. This is the toolchain becoming the project. `claude-md-management` specifically maintains a file you don't have yet — write the first CLAUDE.md by hand.
- **`security-guidance`.** Kept in research at "marginal" with the stated value *"it's a working reference implementation of a Stop hook."* Read the file on GitHub; don't install v2.0.6 for that.
- **`laurigates` testing-plugin.** Its own recommendation is "install Stryker directly." Do that. It's also outside Anthropic's safety screening, and plugins execute arbitrary code with your privileges.
- **`type: "agent"` Stop hooks.** Documented as experimental; the docs say prefer command hooks for production. A deterministic command hook is strictly better for a gate.
- **Fan-out to 14 parallel reviewers.** Cloudflare's economics ($0.98 median × 131k reviews) is an org budget, not a 5-hour usage window.
- **AGENTS.md instead of CLAUDE.md.** Real format, but buys cross-tool portability you don't need. Symlink later if you add a second agent.
- **ADRs in `docs/adr/`.** Your wiki concept pages already do more — status/confidence frontmatter, `file:line` citations, disproved-hypothesis entries, contradiction callouts.
- **Full GitHub Spec Kit.** Borrow the `/speckit.checklist` idea ("unit tests for English"); skip the ceremony. Claude Code support: UNVERIFIED — the integrations page 404s and the repo's AGENTS.md enumerates other agents' paths without naming Claude Code's.
- **`--dangerously-skip-permissions`.** Nullifies the deny rules that are the highest-value fix here.
- **The Discover tab.** Of 273 official marketplace entries, most are vendor MCP wrappers for SaaS. Zero fit for a local binary-format desktop app.

**Already installed / already available:** `frontend-design@claude-plugins-official` (enabled on this machine); `/review`, `/simplify`, `/security-review` (in this harness — installing plugin equivalents duplicates them and adds per-turn context cost).

**Note:** `mcp__kwin__*` is registered in `~/.claude.json` but disabled with a connection error. `/mcp` will show it explicitly.

---

## 4. The discipline — practices no tool gives you

**1. State the negative control before you measure, not after.** §1 #1. Grounded in FM1, FM2, FM3a, FM3b, FM5 — five of seven.

**2. Every verification result ends with "Not proven by this work."** You discovered this retroactively after Layer C ("proves COLOUR TRANSPORT only"). Retroactive scoping means the claim gets trimmed to fit the verification; writing it in the spec means the verification is designed against a bounded claim. Grounded in FM3, FM5.

**3. The worker never grades the work.** The nested-compositor darkening (mean 28 vs 51) and the byte-identical camera both survived because the context that produced the change also evaluated it. Fresh context, read-only tools, holding your instrument rules as explicit pass/fail checks. Grounded in FM3.

**4. Author the test in a different session than the implementation.** FM1's root cause: the test was authored by a context that knew the implementation, so it asserted what the code *did* rather than what the requirement *was*. `claude --worktree test-guard` writes the failing test from the bug report and must show it red; a second session implements. This is the automated form of your manual protocol at `coh2-editor-pack-scope.md:56`. Carry your own rule into the prompt: *import the real helpers, never assert against a local mirror* — `decal-scope.test.ts` proved a mirrored copy cannot catch production regressions.

**5. Spend the time on the plan, not on watching the implementation.** Both FM1 and FM2 originate before any code exists. A test that cannot fail is a specification error; a threshold 5–12x too loose is a planning error. Neither is recoverable by reviewing a diff. Use plan mode (`Shift+Tab`), `Ctrl+G` to edit the plan by hand, and add "measure the unrelated-pair baseline first" as a plan step before approving.

**6. Ask "what are you least confident about?" — then convert each answer into a check that can fail.** The answer is a *lead*, not a verdict. The calibration literature is consistent that verbalized confidence doesn't reliably predict correctness (directionally supported — I read search summaries of arXiv 2409.18786, not the full paper). Never let a stated confidence level substitute for a check.

**7. Turn each incident into a tripwire, with a cost attached.** Your seven failure modes are documented as *findings*, not as *hours lost* + *check added*. That's why "measure baselines" had to be re-learned after both the too-loose *and* the too-tight calibration. One line per incident: what it cost, what now catches it.

**8. Adopt a stopping rule for tooling.** You were handed 43 recommendations across four research tracks with no ordering and no dedup — including three mutually-contradicting answers to the `pkill` problem. The failure mode is adopting twelve, measuring none, and ending up with a slower inner loop and more config to debug. **Adopt one thing per day; each one must end with something you watched work.** That's §5.

---

## 5. A concrete 1-week adoption plan

**Day 1 — the habit and the stamp (2 h).**
Write the six-line instrument rule somewhere you'll see it. Add `define: { __BUILD_SHA__, __BUILD_TIME__ }` to `vite.config.ts`, render it in the window title and log it from the main process. Run `npm run electron:build`, install to `~/.local/bin`, launch it.
**Verifiably working:** the title bar shows a SHA that matches `git rev-parse --short HEAD`. Failure mode 7 is dead.

**Day 2 — memory in the repo (2 h).**
`/init`, prune to ~40 lines, move `RENDERING.md`-scale material into `.claude/rules/*.md` with `paths:` frontmatter. Also run `/memory` and decide what to do about auto memory — redirect it into `~/llm-wiki/` or disable it per-project. Two knowledge stores is fine; two *uncurated* ones is not.
**Verifiably working:** `/context` lists your CLAUDE.md under "Memory files," and a rule file appears only after Claude reads a matching source file.

**Day 3 — the pkill class, cause then guard (2 h).**
Add `setsid` + PGID + `trap` teardown to `scripts/run-verify-visual-all.sh`. Then create `.claude/settings.json` with the deny array and a `PreToolUse` hook script.
**Verifiably working:** `claude --debug hooks`, attempt a `pkill`, watch it denied with your reason string. Then start `verify:visual` in the background and kill it via `TaskStop` — confirm no orphan Electron processes with `pgrep -a electron` (note: `pgrep -a`, not `-f`).

**Day 4 — measure, then mutate (3 h).**
First: time `npm run test`. Write the number down; it governs everything below. Then install Stryker scoped to `src/lib/{rgt,rgt-core,rgt-writer,sga,sga-writer,rgm,bc-encode,bc-decode}.ts`.
**Verifiably working:** a mutation score, and at least one **surviving mutant** in the codec code — a concrete, named test that cannot fail. That is FM1, found mechanically for the first time.

**Day 5 — the adversarial auditor (2 h).**
Create `.claude/agents/verification-auditor.md` with `isolation: worktree`, `tools: Read, Grep, Glob, Bash`, and a body encoding your instrument rules as pass/fail checks (sanity row present? gate above measured baseline? both sides cropped? `-alpha off`? per-channel not luminance? brightness via `capturePage`, never `import` through the nested session? claimed scope ≤ measured scope?) plus an explicit "what NOT to flag."
**Verifiably working:** point it at a past verification run you know had a scope problem and confirm it names it. If it flags six things on sound work, tighten the "what NOT to flag" section — over-reporting is the documented failure of this pattern.

**Day 6 — Electron actually under test (3 h).**
One Playwright spec using `_electron.launch()` against the built app, evaluating in the **main process**. Assert one thing in the Steam Workshop path — ideally that `deletePublishedItem` requires an explicit confirmation flag. Separately, add a debug `binding.gyp` target with `-fsanitize=address,undefined` and run the 3 existing native tests under it.
**Verifiably working:** an e2e test that fails if you break the Electron main process, and an ASan run that either comes back clean or hands you a real bug in the delete path.

**Day 7 — give the verification architecture a trigger (2 h).**
Add a workflow running the cheap verification layers (A analytical, B faceplate round-trip) on push. Leave the visual sweep on-request. If you want the sweep automated, use `anthropics/claude-code-action@v1` on a `schedule:` trigger invoking `/verify-unwrap` after `actions/checkout`, capped with `claude_args: "--max-turns 5"`.
**Verifiably working:** push a deliberate one-byte regression in `rgt-writer.ts`, watch CI go red, revert.

**Then stop and run for two weeks.** Turn on `CLAUDE_CODE_ENABLE_TELEMETRY=1` with `OTEL_METRICS_EXPORTER=console` and look at `claude_code.cost.usage` split by `query_source` before you add MCP servers or more subagents. Adopt Context7 and chrome-devtools-mcp only when you hit the specific pain they solve — a hallucinated Three.js API, or a bug that only reproduces in the deployed AppImage.

**Explicitly deferred, with dates you should revisit:** `electron-updater` (before the next public release), fixture storage / `git-lfs` (when `.git` passes ~250 MB), i18n (before the next big string-heavy feature), Serena (when you next need to answer "does this test import the real helper?" across 134 test files).


---

# Appendix — completeness critique

# COMPLETENESS CRITIQUE

## 0. The meta-failure, first, because it invalidates the ranking

The brief said: *"A short list the user will actually adopt beats forty tools they will not."* The four tracks returned **43 `kept` items** (11 + 14 + 7 + 10 + ≥1), **~25 marked `core`**, with no ordering, no stopping rule, and no dedup. Four tracks independently recommend the same four things:

| Thing | Recommended by | Conflicting instructions? |
|---|---|---|
| Project CLAUDE.md | tracks 1, 2, 4 | yes — `@`-imports (t4) vs. `.claude/rules/` with `paths:` because "@ imports do NOT save context" (t2) |
| Block `pkill -f` | tracks 1, 2, 4 | yes — hookify (t1) vs. deny+hand-written hook, *explicitly arguing hookify-shaped prose is insufficient* (t2) vs. deny list (t4) |
| Stop hook | tracks 2, 4 | yes — t2 puts agent hooks in `notRecommended` ("prefer command hooks"); t4 recommends `"type":"agent"` as core |
| TS language server | tracks 1, 3 | undetected — `typescript-lsp` plugin and Serena both stand up `typescript-language-server` |
| Adversarial reviewer | tracks 1, 2, 4 | four near-identical agents: pr-review-toolkit, test-discriminator, verification-auditor, `/goal` |

The user receives a 43-item list containing three mutually-contradicting answers to one shell foot-gun. That is not a toolchain; that is a backlog.

**And nobody ran two commands.** `ls .github/workflows/` and `node -e 'Object.keys(pkg.scripts)'`. I ran them. Consequences below.

---

## 1. Categories with zero coverage — corrected against the actual repo

Three of the categories the prompt asks about **are already covered in the repo, and all four tracks missed it**, then recommended things around the gaps they invented:

- **Accessibility**: `/var/home/jflessenkemper/dev/coh2-skin-editor/.github/workflows/accessibility.yml`, `npm run a11y` → `scripts/a11y-axe.mts`, `npm run a11y:pa11y` → `pa11y-ci`, devDeps `@axe-core/playwright` + `eslint-plugin-jsx-a11y`, and `e2e/a11y.spec.ts`. Gated in CI.
- **Performance profiling**: `.github/workflows/bench.yml`, `npm run bench` → `vitest bench --run`, `src/lib/__tests__/perf.bench.ts`, plus `tools/bench-warmup.mts`. Gated in CI.
- **Bundle/asset budget**: `.github/workflows/size-limit.yml` + `size-limit`. Gated.
- **Onboarding a second human**: `.github/ISSUE_TEMPLATE/{bug,feature,config}.yml` + `PULL_REQUEST_TEMPLATE.md` already exist.

Track 2 counted "14 workflows"; track 3 said "14 workflows"; track 4 said "14 GitHub Actions." **Not one track read the workflow filenames.** Track 2 then wrote that Claude-in-CI "gives the coverage-floor and *Lighthouse gates* the wiki names as missing" — while `accessibility.yml` and `size-limit.yml` were sitting in that directory. This is the corpus reproducing the user's own failure mode 3: a confident conclusion from evidence that was never actually looked at.

**Genuinely uncovered categories, after correction:**

1. **The only ungated script is the one that matters.** Every cheap check (`lint`, `typecheck`, `test:coverage`, `e2e` at `ci.yml:103`, `a11y`, `bench`, `size`, `knip`, `lockfile:lint`) runs in CI. `verify:visual`, `verify:visual:capture/diff/build`, `audit:capture`, `audit:faithful` appear in **zero** workflows. The layered verification architecture — the thing the whole llm-wiki exists to protect — is the one thing with no automated trigger. No track said this.

2. **Runtime memory safety of the native addon — and what the addon actually does.** Track 1 asserted the addon "is on the path that writes byte-correct SGA/RGT output." It is not. `native/coh2-workshop/src/workshop_addon.cpp` exports exactly five functions: `publishNewItem`, `updateExistingItem`, **`deletePublishedItem`**, `startCallbackPump`, `stopCallbackPump`. It is the Steam Workshop publish/update/**delete** path — irreversible remote operations against the user's Steam account, in C++, with 3 unit tests. `codeql.yml` runs `languages: javascript-typescript` only; the C++ is covered by `cpp-linter` (clang-tidy + cppcheck — static only); `grep -rn "fsanitize\|ASAN\|valgrind"` across `native/`, `.github/`, `package.json` returns nothing. Track 1's answer to this surface was **clangd, for editor autocomplete**. The actual answer is an ASan/UBSan build of the addon's tests (`-fsanitize=address,undefined`, standard clang/gcc) and a coverage-guided fuzz target (libFuzzer ships with clang) over the parse paths, plus a confirm-before-delete guard. Nobody looked at what the file was called.

3. **Error/crash feedback from real users.** `grep -rn "crashReporter\|uncaughtException\|unhandledRejection"` across `electron/` and `src/` returns **nothing**. Electron ships `crashReporter` natively, and per https://www.electronjs.org/docs/latest/api/crash-reporter it takes `uploadToServer: false` and honours `app.setPath('crashDumps', ...)` — local dumps, zero SaaS, zero privacy question. Track 3's only answer was Sentry MCP, marked `confidence: medium`, and its own text concedes it is "only the READ half." The free, no-account, no-vendor version was never mentioned.

4. **Update channel.** Public MIT repo, `electron-release.yml` ships AppImages, `electron-updater` appears nowhere in `package.json` or the source. Failure mode 7 is not a developer-laptop problem; it is the shipped product's problem, permanently, for every user. No track generalised it past the dev's own `~/.local/bin`.

5. **Binary fixture management.** `artifacts/` is 1.8 GB on disk; 209 files tracked including 16 `.sga` and 2 `.dds`; `.git` is 100 MB; there is no `.gitattributes` and `git lfs` is not installed. The `.gitignore` excludes `artifacts/**/*.png` but not `.sga`/`.dds`. A byte-correctness project accumulating golden binaries in plain git has a clock on it. Not one track mentioned fixture storage, provenance, or the licensing status of game-derived data in a **public** repo.

6. **Cost control of agent usage.** One line about `--max-turns 5` and one about "check the context cost in `/plugin details`." Meanwhile the tracks recommend seven MCP servers, one of which (`chrome-devtools-mcp`) ships **52 tools** whose definitions load into every context window, alongside Serena, Context7, Grep, DeepWiki, Sentry, GitHub MCP, plus `repomix` and `kwin` already registered. Nobody summed it. The actual instrument exists and no track named it: `CLAUDE_CODE_ENABLE_TELEMETRY=1` with `OTEL_METRICS_EXPORTER=console` emits `claude_code.cost.usage` (USD) and `claude_code.token.usage`, attributed by `query_source` = `main` / `subagent` / `auxiliary` (https://code.claude.com/docs/en/monitoring-usage). That last attribute is the whole argument: it is the only way to find out whether four adversarial-reviewer subagents are worth their spend. A corpus that recommends spawning subagents everywhere and never mentions how to measure them is selling, not engineering.

7. **i18n.** Zero mentions, zero deps. A tool named "CoH2 Community Modding Tool" for a game whose modding community is heavily German/Russian/Polish/Chinese. Not urgent — but it is an architectural fork that costs 10x after 126 test files harden the English strings, and nobody flagged the decision even to defer it.

8. **Incident review.** Seven failure modes are documented as *findings*. None is documented as *cost* (hours lost) or *tripwire added*. There is no ritual that converts an incident into a check. The wiki is a knowledge base, not a postmortem log — which is why "measure baselines" had to be re-learned as a rule after both the too-loose *and* the too-tight calibration.

---

## 2. Load-bearing but thinly evidenced

**ImpossibleBench / "deny writes to test files" (track 4, `core`) is a category error wearing a measured effect size.** It is the most persuasive item in the corpus — the only one citing a number — and it will therefore be adopted first. It is aimed at the wrong bug.

ImpossibleBench measures agents **cheating**: given a task whose spec and tests conflict, the agent edits or deletes the tests. Failure mode 1 was not cheating. The test was written honestly and *lacked the context that triggered the bug*. Write-locking test files does nothing to a test that was always going to pass. It does actively cause harm: it prevents the agent from repairing a test that is genuinely wrong, which is the actual remediation for FM1. The sourcing compounds it — the per-model rates ("GPT-5 at 93%", "reduces their hacking rate to near zero") come from a LessWrong summary, not from the paper; track 4's own evidence field quotes the arXiv **abstract** only.

**Serena's stated rationale is refuted by the bug it cites.** Track 3 justifies Serena with the camera override: "find_referencing_symbols on the override symbol shows zero real call sites." Read the failure again — the override *was* wired up; it *was* called; it produced a **byte-identical** render. Find-references would have returned the call site and confirmed "wired up correctly," which is precisely the wrong conclusion the human already reached. Serena is a fine tool with a fabricated justification. And it duplicates track 1's `typescript-lsp`, which neither track noticed.

**The pkill fix treats the symptom and leaves the cause armed.** Three tracks want to block `pkill`. None asks why `pkill` was reached for: a 30–45 minute sweep spawns hidden Electron, gets interrupted, and leaves orphans with no recorded PID. Block `pkill` and the agent has *no* teardown, so orphans accumulate — the exact state that produced the panic-`pkill`. The cause-level fix is process-group discipline: launch under `setsid`, capture the PGID, `kill -- -$PGID`, `trap` on EXIT — or track 2's `run_in_background` + `TaskStop`, which it correctly identifies and then ranks **`useful`** while ranking the block **`core`**. That ranking is inverted.

**`fitsThisProject: "core"` is doing no work.** ~25 of 43 items carry it, including `claude-md-management` (a plugin to maintain a file that does not exist) and `mcp-server-dev` (a documentation skill). A label applied to 58% of a list is not a priority signal.

---

## 3. Fashionable rather than failure-mode-driven

- **DeepWiki MCP** — an AI-generated summary oracle for code, recommended to a person whose operating rules are "Never Guess," "the comment lied; trust the code," and a mandatory `file:line` citation contract. Track 3 concedes it: "treat outputs as leads to verify." That is an admission it fails the user's own bar. Cut.
- **Grep MCP** — "read a dozen real BC1/BC3 encoders before writing yours." The population of public block-compression encoders is small, largely transitively copied, and mostly not MIT. For a byte-correctness project this is a source of plausible-looking wrongness and a licence-contamination path into a public MIT repo. Nothing in the seven failure modes says "we didn't have enough examples."
- **The Ralph technique** (track 4) — kept, then the `howToAdopt` says *"Do not adopt the raw infinite bash loop"* and reduces it to "keep one plan file." A named technique retained for its name, describing a TODO file. Belongs in `notRecommended` or restated in plain words.
- **`security-guidance`** (track 1) — kept at `marginal` with the stated value "it is a working reference implementation of a Stop hook." That is "install version 2.0.6 of a plugin so you can read a Python file that is already visible on GitHub." That is padding.
- **`laurigates` testing-plugin** — kept, then the entry itself says "install Stryker directly and skip this." Padding.
- **`skill-creator`, `mcp-server-dev`, `plugin-dev`, `claude-md-management`** — four meta-plugins about building Claude Code artifacts, for a solo dev with one shipping product. This is the toolchain becoming the project.

---

## 4. What this user needs that no tool provides

**A negative control, stated before the measurement, every time.**

All five of the verification failure modes are one missing habit:

| Failure | Missing negative control |
|---|---|
| FM1 test that couldn't fail | never ran the test red |
| FM2 threshold 5–12x loose | never measured the unrelated-pair floor |
| FM3a screenshots 2x dark | never pushed a known-brightness reference through the same capture path |
| FM3b camera no-op | never checked the output hash *moved* |
| FM5 layers invented ad hoc | no layer had a stated falsifier |

One rule covers all five: **before trusting any instrument, demonstrate it reports a different answer when the thing it measures changes.** Red test. Unrelated-pair baseline. Known swatch through the real capture path. Hash-differs-after-change. Same move, four surfaces.

The second thing no tool provides: **a written "Not proven by this work" section on every verification result.** The user already discovered this retroactively ("SCOPE — proves COLOUR TRANSPORT only"). Making it a required field turns a lesson into a form.

Third: **a stopping rule for tooling.** With 43 recommendations and no ordering, the failure mode is adopting twelve, measuring none, and having a slower inner loop with more config to debug. Which brings up a number no track measured: **how long `npm test` actually takes on 126 files / 2231 tests.** That number governs whether mutation testing, Stop-hook gates, and agent reviewers are viable at all, and not one track ran it.

---

## 5. The single highest-leverage change — and it was buried

**The habit above.** Five of seven failure modes; costs nothing; no install.

The tracks surfaced fragments and buried the principle:
- The mechanical form for tests (mutation testing / Stryker) is in **track 5, last, and truncated**.
- The render form (`md5` must differ after the change) is a **sub-bullet inside a `howToAdopt`** of a soft prompting habit ("What are you least confident about?"), rated `confidence: medium`, with its own supporting citation admitted as read-from-search-summaries.
- The threshold form (measured unrelated-pair baseline) appears as an **example of a glob pattern** inside track 2's `.claude/rules/` entry.

It never appears as its own item, in any track, at any rank. Meanwhile the top slot in three of four tracks is a config file or a plugin install.

**The highest-leverage *code* change, which no track proposed at all: stamp the build.** `grep -rn "app.getVersion\|APP_VERSION\|VITE_APP_VERSION"` across `src/`, `electron/`, and `vite.config.ts` returns **nothing**. Inject the git SHA + build timestamp at build time and render it in the title bar, the About surface, and the main-process log. Then:

- Failure mode 7 dies. The user reads staleness off the window, in every screenshot, forever — no `Stop` hook, no `sha256sum` poller, no `monitors/monitors.json`, no `Monitor` tool. Three tracks proposed three separate pieces of machinery to detect a condition that a string in the title bar makes self-evident.
- Every agent screenshot becomes self-dating, which retro-fixes half of failure mode 3.
- And it closes a gap the repo has open right now: `.github/ISSUE_TEMPLATE/bug.yml` contains `id: version`, `label: Version`, `required: true` — **the bug report form demands a version number the application does not display anywhere.**

Four tracks, 43 recommendations, seven MCP servers, eleven plugins. The one-line fix for the seventh failure mode is a `define` in `vite.config.ts`, and nobody found it because nobody read `package.json`.
