/**
 * scripts/verify-model-completeness.mts
 *
 * MODEL-COMPLETENESS verifier for the CoH2 skin editor.
 *
 * Purpose
 * -------
 * Decide — from the archives alone, with NO Electron / GPU / app launch — whether
 * the editor's 3D viewport loads EVERYTHING the game defines for each of the 61
 * vehicles, or whether parts are missing (guns, wheels, turrets, attachments,
 * textures). Pure Node (tsx). Report-only: NO app code is changed.
 *
 * It reuses the Phase-1 analytical verifier's plumbing wholesale
 * (scripts/verify-unwrap-analytical.mts): Steam auto-detect, per-faction SGA
 * candidate sets, SgaArchive open, the editor's own parseRgm, VEHICLES/rgmPath
 * from vehicles.ts, and the editor's DESTROYED/VARIANT gating regexes.
 *
 * Three inventories per vehicle
 * -----------------------------
 * 1. ARCHIVE inventory — everything the game archives define for the vehicle.
 *    We merge the vehicle's directory (art/armies/<faction>/vehicles/<folder>/)
 *    across ALL Art*.sga (a vehicle's RGM lives in ArtHigh.sga but its full
 *    texture set + seasonal skins live in the big per-faction archive), plus
 *    the RGT paths advertised by the RGM's own TSET chunks. Each file is
 *    classified: rgm / body-texture (_dif/_nrm/_spc/_gls/_ocl) / tread-texture /
 *    turret-texture / wreck-texture / seasonal-skin / badge-atlas / tset /
 *    non-visual (.abp/.mua/.rpb/.sua/.rga/.rgo/…).
 *
 * 2. EDITOR-LOADED inventory — what the live preview WOULD load. The editor
 *    loads exactly ONE RGM per vehicle (rgmPath(v)); all submeshes (body/
 *    turret/tracks/wheels/wreck) live inside that single file. It then:
 *      - dedupes submeshes (name,material) — Viewport dedupeSubmeshes.
 *      - drops VARIANT overlays (Churchill AVRE/mortar/croc, hero "goblins").
 *      - partitions intact vs destroyed (DESTROYED_PATTERNS); renders INTACT.
 *      - per intact submesh, routes its material token (''/panels/turrets/
 *        tread/wreck/schurzen) to a texture set (Viewport getTexturesForMaterial
 *        tokenFor + tokenRe + findTset), falling back to the body atlas only for
 *        body/shared-atlas-turret materials.
 *    We reproduce that routing in Node and record, per submesh, which RGT the
 *    editor binds (or the fallback it substitutes, or null → flat colour).
 *
 * 3. PARSE-HEALTH — for the loaded RGM: parse success, submesh count, per-submesh
 *    vertex/index sanity (no zero-vertex / degenerate / non-multiple-of-3 index),
 *    TC0 present everywhere, TC1 presence noted, and every bound texture resolves
 *    in the archives (via parseRgtHeader — width/height/format sane).
 *
 * Verdict per vehicle
 * -------------------
 *   COMPLETE — editor loads every non-intentionally-excluded submesh, all parses
 *              healthy, every bound/body texture resolves.
 *   GAPS     — one or more: a submesh the editor loads but whose texture doesn't
 *              resolve (and no valid fallback); an unhealthy parse (0 verts,
 *              degenerate); a texture the archive defines that the editor's
 *              routing can't reach for a mesh that needs it. Each gap gets a
 *              severity: cosmetic (a secondary map like _spc/_gls missing, or a
 *              minor fitting untextured) vs major (whole-vehicle diffuse missing,
 *              a body/turret submesh with no resolvable atlas, a zero-vertex or
 *              unparsed RGM).
 *   SKIPPED  — RGM archive unreadable / not found.
 *
 * Intentional exclusions (NOT gaps): destroyed/wreck submeshes and their
 * textures (editor renders intact only), gameplay variants (AVRE/croc/mortar/
 * goblins), seasonal winter skins (applied later by applySeasonToGroup, not a
 * load-time miss), schurzen/skirt panels (deliberately left untextured), the
 * badge atlas (TC1 decal, handled by the shader), and non-visual sidecars
 * (.abp/.mua/.rpb/.sua/.rga/.rgo/.tset auxiliary data).
 *
 * Output:
 *   artifacts/verify-unwrap/completeness-report.md
 *   artifacts/verify-unwrap/completeness-results.json
 *
 * Run:
 *   npx tsx --tsconfig tsconfig.node.json scripts/verify-model-completeness.mts
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { openAsBlob, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const SRC_LIB = path.join(ROOT, 'src', 'lib')

// Reuse the editor's own libraries (same dynamic-import pattern as Phase 1).
const { parseRgm } = await import(`${SRC_LIB}/rgm.ts`)
const { SgaArchive } = await import(`${SRC_LIB}/sga.ts`)
const { parseRgtHeader } = await import(`${SRC_LIB}/rgt-core.ts`)
const { VEHICLES, rgmPath, vehicleFolder } = await import(`${SRC_LIB}/vehicles.ts`)

type RgmModelT = ReturnType<typeof parseRgm>
type RgmMeshT = RgmModelT['meshes'][number]

// ── The editor's SGA candidate list (Viewport.tsx:2816 — SAME order for RGM ──
// search AND texture resolution, for EVERY vehicle regardless of faction). We
// mirror it exactly so "what the editor can reach" matches the app 1:1.
const SGA_CANDIDATES = [
  'ArtHigh.sga', 'ArtHighXP1.sga', 'ArtHighXP2.sga', 'ArtArmies.sga',
  'ArtGermanEF.sga', 'ArtSovietEF.sga', 'ArtAEF.sga', 'ArtAEFSkins.sga',
  'ArtBritish.sga', 'ArtWestGerman.sga',
]

// ── Editor gating regexes (mirror Viewport.tsx DESTROYED_PATTERNS/VARIANT) ────
const DESTROYED_PATTERNS: RegExp[] = [
  /destroy(?:ed)?(?![a-z])/i, /wreck/i, /destruction/i, /burnt/i, /broken/i,
  /\bdmg\b/i, /_dam_/i, /wreak/i,
  /(?<![a-z0-9])damaged?(?![a-z0-9])/i, /(?<![a-z0-9])dam(?![a-z0-9])/i,
  /_d_(?:fr|fl|rr|rl|front|back|rear|left|right|side|\d+)(?:_|$)/i,
  /(?<![a-z0-9])dmg(?![a-z0-9])/i, /(?<![a-z0-9])dst(?![a-z0-9])/i, /(?<![a-z0-9])dest(?![a-z0-9])/i,
  /wheel[^a-z]*(?:dmg|dst|dest|destroyed|wreck|broken|dam)/i,
  /(?:dmg|dst|dest|destroyed|wreck|broken|dam)[^a-z]*wheel/i,
  /critical[^a-z]+treads?(?![a-z])|treads?[^a-z]+critical(?![a-z])/i,
  /\bproxy\b/i, /\bcollision\b/i, /\bphys(?:ics)?\b/i, /\bshadow\b/i,
  /\bocclus(?:ion|der)\b/i, /\bremains\b/i, /\bcrater\b/i,
  /crushed(?![a-z])/i, /orphans?(?![a-z])/i, /body_chunks?(?![a-z])/i,
  /(?:^|[_\W])wrk(?![a-z])/i, /(?:^|[_\W])crs(?![a-z])/i,
]
const VARIANT_PATTERNS: RegExp[] = [
  /turret_vert_mortar/i, /(?:^|[_\W])avre(?![a-z])/i, /flamethrower/i, /croctank/i, /goblins?(?![a-z])/i,
]
const isDestroyed = (n: string) => DESTROYED_PATTERNS.some(r => r.test(n))
const isVariant = (n: string) => VARIANT_PATTERNS.some(r => r.test(n))
const isSchurzen = (n: string) => /schurzen|skirt|side_armor|sidearmor/i.test(n)

// tokenFor — Viewport.tsx:3510. Distinguishing token for atlas/material routing.
function tokenFor(mat: string): string {
  if (/(?:^|_)turrets?(?:_|$)/i.test(mat)) return 'turrets'
  if (/wreck|wreak/i.test(mat)) return 'wreck'
  if (/(?:^|[^a-z])(?:tread|track|wheel)s?(?![a-z])/i.test(mat)) return 'tread'
  if (isSchurzen(mat)) return 'schurzen'
  if (/(?:^|_)panels?(?:_|$)/i.test(mat)) return 'panels'
  return ''
}
// tokenRe — Viewport.tsx:3616. Segment-aware texture-set matcher for a token.
function tokenRe(t: string): RegExp {
  const suffix = t === 'wreck' ? '(?:s|ed)?' : 's?'
  return new RegExp(`(?:^|/|_)${t}${suffix}(?:_|/)`, 'i')
}
// isVariantPath — Viewport.tsx:3620. Texture-set paths NOT eligible as body atlas.
function isVariantPath(p: string): boolean {
  return tokenRe('wreck').test(p) || tokenRe('tread').test(p) || tokenRe('track').test(p) ||
    tokenRe('panels').test(p) || tokenRe('turrets').test(p) || /\/badges\//i.test(p) || isSchurzen(p)
}

// ── Install / archive location (mirror Phase-1 candidateInstallRoots) ─────────
function candidateInstallRoots(): string[] {
  const h = homedir()
  return [
    path.join(h, '.local/share/Steam/steamapps/common/Company of Heroes 2'),
    path.join(h, '.steam/steam/steamapps/common/Company of Heroes 2'),
    path.join(h, '.steam/root/steamapps/common/Company of Heroes 2'),
    path.join(h, 'Steam/steamapps/common/Company of Heroes 2'),
    'C:/Program Files (x86)/Steam/steamapps/common/Company of Heroes 2',
  ]
}
function locateArchivesDir(): string | null {
  for (const base of candidateInstallRoots()) {
    for (const rel of [['CoH2', 'Archives'], ['Archives']]) {
      const dir = path.join(base, ...rel)
      if (existsSync(path.join(dir, 'ArtHigh.sga'))) return dir
    }
  }
  return null
}

// ── SGA cache — open each archive once via openAsBlob (handles >2 GiB SGAs; a ──
// plain fs.readFile blows Node's 2 GiB Buffer cap on ArtSovietEF/WestGerman). ──
type Archive = InstanceType<typeof SgaArchive>
const archiveCache = new Map<string, Archive | null>()
async function openArchive(archivesDir: string, name: string): Promise<Archive | null> {
  if (archiveCache.has(name)) return archiveCache.get(name)!
  const p = path.join(archivesDir, name)
  if (!existsSync(p)) { archiveCache.set(name, null); return null }
  try {
    const blob = await openAsBlob(p) // lazy, memory-mapped-ish; no full read
    const archive = await SgaArchive.open(blob)
    archiveCache.set(name, archive)
    return archive
  } catch (e) {
    console.warn(`[warn] failed to open ${name}: ${(e as Error).message}`)
    archiveCache.set(name, null)
    return null
  }
}

// A merged path index across all opened archives: path(lower,slash) → archive.
// First archive in SGA_CANDIDATES order that has a path wins — matching the
// editor's resolve order (readByPath scans sgaCandidates in order and breaks).
interface MergedIndex {
  has(p: string): boolean
  archiveFor(p: string): string | null
  read(p: string): Promise<Uint8Array | null>
  allPaths: string[]
}
async function buildMergedIndex(archivesDir: string): Promise<MergedIndex> {
  const owner = new Map<string, { archive: Archive; sga: string }>()
  const all: string[] = []
  for (const name of SGA_CANDIDATES) {
    const a = await openArchive(archivesDir, name)
    if (!a) continue
    for (const raw of a.listPaths()) {
      const p = raw.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
      if (!owner.has(p)) { owner.set(p, { archive: a, sga: name }); all.push(p) }
    }
  }
  return {
    has: (p) => owner.has(p.toLowerCase()),
    archiveFor: (p) => owner.get(p.toLowerCase())?.sga ?? null,
    read: async (p) => {
      const e = owner.get(p.toLowerCase())
      return e ? e.archive.readByPath(p) : null
    },
    allPaths: all,
  }
}

// ── File classification for the ARCHIVE inventory ────────────────────────────
type FileClass =
  | 'rgm' | 'body-tex' | 'tread-tex' | 'turret-tex' | 'wreck-tex'
  | 'badge-atlas' | 'seasonal-skin' | 'other-rgt' | 'non-visual'
function classifyArchiveFile(p: string): FileClass {
  const s = p.toLowerCase()
  if (s.endsWith('.rgm')) return 'rgm'
  if (!s.endsWith('.rgt')) return 'non-visual' // .abp/.mua/.rpb/.sua/.rga/.rgo/.tset/etc.
  // .rgt textures:
  if (/\/skins\//i.test(s) || /_summer\/|_winter\//i.test(s)) return 'seasonal-skin'
  if (/\/badges\//i.test(s) || /badges?_.*_dif/i.test(s)) return 'badge-atlas'
  if (isDestroyed(s)) return 'wreck-tex'
  if (tokenRe('tread').test(s) || tokenRe('track').test(s) || /wheel/i.test(s)) return 'tread-tex'
  if (tokenRe('turrets').test(s)) return 'turret-tex'
  if (/_dif$|_nrm$|_norm$|_spc$|_gls$|_ocl$/i.test(s.replace(/\.rgt$/, ''))) return 'body-tex'
  return 'other-rgt'
}

// ── Editor's per-material texture routing (mirror getTexturesForMaterial) ────
// Returns, for a material token, the RGT texture-set path (WITHOUT .rgt) the
// editor would bind for each PBR channel — resolved against the RGM's tsets.
interface RoutedTextures {
  token: string
  difPath: string | null
  nrmPath: string | null
  spcPath: string | null
  glsPath: string | null
  sharesBodyAtlas: boolean // turrets token w/ no dedicated turret atlas → uses body
  usesBodyDiffuse: boolean  // Viewport isBodyMaterial || sharesBodyAtlas
}
function routeTextures(materialName: string | null, name: string, tsetsLower: string[], vehicleId: string): RoutedTextures {
  const matForToken = materialName ?? name
  const token = materialName ? tokenFor(materialName) : tokenFor(name)
  const findTset = (pred: (p: string) => boolean): string | null => {
    for (const t of tsetsLower) if (pred(t)) return t
    return null
  }
  let difPath: string | null = null, nrmPath: string | null = null
  let spcPath: string | null = null, glsPath: string | null = null
  if (token === 'schurzen') {
    // intentionally untextured
  } else if (token) {
    const re = tokenRe(token)
    difPath = findTset(p => re.test(p) && /_dif$/.test(p))
    nrmPath = findTset(p => re.test(p) && /(_nrm$|_norm$)/.test(p))
    spcPath = findTset(p => re.test(p) && /_spc$/.test(p))
    glsPath = findTset(p => re.test(p) && /_gls$/.test(p))
  } else {
    const notVariant = (p: string) => !isVariantPath(p)
    const isBody = (p: string) => /_dif$/.test(p) && notVariant(p)
    const isBodyNrm = (p: string) => /(_nrm$|_norm$)/.test(p) && notVariant(p)
    const isBodySpc = (p: string) => /_spc$/.test(p) && notVariant(p)
    const isBodyGls = (p: string) => /_gls$/.test(p) && notVariant(p)
    const id = vehicleId.toLowerCase()
    difPath = findTset(p => isBody(p) && p.includes(id)) ?? findTset(isBody)
    nrmPath = findTset(p => isBodyNrm(p) && p.includes(id)) ?? findTset(isBodyNrm)
    spcPath = findTset(p => isBodySpc(p) && p.includes(id)) ?? findTset(isBodySpc)
    glsPath = findTset(p => isBodyGls(p) && p.includes(id)) ?? findTset(isBodyGls)
  }
  const sharesBodyAtlas = token === 'turrets' && difPath === null
  const isBodyMaterial = !materialName || tokenFor(materialName) === ''
  const usesBodyDiffuse = isBodyMaterial || sharesBodyAtlas
  void matForToken
  return { token, difPath, nrmPath, spcPath, glsPath, sharesBodyAtlas, usesBodyDiffuse }
}

// ── Body-atlas fallback path list (mirror Viewport tsetPaths+fallbackPaths) ──
// The editor also resolves a top-level "body diffuse" (line 2993+) it seeds into
// texCache['__body__'] and uses as the fallback for body/shared-atlas turrets.
// It tries RGM tsets ending _dif first, then hardcoded dir-based fallbacks.
const DIFFUSE_ALIASES: Record<string, string[]> = {
  elefant: ['elefant_hull', 'elefant'],
  ostwind_flak_panzer: ['ostwind_flak_panzer', 'ostwind', 'ostwind_flakpanzer'],
  sdkfz_222: ['sdkfz_222', 'sdkfz222', 'sdkfz221'],
  panther_ausf_g: ['panther', 'panther_ausf_g', 'pzkpfw_v_panther'],
  king_tiger_sdkfz_182: ['kingtiger', 'king_tiger', 'tiger_ii'],
  puma_sdkfz_234: ['puma', 'sdkfz_234', 'sdkfz234_puma'],
  jagdpanzer_iv_sdkfz_162: ['jagdpanzer_iv', 'jagdpanzeriv', 'jagdpanzer'],
  panzer_ii_luchs_sdkfz_123: ['luchs', 'panzer_ii_luchs', 'pzkpfw_ii'],
  panzer_iv_sdkfz_ausf_i: ['panzeriv', 'panzer_iv', 'pzkpfw_iv'],
  hetzer: ['hetzer', 'jagdpanzer_38t', 'jagdpanzer_38'],
  jagdtiger: ['jagdtiger'], sturmtiger: ['sturmtiger', 'sturmpanzer'],
  tiger: ['tiger', 'tiger_i', 'pzkpfw_vi_tiger'], brummbar: ['brummbar', 'sturmpanzer_iv'],
  kubelwagen: ['kubelwagen', 'kuebelwagen'],
  m4a3e8_sherman_easy_8: ['m4a3e8_sherman', 'm4a3e8', 'sherman_easy_8'],
  m4a3_sherman_76mm: ['m4a3_sherman_76', 'm4a3_76mm', 'sherman_76mm'],
  m4a1_sherman_calliope: ['m4a1_calliope', 'm4a1_sherman', 'sherman_calliope'],
  m10_tank_destroyer: ['m10', 'm10_wolverine'], m36_tank_destroyer: ['m36', 'm36_jackson'],
  m15a1_aa_halftrack: ['m15_aa_halftrack', 'm15a1', 'm16_halftrack'],
  sherman_firefly: ['firefly', 'sherman_firefly', 'sherman_vc'],
  sherman_m4a3: ['sherman_page', 'sherman_m4a3'],
  aec_armoured_car: ['aec_armouredcar_page', 'aec_armoured_car'],
}
function bodyDiffuseCandidatePaths(model: RgmModelT, vehicleId: string, faction: string): string[] {
  const id = vehicleId.toLowerCase()
  const candidates = model.textureSets
    .filter((t: string) => !isDestroyed(t) && /_dif$/i.test(t))
    .sort((a: string, b: string) => {
      const am = a.toLowerCase().includes(id) ? 0 : 1
      const bm = b.toLowerCase().includes(id) ? 0 : 1
      if (am !== bm) return am - bm
      return a.length - b.length
    })
  const bases = [vehicleId, ...(DIFFUSE_ALIASES[vehicleId] ?? [])].filter((v, i, a) => a.indexOf(v) === i)
  const dirCandidates = [vehicleId, ...bases].map(d => `art/armies/${faction}/vehicles/${d}/`)
  const tsetPaths = candidates.map((c: string) => c.replace(/\\/g, '/').toLowerCase() + '.rgt')
  const fallbackPaths = dirCandidates.flatMap(dir => bases.flatMap(b => [
    `${dir}${b}_dif.rgt`, `${dir}${b}_hull_dif.rgt`, `${dir}${b}_default_dif.rgt`,
  ]))
  const all = [...new Set([...tsetPaths, ...fallbackPaths])]
  // isBodyPath filter (Viewport:3148) — reject track/wheel diffuse.
  const isBodyPath = (p: string) =>
    !/\/(treads?|wheels?|tracks?)\//i.test(p) &&
    !/(?:^|[_/])(treads?|wheels?|tracks?)(?:_[a-z0-9]+)*_dif\.rgt$/i.test(p)
  return all.filter(isBodyPath)
}

// ── Parse-health per submesh ──────────────────────────────────────────────────
interface SubHealth {
  name: string
  materialName: string | null
  vertexCount: number
  indexCount: number
  hasTC0: boolean
  hasTC1: boolean
  degenerate: boolean       // 0 verts, 0 indices, or index count not a multiple of 3
  issue: string | null
}
function submeshHealth(mesh: RgmMeshT): SubHealth {
  const geo = mesh.geometry
  const pos = geo.attributes.position as { count: number } | undefined
  const uv = geo.attributes.uv as { count: number } | undefined
  const uv2 = geo.attributes.uv2 as { count: number } | undefined
  const idx = (geo as unknown as { index: { count: number } | null }).index
  const vertexCount = pos?.count ?? 0
  const indexCount = idx?.count ?? 0
  const hasTC0 = !!uv && uv.count > 0
  const hasTC1 = !!uv2 && uv2.count > 0
  let issue: string | null = null
  let degenerate = false
  if (vertexCount === 0) { degenerate = true; issue = 'zero vertices' }
  else if (indexCount === 0) { degenerate = true; issue = 'zero indices' }
  else if (indexCount % 3 !== 0) { degenerate = true; issue = `index count ${indexCount} not a multiple of 3` }
  else if (!hasTC0) { issue = 'no TC0 (diffuse UV) — untexturable' }
  return { name: mesh.name, materialName: mesh.materialName, vertexCount, indexCount, hasTC0, hasTC1, degenerate, issue }
}

// ── Texture resolve-health via parseRgtHeader (no full DXT decode needed) ─────
const rgtHealthCache = new Map<string, { ok: boolean; detail: string }>()
async function resolveTextureHealthy(merged: MergedIndex, tsetPathNoExt: string): Promise<{ ok: boolean; detail: string; foundPath: string | null }> {
  const candidate = tsetPathNoExt.replace(/\\/g, '/').toLowerCase().replace(/\.rgt$/, '') + '.rgt'
  if (rgtHealthCache.has(candidate)) { const c = rgtHealthCache.get(candidate)!; return { ...c, foundPath: c.ok ? candidate : null } }
  if (!merged.has(candidate)) {
    const r = { ok: false, detail: 'not in any archive' }
    rgtHealthCache.set(candidate, r)
    return { ...r, foundPath: null }
  }
  try {
    const bytes = await merged.read(candidate)
    if (!bytes) { const r = { ok: false, detail: 'read returned null' }; rgtHealthCache.set(candidate, r); return { ...r, foundPath: null } }
    const h = parseRgtHeader(bytes)
    const sane = h.width > 0 && h.height > 0 && h.width <= 16384 && h.height <= 16384
    const r = sane
      ? { ok: true, detail: `${h.width}x${h.height} fmt${h.formatCode}` }
      : { ok: false, detail: `insane dims ${h.width}x${h.height}` }
    rgtHealthCache.set(candidate, r)
    return { ...r, foundPath: r.ok ? candidate : null }
  } catch (e) {
    const r = { ok: false, detail: `parseRgtHeader threw: ${(e as Error).message}` }
    rgtHealthCache.set(candidate, r)
    return { ...r, foundPath: null }
  }
}

// ── Per-vehicle analysis ──────────────────────────────────────────────────────
type Severity = 'cosmetic' | 'major'
interface Gap { kind: string; detail: string; severity: Severity }
interface LoadedSub {
  name: string
  materialName: string | null
  token: string
  usesBodyDiffuse: boolean
  boundDiffuse: string | null    // texture-set path (no ext) the editor binds, or fallback label
  diffuseResolved: boolean
  diffuseVia: string             // 'own' | 'body-fallback' | 'flat-color' | 'unresolved'
  health: SubHealth
}
interface VehicleResult {
  id: string
  faction: string
  displayName: string
  rgmPath: string
  archive: string | null
  verdict: 'COMPLETE' | 'GAPS' | 'SKIPPED'
  archiveCounts: Record<string, number>
  archiveFileList: string[]
  loadedSubmeshCount: number
  skippedSubmeshes: { name: string; reason: string; intentional: boolean }[]
  drawGroups: number
  bodyDiffuseResolved: boolean
  bodyDiffusePath: string | null
  gaps: Gap[]
  loaded: LoadedSub[]
  visualNote: string
  skipReason?: string
}

function findRgmArchive(merged: MergedIndex, rp: string): string | null {
  return merged.archiveFor(rp.toLowerCase())
}

async function analyzeVehicle(
  merged: MergedIndex,
  v: { id: string; faction: string; displayName: string },
): Promise<VehicleResult> {
  const rp = rgmPath(v as never).toLowerCase()
  const folder = vehicleFolder(v.id)
  const vehDir = `art/armies/${v.faction}/vehicles/${folder}/`

  const base: VehicleResult = {
    id: v.id, faction: v.faction, displayName: v.displayName, rgmPath: rp,
    archive: findRgmArchive(merged, rp), verdict: 'SKIPPED',
    archiveCounts: {}, archiveFileList: [], loadedSubmeshCount: 0, skippedSubmeshes: [],
    drawGroups: 0, bodyDiffuseResolved: false, bodyDiffusePath: null,
    gaps: [], loaded: [], visualNote: '',
  }

  // ── ARCHIVE inventory — merge the vehicle directory across all SGAs ─────────
  const dirFiles = merged.allPaths.filter(p => p.startsWith(vehDir))
  base.archiveFileList = dirFiles
  for (const p of dirFiles) {
    const c = classifyArchiveFile(p)
    base.archiveCounts[c] = (base.archiveCounts[c] ?? 0) + 1
  }

  // ── Read + parse the ONE RGM the editor loads ───────────────────────────────
  const rgmBytes = await merged.read(rp)
  if (!rgmBytes) {
    base.skipReason = `RGM ${rp} not found in any Art*.sga`
    base.gaps.push({ kind: 'rgm-missing', detail: base.skipReason, severity: 'major' })
    return base
  }
  let model: RgmModelT
  try {
    model = parseRgm(rgmBytes)
  } catch (e) {
    base.skipReason = `parseRgm failed: ${(e as Error).message}`
    base.gaps.push({ kind: 'parse-failed', detail: base.skipReason, severity: 'major' })
    return base
  }

  const tsetsLower = model.textureSets.map((t: string) => t.replace(/\\/g, '/').toLowerCase())

  // ── EDITOR-LOADED inventory: dedupe, drop variants, partition intact ────────
  const seen = new Set<string>()
  const deduped: RgmMeshT[] = []
  for (const m of model.meshes) {
    const key = `${m.name}|${m.materialName ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(m)
  }
  const intact: RgmMeshT[] = []
  for (const sub of deduped) {
    const matchTarget = `${sub.name} ${sub.materialName ?? ''}`
    if (isVariant(matchTarget)) {
      base.skippedSubmeshes.push({ name: sub.name, reason: 'gameplay variant (AVRE/mortar/croc/goblins)', intentional: true })
      continue
    }
    if (isDestroyed(matchTarget)) {
      base.skippedSubmeshes.push({ name: sub.name, reason: 'destroyed/wreck (editor renders intact)', intentional: true })
      continue
    }
    intact.push(sub)
  }
  // Duplicate submeshes dropped by dedupe (intentional).
  const dupCount = model.meshes.length - deduped.length
  if (dupCount > 0) {
    base.skippedSubmeshes.push({ name: `(${dupCount} duplicate submesh(es))`, reason: 'exact (name,material) duplicate — dedupeSubmeshes', intentional: true })
  }

  base.loadedSubmeshCount = intact.length
  base.drawGroups = model.meshes.reduce((m: number, mesh: RgmMeshT) => {
    const g = (mesh.geometry as unknown as { groups: unknown[] }).groups ?? []
    return Math.max(m, g.length)
  }, 0)

  if (intact.length === 0) {
    base.gaps.push({
      kind: 'no-intact-submeshes',
      detail: `RGM parsed ${model.meshes.length} mesh(es) but 0 survive gating → empty viewport (format the editor can't decode, or all filtered)`,
      severity: 'major',
    })
  }

  // ── Body diffuse (top-level fallback the editor seeds into __body__) ─────────
  const bodyPaths = bodyDiffuseCandidatePaths(model, v.id, v.faction)
  let bodyDiffusePath: string | null = null
  for (const p of bodyPaths) {
    const h = await resolveTextureHealthy(merged, p)
    if (h.ok) { bodyDiffusePath = h.foundPath; break }
  }
  base.bodyDiffuseResolved = bodyDiffusePath !== null
  base.bodyDiffusePath = bodyDiffusePath
  if (!base.bodyDiffuseResolved && intact.length > 0) {
    base.gaps.push({
      kind: 'body-diffuse-unresolved',
      detail: `no body diffuse resolves; tried ${bodyPaths.length} paths (tsets + id fallbacks) — whole vehicle renders untextured (flat khaki)`,
      severity: 'major',
    })
  }

  // ── Per intact submesh: route + resolve textures, record health ─────────────
  for (const sub of intact) {
    const route = routeTextures(sub.materialName, sub.name, tsetsLower, v.id)
    const health = submeshHealth(sub)

    let boundDiffuse: string | null = null
    let diffuseResolved = false
    let diffuseVia = 'flat-color'

    if (route.difPath) {
      const h = await resolveTextureHealthy(merged, route.difPath)
      boundDiffuse = route.difPath
      diffuseResolved = h.ok
      diffuseVia = h.ok ? 'own' : 'unresolved'
      if (!h.ok) {
        // token-specific texture advertised by tset but not resolvable
        base.gaps.push({
          kind: 'submesh-texture-unresolved',
          detail: `${sub.name} (${route.token || 'body'}): bound ${route.difPath} but ${h.detail}`,
          severity: route.token === '' || route.token === 'turrets' || route.token === 'panels' ? 'major' : 'cosmetic',
        })
      }
    } else if (route.usesBodyDiffuse) {
      // body / shared-atlas turret → falls back to the body diffuse
      boundDiffuse = bodyDiffusePath
      diffuseResolved = base.bodyDiffuseResolved
      diffuseVia = base.bodyDiffuseResolved ? 'body-fallback' : 'unresolved'
      // Already covered by the body-diffuse-unresolved gap above if unresolved.
    } else {
      // token material (tread/wreck/schurzen) with no token texture → flat colour.
      // This is the editor's intended behaviour (tracks get gunmetal, schurzen grey).
      diffuseVia = 'flat-color'
      diffuseResolved = true // intentional flat fill, not a gap
      if (route.token === 'tread') {
        // A tread submesh with no tread texture IS a (minor) cosmetic gap only
        // when the archive actually ships a tread texture the router missed.
        const archiveHasTread = dirFiles.some(p => /_dif\.rgt$/i.test(p) && (tokenRe('tread').test(p) || tokenRe('track').test(p) || /wheel/i.test(p)) && !isDestroyed(p) && !/\/skins\//i.test(p))
        if (archiveHasTread) {
          base.gaps.push({
            kind: 'tread-texture-unrouted',
            detail: `${sub.name}: archive ships a tread/wheel _dif but router bound none → tracks render flat gunmetal`,
            severity: 'cosmetic',
          })
          diffuseVia = 'flat-color(tread-tex-available)'
        }
      }
    }

    // Parse-health gaps.
    if (health.degenerate) {
      base.gaps.push({
        kind: 'degenerate-submesh',
        detail: `${sub.name}: ${health.issue}`,
        severity: route.usesBodyDiffuse ? 'major' : 'cosmetic',
      })
    } else if (health.issue === 'no TC0 (diffuse UV) — untexturable' && diffuseResolved && diffuseVia !== 'flat-color') {
      base.gaps.push({
        kind: 'missing-tc0',
        detail: `${sub.name}: bound a diffuse but has no TC0 UVs → texture cannot map`,
        severity: 'cosmetic',
      })
    }

    base.loaded.push({
      name: sub.name, materialName: sub.materialName, token: route.token,
      usesBodyDiffuse: route.usesBodyDiffuse, boundDiffuse, diffuseResolved, diffuseVia, health,
    })
  }

  base.verdict = base.gaps.length === 0 ? 'COMPLETE' : 'GAPS'
  return base
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const archivesDir = locateArchivesDir()
  const OUT_DIR = path.join(ROOT, 'artifacts', 'verify-unwrap')
  await mkdir(OUT_DIR, { recursive: true })

  if (!archivesDir) {
    console.error('[FATAL] Could not locate CoH2 install Archives folder. Tried:')
    for (const b of candidateInstallRoots()) console.error('  ' + b)
    process.exit(2)
  }
  console.log(`[info] Archives: ${archivesDir}`)
  console.log('[info] Building merged path index across all Art*.sga (this reads TOCs only)…')
  const merged = await buildMergedIndex(archivesDir)
  console.log(`[info] Merged index: ${merged.allPaths.length} unique paths across ${SGA_CANDIDATES.length} candidate SGAs.`)

  // Visual cross-check notes — recorded from a manual read of the Phase-2
  // baseline PNGs (artifacts/verify-unwrap/visual/<faction>/<id>_base.png).
  // Spot-pass over the 4 well-known vehicles the brief names, plus 2 merged-mesh
  // (loaded=1) armored cars to confirm the single-submesh case renders the whole
  // vehicle (wheels/turret), not a lone body with parts dropped.
  const VISUAL_NOTES: Record<string, string> = {
    tiger: 'PNG confirms COMPLETE: hull, turret, full gun barrel + muzzle brake, all road wheels, both tracks, camo-textured. No missing parts.',
    panther_ausf_g: 'PNG confirms COMPLETE: hull, turret, long gun barrel, side skirts, wheels, tracks all present (dark from season lighting).',
    king_tiger_sdkfz_182: 'PNG confirms COMPLETE: hull, turret, long gun + muzzle brake, interleaved road wheels, tracks all present (one wheel patch shows the known cobalt wheel-atlas tint, Viewport.tsx:3529 — geometry intact).',
    cromwell: 'PNG confirms COMPLETE: hull, turret, gun, antennae, wheels, tracks all present (MRGM v8, dark from lighting).',
    sdkfz_222: 'PNG confirms merged-mesh (loaded=1) renders the WHOLE vehicle: body, 4 wheels, radio-frame antenna, turret basket, stowage, headlights. loaded=1 = one 51-group merged mesh, not a lone body.',
    m8_greyhound: 'PNG confirms merged-mesh (loaded=1) renders the WHOLE vehicle: hull, 6 wheels, open-top turret ring, gun. Nothing dropped.',
  }

  const results: VehicleResult[] = []
  for (const v of VEHICLES as Array<{ id: string; faction: string; displayName: string }>) {
    let r: VehicleResult
    try {
      r = await analyzeVehicle(merged, v)
      if (VISUAL_NOTES[v.id]) r.visualNote = VISUAL_NOTES[v.id]
    } catch (e) {
      r = {
        id: v.id, faction: v.faction, displayName: v.displayName,
        rgmPath: rgmPath(v as never).toLowerCase(), archive: null, verdict: 'SKIPPED',
        archiveCounts: {}, archiveFileList: [], loadedSubmeshCount: 0, skippedSubmeshes: [],
        drawGroups: 0, bodyDiffuseResolved: false, bodyDiffusePath: null,
        gaps: [{ kind: 'analyze-threw', detail: (e as Error).message, severity: 'major' }],
        loaded: [], visualNote: '', skipReason: `analyze threw: ${(e as Error).message}`,
      }
    }
    const majorGaps = r.gaps.filter(g => g.severity === 'major').length
    const cosGaps = r.gaps.filter(g => g.severity === 'cosmetic').length
    results.push(r)
    console.log(
      `  ${v.id.padEnd(28)} ${r.verdict.padEnd(9)} ` +
      `loaded=${String(r.loadedSubmeshCount).padStart(3)} ` +
      `arch=${String(r.archiveFileList.length).padStart(3)} ` +
      `skip=${String(r.skippedSubmeshes.length).padStart(2)} ` +
      `bodyDif=${r.bodyDiffuseResolved ? 'ok' : 'MISS'} ` +
      (r.gaps.length ? `gaps=${majorGaps}maj/${cosGaps}cos` : '') +
      (r.skipReason ? `  (${r.skipReason})` : ''),
    )
  }

  // ── Summary + artifacts ─────────────────────────────────────────────────────
  const counts = {
    COMPLETE: results.filter(r => r.verdict === 'COMPLETE').length,
    GAPS: results.filter(r => r.verdict === 'GAPS').length,
    SKIPPED: results.filter(r => r.verdict === 'SKIPPED').length,
  }
  // Ranked gap list (major first, then by vehicle).
  const rankedGaps: { vehicle: string; faction: string; kind: string; severity: Severity; detail: string }[] = []
  for (const r of results) {
    for (const g of r.gaps) rankedGaps.push({ vehicle: r.id, faction: r.faction, kind: g.kind, severity: g.severity, detail: g.detail })
  }
  rankedGaps.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'major' ? -1 : 1))

  await writeFile(path.join(OUT_DIR, 'completeness-results.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    archivesDir,
    sgaCandidates: SGA_CANDIDATES,
    counts,
    total: results.length,
    intentionalExclusions: [
      'destroyed/wreck submeshes + their _wreck/_wrecked textures (editor renders intact only)',
      'gameplay variants (AVRE/mortar/croctank/flamethrower/goblins)',
      'seasonal winter skins under skins/*_winter/ (applied post-load by applySeasonToGroup)',
      'schurzen/skirt/side-armour panels (deliberately untextured → default grey)',
      'badge atlas (art/armies/*/badges/*) — TC1 decal, handled by the badge shader',
      'non-visual sidecars (.abp/.mua/.muax/.rpb/.sua/.rga/.rgo/.tset/etc.)',
      'exact (name,material) duplicate submeshes (dedupeSubmeshes)',
    ],
    rankedGaps,
    results,
  }, null, 2))

  await writeFile(path.join(OUT_DIR, 'completeness-report.md'), renderReport(results, counts, rankedGaps, archivesDir))

  console.log('\n=== SUMMARY ===')
  console.log(`Total vehicles : ${results.length}`)
  console.log(`COMPLETE       : ${counts.COMPLETE}`)
  console.log(`GAPS           : ${counts.GAPS}${counts.GAPS ? ' — ' + results.filter(r => r.verdict === 'GAPS').map(r => r.id).join(', ') : ''}`)
  console.log(`SKIPPED        : ${counts.SKIPPED}${counts.SKIPPED ? ' — ' + results.filter(r => r.verdict === 'SKIPPED').map(r => `${r.id} (${r.skipReason})`).join('; ') : ''}`)
  const majors = rankedGaps.filter(g => g.severity === 'major')
  console.log(`\nMAJOR gaps     : ${majors.length}`)
  for (const g of majors) console.log(`  [${g.vehicle}] ${g.kind}: ${g.detail}`)
  console.log(`\nArtifacts:`)
  console.log(`  ${path.join(OUT_DIR, 'completeness-report.md')}`)
  console.log(`  ${path.join(OUT_DIR, 'completeness-results.json')}`)
}

// ── Report renderer ───────────────────────────────────────────────────────────
function renderReport(
  results: VehicleResult[],
  counts: Record<string, number>,
  rankedGaps: { vehicle: string; faction: string; kind: string; severity: Severity; detail: string }[],
  archivesDir: string,
): string {
  const L: string[] = []
  const esc = (s: string) => s.replace(/\|/g, '\\|')
  L.push('# CoH2 Skin Editor — Model-Completeness Verification Report')
  L.push('')
  L.push(`_Generated ${new Date().toISOString()}_`)
  L.push('')
  L.push('Pure-Node check (no Electron/GPU). For each of the 61 vehicles it compares three inventories:')
  L.push('**ARCHIVE** (everything the game archives define for the vehicle directory + the RGM-advertised RGTs),')
  L.push('**EDITOR-LOADED** (what the live preview would load — the one RGM per vehicle, its intact submeshes,')
  L.push("and the textures the editor's resolution logic binds per material token), and **PARSE-HEALTH**")
  L.push('(submesh vertex/index sanity, TC0/TC1 presence, and whether each bound texture resolves in the archive).')
  L.push('')
  L.push(`Archives: \`${archivesDir}\``)
  L.push('')
  L.push('**Key architecture fact:** the editor loads exactly ONE `.rgm` per vehicle (`rgmPath(v)`); all')
  L.push('submeshes — body, turret, gun, wheels, tracks, wreck — live inside that single file as TRIM v5 /')
  L.push('MRGM v8 chunks. There are NO separate turret/wreck `.rgm` files to miss. "Missing parts" therefore')
  L.push("means either a submesh the parser drops/can't decode, or a texture the editor's routing fails to bind.")
  L.push('')
  L.push('## Summary')
  L.push('')
  L.push('| Verdict | Count |')
  L.push('|---|---|')
  L.push(`| COMPLETE | ${counts.COMPLETE} |`)
  L.push(`| GAPS | ${counts.GAPS} |`)
  L.push(`| SKIPPED | ${counts.SKIPPED} |`)
  L.push(`| **Total** | **${results.length}** |`)
  L.push('')

  // Intentional exclusions note.
  L.push('### Intentional exclusions (NOT counted as gaps)')
  L.push('')
  L.push('- Destroyed/wreck submeshes + their `_wreck`/`_wrecked` textures (editor renders the intact vehicle only).')
  L.push('- Gameplay variants: AVRE/mortar/croctank/flamethrower turrets, hero-RGM "goblins" crew.')
  L.push('- Seasonal **winter** skins under `skins/*_winter/` (applied post-load by `applySeasonToGroup`, not a load-time miss).')
  L.push('- Schurzen / skirt / side-armour panels (deliberately left untextured → default grey).')
  L.push('- Badge atlas (`art/armies/*/badges/*`) — that is the TC1 decal, handled by the badge shader.')
  L.push('- Non-visual sidecars (`.abp/.mua/.muax/.rpb/.sua/.rga/.rgo/.tset/…`) and exact duplicate submeshes.')
  L.push('')

  // Ranked gap list.
  L.push('## Ranked gap list (fix priority)')
  L.push('')
  if (rankedGaps.length === 0) {
    L.push('_None — every vehicle is COMPLETE._')
  } else {
    L.push('| # | Severity | Vehicle | Faction | Gap kind | Detail |')
    L.push('|---|---|---|---|---|---|')
    rankedGaps.forEach((g, i) => {
      L.push(`| ${i + 1} | ${g.severity.toUpperCase()} | ${g.vehicle} | ${g.faction} | ${g.kind} | ${esc(g.detail)} |`)
    })
  }
  L.push('')

  // Per-vehicle table.
  L.push('## Per-vehicle table')
  L.push('')
  L.push('| Vehicle | Faction | Archive files | Loaded submeshes | Skipped (intentional) | Draw groups | Body diffuse | Verdict | Gaps | Visual note |')
  L.push('|---|---|---|---|---|---|---|---|---|---|')
  for (const r of results) {
    const gapSummary = r.gaps.length === 0
      ? '—'
      : r.gaps.map(g => `${g.severity === 'major' ? '**' : ''}${g.kind}${g.severity === 'major' ? '**' : ''}`).join('; ')
    L.push(
      `| ${r.id} | ${r.faction} | ${r.archiveFileList.length} | ${r.loadedSubmeshCount} | ` +
      `${r.skippedSubmeshes.length} | ${r.drawGroups} | ${r.bodyDiffuseResolved ? 'ok' : '**MISS**'} | ` +
      `${r.verdict} | ${esc(gapSummary)} | ${esc(r.visualNote || '—')} |`,
    )
  }
  L.push('')

  // Detail per GAPS/SKIPPED vehicle.
  const problems = results.filter(r => r.verdict !== 'COMPLETE')
  L.push('## Problem-vehicle detail')
  L.push('')
  if (problems.length === 0) {
    L.push('_None._')
  } else {
    for (const r of problems) {
      L.push(`### ${r.id} (${r.faction}) — ${r.verdict}`)
      L.push('')
      L.push(`- RGM: \`${r.rgmPath}\` (archive: ${r.archive ?? 'NOT FOUND'})`)
      L.push(`- Archive dir files: ${r.archiveFileList.length}; intact submeshes loaded: ${r.loadedSubmeshCount}; draw groups: ${r.drawGroups}`)
      L.push(`- Body diffuse: ${r.bodyDiffuseResolved ? '`' + r.bodyDiffusePath + '`' : '**UNRESOLVED**'}`)
      if (r.gaps.length) {
        L.push('- Gaps:')
        for (const g of r.gaps) L.push(`  - **[${g.severity}]** \`${g.kind}\` — ${g.detail}`)
      }
      if (r.visualNote) L.push(`- Visual cross-check: ${r.visualNote}`)
      L.push('')
    }
  }

  // Fix-list with file:line pointers into the resolution logic.
  L.push('## Ranked fix-list — resolution logic responsible for each unintentional gap')
  L.push('')
  L.push('All routing/gating logic lives in `src/components/Viewport.tsx` (mesh load path) and')
  L.push('`src/lib/rgm.ts` (parser). Relevant sites:')
  L.push('')
  L.push('- **`src/components/Viewport.tsx:2993-3196`** — top-level BODY DIFFUSE resolution (`candidates`/')
  L.push('  `DIFFUSE_ALIASES`/`fallbackPaths`/`isBodyPath`). A `body-diffuse-unresolved` gap means this block')
  L.push('  found no `*_dif.rgt`; add the vehicle-specific basename to the `aliases` map (Viewport.tsx:3014).')
  L.push('- **`src/components/Viewport.tsx:3510-3560`** — `tokenFor()` material→token routing. A submesh')
  L.push('  textured wrong (or unrouted) usually means its material name misses a token branch here.')
  L.push('- **`src/components/Viewport.tsx:3616-3659`** — `tokenRe()`/`findTset` per-token texture matching.')
  L.push('  A `submesh-texture-unresolved` / `tread-texture-unrouted` gap points here.')
  L.push('- **`src/components/Viewport.tsx:3703-3720`** — body-atlas fallback + `sharesBodyAtlas` gate for')
  L.push('  turrets. A turret rendering untextured despite sharing the body atlas points here.')
  L.push('- **`src/components/Viewport.tsx:213-323`** — `DESTROYED_PATTERNS` / `isDestroyedMesh`. A submesh')
  L.push('  wrongly filtered as destroyed (→ `no-intact-submeshes` or a missing gun/wheel) points here.')
  L.push('- **`src/lib/rgm.ts:314-362`** — `parseTrimDataV5`. A `no-intact-submeshes` or `degenerate-submesh`')
  L.push('  gap on a whole vehicle means the TRIM v5 packed-stride variant failed to parse (returns empty mesh).')
  L.push('')
  return L.join('\n')
}

await main()
