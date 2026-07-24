# Overnight autonomous campaign (started 2026-06-13, user asleep)

Loop goal (verbatim): "keep working on the skin editor until it is perfect for release, all the
2D editors use a darkmode already working image editor package, the rear parts of the tiger tank
are back, it's missing the exhaust bits, make sure all the decals, faceplates, skin packs, are
working, including with templates."

## HARD CONSTRAINTS (unattended)
- NO screen: never launch the app, CoH2, CDP harness, or game-harness. Code + `npx tsc -b` +
  `npx vitest run` + AppImage build only. Anything needing the screen/in-game → defer to a
  LIVE-PASS checklist in OVERNIGHT-STATUS.md, marked NOT-confirmed.
- Deployed build = only test-verified, lower-risk changes (safe track). High-risk unverifiable
  rewrites (Konva migration) → isolated git worktree, tested, NOT deployed.
- No commits (project rule). Don't touch sga-writer.ts byte logic. ExplodeButton test already gone.
- Cost: Sonnet for implementation; ONE Fable diff-review near the end; never parallel Fable.
  Bank state to artifacts/ before each expensive step; auto-resume (ScheduleWakeup) on cap.

## TRACK 1 — SAFE (deploys; test-gated)
T1a. Vehicle-editor template/decal requirements (pre-sleep spec):
  1. Templates AND decals load/resolve in the vehicle editor (incl Workshop-sourced) — fix if broken.
  2. Faction filtering: template + decal pickers show ONLY the left-faction-picker's faction.
  3. Picker rows: remove the file PATH; small preview image LEFT + name RIGHT only.
  4. Decals in the vehicle editor = purely COSMETIC preview (NOT written into the skin pack export).
  5. Template chosen → renders in-game AND is included in the exported pack.
  6. Edit Texture button → edits THAT template's texture for the vehicle (not the base texture).
T1b. Tiger tank model: rear parts present but EXHAUST bits missing — fix the model/mesh assembly
  (vehicle-3d-renderer / loader). Owns the renderer/model files (disjoint from T1a).
T1c. Pack-type correctness regression sweep: decals, faceplates, skin packs, and template-based
  skins all build valid SGAs (export-path unit tests; in-game load = deferred to LIVE-PASS).

## TRACK 2 — STAGED (worktree, NOT deployed; for live review on wake)
T2. Konva.js engine under the two compositor editors (decal + faceplate) per
  ENGINE-MIGRATION-PLAN.md. Skin painter keeps custom brush (CanvasTexture live-sync constraint) —
  flag this nuance vs the user's "all 2D editors" wording for their decision. Golden-image export
  tests must prove rasteriseDecal / composeFaceplateCanvas output is unchanged. Worktree only.

## SEQUENCING (avoid file conflicts while unattended → mostly serial)
Tick 1: T1a (main tree, single owner). → Tick 2: T1b. → Tick 3: T1c sweep + safe build+deploy +
OVERNIGHT-STATUS.md. → Ticks 4+: T2 in worktree (phased), Fable review, leave staged.
On cap: bank, ScheduleWakeup at reset. Stop loop when Track 1 deployed + Track 2 staged + status
written; PushNotification the outcome.

## Progress log
- Tick 1 (start): campaign banked; T1a dispatched.
- Tick 1 (done): T1a COMPLETE — 1912/1912 green, tsc clean. R5 export-gate bug fixed (template-only
  vehicles now included in pack). R1/R4/R6 already-wired (tests added). R3 picker rows redone
  (preview+name, no path). Decals confirmed faction-universal → only templates faction-filter.
  Findings: artifacts/respec_audit/T1a-template-decal.md. LIVE-defer: R3 layout, R5 in-game, R6 visual.
- Tick 2 (done): T1b investigated — Tiger I (tiger.rgm) has NO exhaust geometry under expected
  names; only engine vents (rendered, thin/coplanar). 5 hypotheses ruled out across 75 meshes; no
  code change. Findings: T1b-tiger-exhaust.md. OPEN: agent checked Tiger I, but the session's hero
  model is the KING Tiger (sdkfz 182, default vehicle) — must re-check THAT model next, with a
  position/shape search (rear, low-tri, cylindrical), not just name-matching.
- Tick 3 (done): KING Tiger (king_tiger_sdkfz_182, MRGM v8, 59 groups) exhaust = ART LIMITATION
  (99%). BOTH Tiger models genuinely lack exhaust geometry; in-game it's FX/particles → our preview
  is ACCURATE. "Adding" = fabricating geometry that won't match game = USER DECISION (don't auto-do).
  27 tests, suite 1939/1939 green. No code change.
- Tick 4 (this): kicked off background build+DEPLOY of Track-1 (T1a fixes, green) so user has a
  testable binary on wake. Next: T1c pack-correctness coverage sweep, then OVERNIGHT-STATUS.md.
- Tick 4 (done): Track-1 build deployed 00:45 (146MB). Ultracode ON → launched release-readiness
  audit Workflow (wf_99a2f9cb-fa4): 7 pipelines (decal/faceplate/skin/template-skin/recent-changes/
  history-undo/workshop) audited → adversarially verified → synthesis to artifacts/respec_audit/
  RELEASE-AUDIT.md. Awaiting completion → next tick fixes CONFIRMED findings.
- Tick 5 (on workflow done): read RELEASE-AUDIT.md; fix confirmed blockers/majors (file-ownership
  sequenced), tsc+vitest gate, rebuild+deploy. Then T1c if gaps remain.
- Tick 5 (CAP HIT): release-audit workflow blew the usage window — 13 agents, 743k tokens in ~4min,
  killed by cap (resets 3:20am AEST). 0 confirmed findings (verifies died). LESSON: ultracode does NOT
  override the hard usage cap; overnight = pace UNDER the cap. NO big parallel workflows. Single
  sequential Sonnet agents only, modest budgets.
- BRIDGING to 3:20am reset via cheap wakeups (max 3600s each); each capped tick = one line, reschedule.
- POST-RESET PLAN (revised, conservative): headline deliverable = Track-2 Konva worktree staging
  (Phase 0 spike → Phase 1 decal editor), ONE agent at a time, tested, NOT deployed. Skip the big
  audit; if time, a SINGLE sequential review agent instead. Track-1 build already deployed (00:45).
- POST-RESET (user awake, chose "redo Konva in main tree"): worktree isolation backfired (branched
  from stale 2086cde, missing ALL session work → reference-only). Removed it. Redid decal Konva
  migration in MAIN tree against current 3583-line DecalPackEditor. Konva 10.3.0 + react-konva 19.2.5,
  manualChunks added, 6 golden export tests prove byte-identical. Built+deployed 17:35 (147.5MB) for
  user live-review. Then HARDENED: multi-select drag restored (one undo frame), 14-point regression
  review = none found. Suite 1948 green, tsc clean. LESSON: isolation:worktree branches from committed
  HEAD — useless when all work is uncommitted; work in main tree + deploy-when-verified instead.
- NEXT: faceplate editor Konva migration (Phase 2, harder — text/shape/image/mask/curve layers, keep
  paint/mask raster + curves on raw canvas over Konva). Then build+deploy decal+faceplate for live pass.
- DECAL multi-select fix is deployed-pending (batch into the faceplate build, don't redeploy alone).
- Konva decal LIVE-VERIFY still owed by user; faceplate replicates same pattern (shared risk).
- FACEPLATE Konva migration DONE in main tree: all layer types → Konva nodes, CanvasHandles→Transformer,
  composeFaceplateCanvas golden tests prove export byte-identical. Suite 1954 green, tsc clean. BUT 3
  live-view fidelity gaps (export is correct; only the PREVIEW diverges): (1) complex shapes
  chevron/star/shield render as Rect fallback; (2) image CSS filters brightness/contrast/sat/hue not
  applied in KonvaImage view; (3) multi-select drag moves only dragged node.
- NEXT: faceplate HARDENING — fix the 3 gaps (Konva custom shapes via sceneFunc/Line+Path; Konva
  built-in filters Brighten/Contrast/HSV; group-drag through history like decal). Then build+deploy
  decal+faceplate for user live pass.
- Deployed-pending: decal multi-select fix + faceplate migration + faceplate hardening → ONE build.
