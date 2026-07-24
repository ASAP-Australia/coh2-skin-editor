/**
 * Forensic harness: build a REAL decal SGA + REAL faceplate SGA via the actual
 * editor code paths (buildDecalMod / buildFaceplateMod) and dump their full TOC
 * so it can be diffed against working ground-truth Workshop packs.
 *
 * Run: npx tsx --tsconfig tsconfig.node.json scripts/dump-editor-sgas.mts
 */
import { createCanvas } from 'canvas'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const SRC_LIB = path.join(ROOT, 'src', 'lib')

const { buildDecalMod } = await import(`${SRC_LIB}/decal-mod-build.ts`)
const { buildFaceplateMod } = await import(`${SRC_LIB}/faceplate-mod-build.ts`)
const { newDecalPackProject } = await import(`${SRC_LIB}/decal-pack-project.ts`)
const { newFaceplateProject } = await import(`${SRC_LIB}/faceplate-project.ts`)
const { ATLAS_WIDTH, ATLAS_HEIGHT } = await import(`${SRC_LIB}/faceplate-templates.ts`)

// ---- Build a real decal SGA ----
const decalProject = newDecalPackProject('Krispy Kreme Decal')
const iconRgba = new Uint8ClampedArray(64 * 64 * 4).fill(255)
const decalRes = await buildDecalMod({
  project: decalProject,
  iconRgba,
  guid: 'c6e8e078dbfa6a645c6abf7862454428',
})
writeFileSync('/tmp/editor-decal.sga', decalRes.sga)
console.log(`Built decal SGA: /tmp/editor-decal.sga (${decalRes.sga.length} B, guid ${decalRes.guid})`)

// ---- Build a real faceplate SGA ----
const fpProject = newFaceplateProject('Krispy Kreme Faceplate')
const atlasRgba = new Uint8ClampedArray(ATLAS_WIDTH * ATLAS_HEIGHT * 4).fill(200)
const fpRes = await buildFaceplateMod({
  project: fpProject,
  atlasRgba,
  guid: 'aadd6753d08a976329fededa60ab9b1f',
})
writeFileSync('/tmp/editor-faceplate.sga', fpRes.sga)
console.log(`Built faceplate SGA: /tmp/editor-faceplate.sga (${fpRes.sga.length} B, guid ${fpRes.guid})`)
