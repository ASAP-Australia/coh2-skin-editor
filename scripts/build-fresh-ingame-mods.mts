/**
 * scripts/build-fresh-ingame-mods.mts
 *
 * Build FRESH decal + faceplate + vehicle-skin SGAs through the REAL editor
 * builders (current, post-2026-06-10-fix code path) and INSTALL them into the
 * live CoH2 Proton-prefix mod folders so the next harness run can prove they
 * LOAD in-game.
 *
 *   - decal      → buildDecalMod()      (src/lib/decal-mod-build.ts) — REAL builder
 *   - faceplate  → buildFaceplateMod()  (src/lib/faceplate-mod-build.ts) — REAL builder
 *   - skin       → buildSga() + public/template German skin pack + canvasToRgt()
 *                  (the exact writer + template + RGT path exportSkinPack uses at
 *                   mod-export.ts:706; full exportSkinPack() needs a live
 *                   FileSystemDirectoryHandle to composite from the game archives,
 *                   which is not available headless — the SGA-assembly code path
 *                   exercised here is identical.)
 *
 * Every SGA is gated through:
 *   (a) SgaArchive.open() round-trip
 *   (b) every stored file raw-zlib-decompresses to its declared length
 *   (c) the structural load-compatibility topology guard (4 canonical drives in
 *       order, "" roots, no forward slash in folder names, full ancestor chains,
 *       faceplate == exactly 6 files incl. root .dds) — replicated from
 *       src/lib/__tests__/sga-roundtrip.test.ts (rawTopology /
 *       assertLoadableSkinLayoutTopology are module-local there, not exported).
 *
 * Content: fresh REAL German/Honvéd assets —
 *   - skin      : German Tiger 3-tone Honvéd camo (real 2048² tiger diffuse)
 *   - decal     : Honvéd Kereszt national-insignia pack (5 factions incl. german/aef)
 *   - faceplate : "HONVÉD" short-text banner
 *
 * Fresh GUIDs / numeric id → no collision with the user's existing SGAs; installs
 * ALONGSIDE them (no deletion). Lists each target dir before + after.
 *
 * Run:
 *   npx tsx --tsconfig tsconfig.node.json scripts/build-fresh-ingame-mods.mts
 */
import { createCanvas, loadImage } from 'canvas'
import { writeFile, mkdir, copyFile, readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { strict as assert } from 'node:assert'

// ─── JSDOM / node-canvas bootstrap (editor build code touches document.createElement('canvas')) ───
import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
;(globalThis as Record<string, unknown>).document = dom.window.document
;(globalThis as Record<string, unknown>).HTMLCanvasElement = dom.window.HTMLCanvasElement
;(globalThis as Record<string, unknown>).ImageData = dom.window.ImageData
;(globalThis as Record<string, unknown>).File = dom.window.File
const origCreateElement = dom.window.document.createElement.bind(dom.window.document)
;(dom.window.document as unknown as Record<string, unknown>).createElement = (tag: string, ...args: unknown[]) => {
  if (tag === 'canvas') return createCanvas(256, 256) as unknown as HTMLCanvasElement
  return origCreateElement(tag as keyof HTMLElementTagNameMap, ...(args as [ElementCreationOptions?]))
}

// ─── Paths ───────────────────────────────────────────────────────────────────
const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const SRC_LIB = path.join(ROOT, 'src', 'lib')
const TEMPLATE_DIR = path.join(ROOT, 'public', 'template')
const OUT_DIR = path.join(ROOT, 'artifacts', 'ingame-verify', 'fresh-mods')
const TIGER_DIFFUSE = path.join(ROOT, 'artifacts', 'respec_audit', 'honved-skin', 'regen', 'tiger.png')

// Proton prefix (231430 = CoH2). `.steam` symlinks here; use the canonical path.
const PFX = path.join(
  '/var/home/jflessenkemper/.local/share/Steam/steamapps/compatdata/231430/pfx',
  'drive_c/users/steamuser/Documents/My Games/Company of Heroes 2',
)
const DIR_SKINS = path.join(PFX, 'mods', 'skins')
const DIR_DECALS_SUBS = path.join(PFX, 'mods', 'decals', 'subscriptions')
const DIR_FACEPLATES_SUBS = path.join(PFX, 'mods', 'faceplates', 'subscriptions')

// ─── Fresh, deterministic ids (no collision with the user's on-disk SGAs) ─────
const SKIN_GUID = '3f7ce0a144bb4c0aa1de5f2b0c9e7a11' // internal asset-path GUID
const SKIN_NUMERIC_ID = '3907714500011001' // on-disk skin filename (numeric, no leading zero)
const DECAL_GUID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
const FACEPLATE_GUID = 'b2c3d4e5f60718293a4b5c6d7e8f90a1'

// ─── Dynamic imports (after DOM patch) ───────────────────────────────────────
const { buildDecalMod } = await import(`${SRC_LIB}/decal-mod-build.ts`)
const { buildFaceplateMod } = await import(`${SRC_LIB}/faceplate-mod-build.ts`)
const { newDecalPackProject } = await import(`${SRC_LIB}/decal-pack-project.ts`)
const { newFaceplateProject } = await import(`${SRC_LIB}/faceplate-project.ts`)
const { ATLAS_WIDTH, ATLAS_HEIGHT } = await import(`${SRC_LIB}/faceplate-templates.ts`)
const { buildSga } = (await import(`${SRC_LIB}/sga-writer.ts`)) as {
  buildSga: (o: { archiveName: string; files: { path: string; bytes: Uint8Array; compress?: boolean }[] }) => Promise<Uint8Array>
}
const { SgaArchive } = await import(`${SRC_LIB}/sga.ts`)
const { canvasToRgt } = await import(`${SRC_LIB}/rgt-writer.ts`)
const { encodeBc3 } = await import(`${SRC_LIB}/bc-encode.ts`)

// ═══════════════════════════════════════════════════════════════════════════════
// Structural guard — replicated from src/lib/__tests__/sga-roundtrip.test.ts
// (rawTopology + assertLoadableSkinLayoutTopology are module-local there).
// ═══════════════════════════════════════════════════════════════════════════════
interface Topo {
  driveCount: number
  drives: { alias: string; root: number }[]
  folders: { name: string; subFirst: number; subLast: number; fileFirst: number; fileLast: number }[]
  files: { name: string; storage: number }[]
  filePaths: string[]
}
function rawTopology(sga: Uint8Array): Topo {
  const dv = new DataView(sga.buffer, sga.byteOffset, sga.byteLength)
  const headerSize = dv.getUint32(140, true)
  const hp = 152
  const toc = new DataView(sga.buffer, sga.byteOffset + hp, headerSize)
  const drivePos = toc.getUint32(0, true), driveCount = toc.getUint32(4, true)
  const folderPos = toc.getUint32(8, true), folderCount = toc.getUint32(12, true)
  const filePos = toc.getUint32(16, true), fileCount = toc.getUint32(20, true)
  const namePos = toc.getUint32(24, true), nameCount = toc.getUint32(28, true)
  const nameAt = new Map<number, string>()
  {
    let cur = namePos, c = 0
    while (cur < headerSize && c < nameCount) {
      let e = cur
      while (e < headerSize && sga[hp + e] !== 0) e++
      nameAt.set(cur - namePos, new TextDecoder().decode(sga.subarray(hp + cur, hp + e)))
      cur = e + 1; c++
    }
  }
  const drives: { alias: string; root: number }[] = []
  for (let i = 0; i < driveCount; i++) {
    const o = drivePos + i * 148
    let e = o
    while (e < headerSize && sga[hp + e] !== 0) e++
    drives.push({ alias: new TextDecoder().decode(sga.subarray(hp + o, hp + e)), root: toc.getUint32(o + 144, true) })
  }
  const folders: Topo['folders'] = []
  for (let i = 0; i < folderCount; i++) {
    const o = folderPos + i * 20
    folders.push({
      name: nameAt.get(toc.getUint32(o, true)) ?? '?',
      subFirst: toc.getUint32(o + 4, true), subLast: toc.getUint32(o + 8, true),
      fileFirst: toc.getUint32(o + 12, true), fileLast: toc.getUint32(o + 16, true),
    })
  }
  const files: Topo['files'] = []
  for (let i = 0; i < fileCount; i++) {
    const o = filePos + i * 30
    files.push({ name: nameAt.get(toc.getUint32(o, true)) ?? '?', storage: sga[hp + o + 21] })
  }
  const leafPath = (i: number): string => {
    let bestRange = Infinity, bestName = ''
    for (const f of folders) {
      if (f.fileFirst <= i && i < f.fileLast) {
        const r = f.fileLast - f.fileFirst
        if (r < bestRange) { bestRange = r; bestName = f.name }
      }
    }
    return (bestName ? bestName + '\\' : '') + files[i].name
  }
  const filePaths = files.map((_, i) => leafPath(i))
  return { driveCount, drives, folders, files, filePaths }
}
function assertLoadableSkinLayoutTopology(topo: Topo, label: string): void {
  // (1) 4 canonical drives in order.
  assert.equal(topo.driveCount, 4, `[${label}] driveCount must be 4`)
  assert.deepEqual(topo.drives.map(d => d.alias), ['attrib', 'locale', 'info', 'data'], `[${label}] drive order`)
  // (2) Every drive's root folder is "".
  for (const d of topo.drives) {
    assert.equal(topo.folders[d.root]?.name, '', `[${label}] drive "${d.alias}" root folder must be ""`)
  }
  // (3) NO forward slash in any folder name.
  for (const f of topo.folders) {
    assert.ok(!f.name.includes('/'), `[${label}] folder "${f.name}" must not contain a forward slash`)
  }
  // (4) The COMPLETE ancestor chain exists for every leaf folder.
  const folderNames = new Set(topo.folders.map(f => f.name))
  for (const f of topo.folders) {
    if (f.name === '') continue
    const segs = f.name.split('\\')
    for (let k = 1; k < segs.length; k++) {
      const ancestor = segs.slice(0, k).join('\\')
      assert.ok(folderNames.has(ancestor), `[${label}] missing intermediate folder "${ancestor}" for "${f.name}"`)
    }
  }
  // (5) Sub-folder ranges are non-negative and ordered.
  for (const f of topo.folders) {
    assert.ok(f.subFirst >= 0 && f.subLast >= f.subFirst, `[${label}] folder "${f.name}" sub-range invalid`)
  }
}

// ─── raw-zlib integrity: every stored file decompresses to declared length ────
function assertEveryFileDecompresses(sga: Uint8Array, label: string): number {
  const dv = new DataView(sga.buffer, sga.byteOffset, sga.byteLength)
  const headerSize = dv.getUint32(140, true)
  const dataPosAbs = dv.getUint32(144, true) // ABSOLUTE file offset of the data block
  const hp = 152
  const toc = new DataView(sga.buffer, sga.byteOffset + hp, headerSize)
  const filePos = toc.getUint32(16, true), fileCount = toc.getUint32(20, true)
  let checked = 0
  for (let i = 0; i < fileCount; i++) {
    const o = filePos + i * 30
    const dataOffset = toc.getUint32(o + 4, true)   // rel to dataPosAbs
    const compLen = toc.getUint32(o + 8, true)      // on-disk (compressed) size
    const uncompLen = toc.getUint32(o + 12, true)   // uncompressed size
    const storage = sga[hp + o + 21]                // 0 = store, else zlib
    const start = dataPosAbs + dataOffset
    const bytes = sga.subarray(start, start + compLen)
    if (storage === 0) {
      assert.equal(compLen, uncompLen, `[${label}] stored file #${i} compLen != uncompLen`)
    } else {
      const out = inflateSync(bytes)
      assert.equal(out.length, uncompLen, `[${label}] file #${i} inflate len ${out.length} != declared ${uncompLen}`)
    }
    checked++
  }
  return checked
}

async function roundTrip(sga: Uint8Array, label: string): Promise<{ path: string; length: number }[]> {
  const blob = new Blob([sga])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const archive = await (SgaArchive as any).open(blob)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const files: { path: string; length: number }[] = archive.list()
  assert.ok(files.length > 0, `[${label}] SgaArchive.open returned no files`)
  return files
}

async function gate(sga: Uint8Array, label: string, expectFiles?: number) {
  const files = await roundTrip(sga, label)
  const decompressed = assertEveryFileDecompresses(sga, label)
  const topo = rawTopology(sga)
  assertLoadableSkinLayoutTopology(topo, label)
  if (expectFiles !== undefined) {
    assert.equal(topo.files.length, expectFiles, `[${label}] expected ${expectFiles} files, got ${topo.files.length}`)
  }
  console.log(`  [${label}] GATE PASS — round-trip ${files.length} files, ${decompressed} decompress OK, topology OK`)
  return { files, topo }
}

// ─── DDS wrapper (BC3/DXT5) — matches editor's wrapBc3InDds ───────────────────
function wrapDds(bc3: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(128 + bc3.length)
  const view = new DataView(out.buffer)
  out.set([0x44, 0x44, 0x53, 0x20], 0)
  view.setUint32(4, 124, true)
  view.setUint32(8, 0x00081007, true)
  view.setUint32(12, height, true)
  view.setUint32(16, width, true)
  view.setUint32(20, bc3.length, true)
  view.setUint32(76, 32, true)
  view.setUint32(80, 0x4, true)
  out.set([0x44, 0x58, 0x54, 0x35], 84)
  view.setUint32(108, 0x1000, true)
  out.set(bc3, 128)
  return out
}
function rewriteBytes(buf: Uint8Array, from: string, to: string): Uint8Array {
  const f = new TextEncoder().encode(from), t = new TextEncoder().encode(to)
  const out = new Uint8Array(buf)
  let i = 0
  outer: while (i <= out.length - f.length) {
    for (let k = 0; k < f.length; k++) if (out[i + k] !== f[k]) { i++; continue outer }
    for (let k = 0; k < t.length; k++) out[i + k] = t[k]
    i += t.length
  }
  return out
}
function rewriteInfo(buf: Uint8Array, name: string, desc: string): Uint8Array {
  let text = new TextDecoder('utf-8').decode(buf)
  text = text.replace(/name\s*=\s*"[^"]*"/, `name = "${name.replace(/"/g, '\\"')}"`)
  text = text.replace(/description\s*=\s*"[^"]*"/, `description = "${desc.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`)
  return new TextEncoder().encode(text)
}

// ═══════════════════════════════════════════════════════════════════════════════
console.log('=== BUILD FRESH IN-GAME MODS (decal + faceplate + skin) ===\n')
await mkdir(OUT_DIR, { recursive: true })

// ───────────────────────────────────────────────────────────────────────────────
// 1) DECAL — REAL buildDecalMod(). Honvéd Kereszt national-insignia pack.
// ───────────────────────────────────────────────────────────────────────────────
console.log('1) DECAL — buildDecalMod (Honvéd Kereszt, 5 factions incl. german/aef)')
function keresztIcon(size: number): Uint8ClampedArray {
  const c = createCanvas(size, size); const x = c.getContext('2d')
  x.fillStyle = '#0a0a0a'; x.fillRect(0, 0, size, size)
  const arm = Math.round(size * 0.28), h = size / 2
  x.fillStyle = '#ffffff'
  x.fillRect(0, Math.round(h - arm / 2), size, arm)
  x.fillRect(Math.round(h - arm / 2), 0, arm, size)
  return new Uint8ClampedArray(x.getImageData(0, 0, size, size).data.buffer)
}
const decalProject = newDecalPackProject('Honved Kereszt Insignia')
const decalRes = await buildDecalMod({
  project: decalProject,
  iconRgba: keresztIcon(64),
  decalRgba: keresztIcon(1024),
  guid: DECAL_GUID,
})
const decalPath = path.join(OUT_DIR, `${decalRes.guid}.sga`)
await writeFile(decalPath, decalRes.sga)
const decalGate = await gate(decalRes.sga, 'decal')
console.log(`  built ${decalRes.sga.length} B → ${decalPath} (guid ${decalRes.guid}, slug ${decalRes.slug})`)

// ───────────────────────────────────────────────────────────────────────────────
// 2) FACEPLATE — REAL buildFaceplateMod(). "HONVÉD" short-text banner.
// ───────────────────────────────────────────────────────────────────────────────
console.log('\n2) FACEPLATE — buildFaceplateMod ("HONVÉD" text banner)')
function faceplateAtlas(): Uint8ClampedArray {
  const c = createCanvas(ATLAS_WIDTH, ATLAS_HEIGHT); const x = c.getContext('2d')
  // Honvéd tricolor gradient field
  x.fillStyle = '#1c231a'; x.fillRect(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT)
  x.fillStyle = '#477050'; x.fillRect(0, 0, ATLAS_WIDTH, 8)
  x.fillStyle = '#CE2939'; x.fillRect(0, ATLAS_HEIGHT - 8, ATLAS_WIDTH, 8)
  // short text
  x.fillStyle = '#f0ece0'
  x.font = 'bold 96px sans-serif'
  x.textAlign = 'center'; x.textBaseline = 'middle'
  x.fillText('HONVÉD', ATLAS_WIDTH / 2, ATLAS_HEIGHT / 2)
  return new Uint8ClampedArray(x.getImageData(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT).data.buffer)
}
const fpProject = newFaceplateProject('Honved Faceplate')
const fpRes = await buildFaceplateMod({
  project: fpProject,
  atlasRgba: faceplateAtlas(),
  guid: FACEPLATE_GUID,
})
const fpPath = path.join(OUT_DIR, `${fpRes.guid}.sga`)
await writeFile(fpPath, fpRes.sga)
const fpGate = await gate(fpRes.sga, 'faceplate', 6) // faceplate MUST be exactly 6 files
console.log(`  built ${fpRes.sga.length} B → ${fpPath} (guid ${fpRes.guid}, slug ${fpRes.slug})`)

// ───────────────────────────────────────────────────────────────────────────────
// 3) SKIN — real German Tiger diffuse via editor writer path (buildSga + template
//    German skin_pack RGDs + canvasToRgt). Same code exportSkinPack uses at
//    mod-export.ts:706; only the archive-locate/composite front-end is replaced
//    with the real 2048² tiger.png (no live game handle available headless).
// ───────────────────────────────────────────────────────────────────────────────
console.log('\n3) SKIN — German Tiger Honvéd camo (real 2048² diffuse, editor writer path)')
assert.ok(existsSync(TIGER_DIFFUSE), `tiger diffuse missing: ${TIGER_DIFFUSE}`)
const SKIN_TEMPLATE_GUID = '935a02ef44344ea29108b57b9cb7b9f5'
const skinFiles: { path: string; bytes: Uint8Array; compress?: boolean }[] = []

// Tiger diffuse → RGT (BC3, summer + winter slots) — the real editor RGT writer.
const tigerImg = await loadImage(TIGER_DIFFUSE)
const tigerCanvas = createCanvas(2048, 2048)
const tctx = tigerCanvas.getContext('2d')
tctx.drawImage(tigerImg as unknown as Parameters<typeof tctx.drawImage>[0], 0, 0, 2048, 2048)
const difTset = `art\\armies\\german\\vehicles\\tiger\\tiger_dif`
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tigerRgt = (canvasToRgt as any)(tigerCanvas, difTset, { compress: true, format: 'bc3', fbif: true }) as Uint8Array
for (const season of ['summer', 'winter'] as const) {
  skinFiles.push({
    path: `art/armies/german/vehicles/tiger/skins/${SKIN_GUID}_${season}/tiger_dif.rgt`,
    bytes: tigerRgt, compress: false,
  })
}
console.log(`  tiger RGT: ${tigerRgt.length} B (×2 seasons)`)

// Template files (real German skin_pack RGDs, .info, .ucs, .gfx) — GUID-rewritten.
const readTmpl = async (rel: string) => new Uint8Array(await readFile(path.join(TEMPLATE_DIR, rel)))
const SKIN_TEMPLATE_FILES = [
  'attrib/skin_pack/german/caf_ss3_summer_heavy.rgd',
  'attrib/skin_pack/german/caf_ss3_summer_light.rgd',
  'attrib/skin_pack/german/caf_ss3_summer_medium.rgd',
  'attrib/skin_pack/german/caf_ss3_winter_heavy.rgd',
  'attrib/skin_pack/german/caf_ss3_winter_light.rgd',
  'attrib/skin_pack/german/caf_ss3_winter_medium.rgd',
  `ui/bin/${SKIN_TEMPLATE_GUID}.gfx`,
]
skinFiles.push({
  path: `${SKIN_GUID}.info`,
  bytes: rewriteInfo(rewriteBytes(await readTmpl(`${SKIN_TEMPLATE_GUID}.info`), SKIN_TEMPLATE_GUID, SKIN_GUID),
    'Honved Tiger Camo', 'Hungarian Honved 3-tone camouflage for the Ostheer Tiger.'),
  compress: true,
})
for (const rel of SKIN_TEMPLATE_FILES) {
  skinFiles.push({
    path: rel.replace(SKIN_TEMPLATE_GUID, SKIN_GUID),
    bytes: rewriteBytes(await readTmpl(rel), SKIN_TEMPLATE_GUID, SKIN_GUID),
    compress: true,
  })
}
skinFiles.push({
  path: 'english/english.ucs',
  bytes: rewriteBytes(await readTmpl('english/english.ucs'), SKIN_TEMPLATE_GUID, SKIN_GUID),
  compress: true,
})
// Custom 256² skin icon (Kereszt over camo swatch) for the _i1.dds slot.
function skinIcon(size: number): Uint8ClampedArray {
  const c = createCanvas(size, size); const x = c.getContext('2d')
  x.fillStyle = '#C8A96E'; x.fillRect(0, 0, size, size)
  x.fillStyle = '#4A5A35'; x.fillRect(0, Math.round(size * 0.55), size, size)
  const sq = Math.round(size * 0.6), sx = Math.round((size - sq) / 2), sy = sx
  x.fillStyle = '#0a0a08'; x.fillRect(sx, sy, sq, sq)
  const arm = Math.round(sq * 0.3), cx = sx + sq / 2, cy = sy + sq / 2
  x.fillStyle = '#f0ece0'
  x.fillRect(sx, Math.round(cy - arm / 2), sq, arm)
  x.fillRect(Math.round(cx - arm / 2), sy, arm, sq)
  return new Uint8ClampedArray(x.getImageData(0, 0, size, size).data.buffer)
}
const SKIN_ICON = 256
skinFiles.push({
  path: `ui/assets/textures/${SKIN_GUID}_i1.dds`,
  bytes: wrapDds(encodeBc3(skinIcon(SKIN_ICON), SKIN_ICON, SKIN_ICON), SKIN_ICON, SKIN_ICON),
  compress: true,
})

const skinSga = await buildSga({ archiveName: SKIN_GUID, files: skinFiles })
const skinPath = path.join(OUT_DIR, `${SKIN_NUMERIC_ID}.sga`)
await writeFile(skinPath, skinSga)
const skinGate = await gate(skinSga, 'skin')
console.log(`  built ${(skinSga.length / 1024 / 1024).toFixed(1)} MB → ${skinPath} (guid ${SKIN_GUID}, id ${SKIN_NUMERIC_ID})`)

// ───────────────────────────────────────────────────────────────────────────────
// 4) INSTALL — list dir before/after, copy alongside existing SGAs (no deletion).
// ───────────────────────────────────────────────────────────────────────────────
console.log('\n=== INSTALL (alongside existing SGAs — no deletion) ===')
async function install(sgaSrc: string, destDir: string, destName: string, label: string) {
  const dest = path.join(destDir, destName)
  const before = (await readdir(destDir).catch(() => [])).filter(f => f.endsWith('.sga'))
  const collision = existsSync(dest)
  await copyFile(sgaSrc, dest)
  const after = (await readdir(destDir)).filter(f => f.endsWith('.sga'))
  console.log(`\n[${label}] ${destDir}`)
  console.log(`  BEFORE (${before.length} sga): ${before.join(', ')}`)
  console.log(`  ${collision ? 'OVERWRITE (byte-identical GUID collision)' : 'ADDED'}: ${destName}`)
  console.log(`  AFTER  (${after.length} sga): ${after.join(', ')}`)
  return dest
}
const installedDecal = await install(decalPath, DIR_DECALS_SUBS, `${DECAL_GUID}.sga`, 'DECAL')
const installedFaceplate = await install(fpPath, DIR_FACEPLATES_SUBS, `${FACEPLATE_GUID}.sga`, 'FACEPLATE')
const installedSkin = await install(skinPath, DIR_SKINS, `${SKIN_NUMERIC_ID}.sga`, 'SKIN')

// ───────────────────────────────────────────────────────────────────────────────
// 5) Bank manifest.
// ───────────────────────────────────────────────────────────────────────────────
const WARNINGS_LOG = path.join(PFX, 'warnings.log')
const decalNames = decalGate.files.map(f => f.path).filter(p => /\.(rgd|dds|rgt)$/.test(p))
const fpNames = fpGate.files.map(f => f.path).filter(p => /\.(rgd|dds)$/.test(p))
const skinRgts = skinGate.files.map(f => f.path).filter(p => p.endsWith('.rgt'))
const grep = `grep -iE '${DECAL_GUID}|${FACEPLATE_GUID}|${SKIN_NUMERIC_ID}|${SKIN_GUID}' "${WARNINGS_LOG}"`

const manifest = `# Fresh In-Game Mods — Install Manifest (${new Date().toISOString()})

Built via the CURRENT editor build code path (buildDecalMod / buildFaceplateMod are the
real builders; skin via buildSga + public/template German skin_pack + canvasToRgt — the
same writer/template/RGT path exportSkinPack uses at mod-export.ts:706). Each passed:
SgaArchive round-trip, per-file raw-zlib-decompress == declared length, and the structural
load-compatibility topology guard (4 drives in order / "" roots / no forward slash /
full ancestor chains / faceplate == 6 files incl. root .dds).

## 1. DECAL — Honvéd Kereszt national-insignia pack (5 factions incl. german/aef)
- Installed: \`${installedDecal}\`
- GUID / [ID]: \`${DECAL_GUID}\`  (slug \`${decalRes.slug}\`)
- Internal .rgd/.rgt/.dds names:
${decalNames.map(n => `    - ${n}`).join('\n')}

## 2. FACEPLATE — "HONVÉD" short-text banner (exactly 6 files)
- Installed: \`${installedFaceplate}\`
- GUID / [ID]: \`${FACEPLATE_GUID}\`  (slug \`${fpRes.slug}\`)
- Internal .rgd/.dds names:
${fpNames.map(n => `    - ${n}`).join('\n')}

## 3. SKIN — German Tiger Honvéd camo (real 2048² tiger diffuse)
- Installed: \`${installedSkin}\`
- On-disk numeric id: \`${SKIN_NUMERIC_ID}\`   internal asset GUID: \`${SKIN_GUID}\`
- Internal RGTs (summer + winter):
${skinRgts.map(n => `    - ${n}`).join('\n')}

## Verification grep (run after the next harness launch, once CoH2 rewrites warnings.log)
\`\`\`
${grep}
\`\`\`

### PASS criterion (per GUID/id)
For EACH of the three ids the log must show an
    \`ARC -- ... <id> ... [Sig:0]\`
line (archive opened, unsigned OK) and MUST NOT be followed by
    \`MOD -- Error loading mod pack '<id>...': invalid file structure\`
or
    \`MOD -- Error ... <something>.rgd not permitted\`
for that same id. Absence of any \`invalid file structure\` / \`not permitted\` line for the
id == LOAD SUCCESS. (Decal/faceplate are keyed by the 32-hex GUID; the skin appears as the
numeric filename \`${SKIN_NUMERIC_ID}.sga\` and/or its internal GUID \`${SKIN_GUID}\`.)
`
const manifestPath = path.join(ROOT, 'artifacts', 'ingame-verify', 'fresh-mods-manifest.md')
await writeFile(manifestPath, manifest)
console.log(`\n=== MANIFEST → ${manifestPath} ===`)
console.log('\n=== DONE — all 3 fresh mods built (real builders), gated, and installed ===')
console.log(`grep to run post-launch:\n${grep}`)
