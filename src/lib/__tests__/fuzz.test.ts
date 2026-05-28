/**
 * Property-based fuzz suite using fast-check.
 *
 * Three surfaces under test:
 *   3a. SGA reader/writer round-trip — 100 cases
 *   3b. composeFaceplateCanvas determinism — 30 cases (canvas backend
 *       now available via the `canvas` devDep + jsdom auto-detection)
 *   3c. Faceplate-project JSON round-trip — 200 cases
 *
 * File shim
 * ---------
 * SgaArchive.open() expects a browser File with .slice(start, end).arrayBuffer().
 * We use the same MemFile shim as sga-roundtrip.test.ts.
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { buildSga } from '@/lib/sga-writer'
import { SgaArchive } from '@/lib/sga'
import {
  newFaceplateProject,
  newImageLayer,
  newTextLayer,
  newShapeLayer,
  newPaintLayer,
  readFaceplateFile,
  type Coh2FaceplateProject,
  type ImageLayer,
  type TextLayer,
  type ShapeLayer,
  type PaintLayer,
} from '@/lib/faceplate-project'
import { composeFaceplateCanvas } from '@/components/FaceplateEditor'

// ─── MemFile shim (mirrors sga-roundtrip.test.ts) ─────────────────────────────

class MemFile {
  readonly name: string
  readonly size: number
  private readonly data: Uint8Array

  constructor(data: Uint8Array, name = 'fuzz.sga') {
    this.data = data
    this.name = name
    this.size = data.length
  }

  slice(start: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> } {
    const sliced = this.data.slice(start, end)
    return {
      arrayBuffer: () => Promise.resolve(sliced.buffer as ArrayBuffer),
    }
  }
}

// ─── 3a. SGA reader/writer round-trip ────────────────────────────────────────

/**
 * Arbitrary for a valid SGA file entry.
 * Filenames are restricted to printable ASCII that is safe on all OS paths;
 * the SGA path separator is '/', which is excluded from the filename.
 */
const sgaFileArb = fc.record({
  // path: one to three directory segments + a filename with extension
  path: fc
    .tuple(
      fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
      fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
      fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
    )
    .map(([dir, base, ext]) => `data/${dir}/${base}.${ext}`),
  data: fc.uint8Array({ minLength: 1, maxLength: 1024 }),
})

describe('3a — SGA reader/writer round-trip (property-based)', () => {
  it('100 random file trees: every file comes back byte-for-byte identical', async () => {
    // Wrap async property with a synchronous outer it by collecting failures.
    const failures: string[] = []

    await fc.assert(
      fc.asyncProperty(fc.array(sgaFileArb, { minLength: 1, maxLength: 6 }), async entries => {
        // Deduplicate paths — SGA doesn't support two files at the same path.
        const seen = new Set<string>()
        const unique = entries.filter(e => {
          if (seen.has(e.path)) return false
          seen.add(e.path)
          return true
        })
        if (unique.length === 0) return // trivially skip

        const sgaBytes = await buildSga({
          archiveName: 'FuzzTest',
          files: unique.map(e => ({
            path: e.path,
            bytes: e.data,
            compress: false, // keep it fast; storage=0 is fully covered by sga-roundtrip tests
          })),
        })

        const archive = await SgaArchive.open(new MemFile(sgaBytes) as unknown as File)

        for (const entry of unique) {
          const result = await archive.readByPath(entry.path)
          if (result === null) {
            failures.push(`Path not found after round-trip: ${entry.path}`)
            return false
          }
          if (Array.from(result).join(',') !== Array.from(entry.data).join(',')) {
            failures.push(`Byte mismatch for: ${entry.path}`)
            return false
          }
        }
        return true
      }),
      { numRuns: 100 },
    )

    expect(failures).toEqual([])
  })
})

// ─── 3b. composeFaceplateCanvas determinism ───────────────────────────────────

describe('3b — composeFaceplateCanvas determinism', () => {
  // Apple's snapshot-test discipline: render the same project twice and
  // assert the resulting pixel buffer is byte-identical. Any drift here
  // would mean the composer depends on iteration order, wall-clock time,
  // or some other non-deterministic input — exactly the class of bug
  // that would make user-facing previews flicker between repaints.
  //
  // Backend: the `canvas` devDep is auto-detected by jsdom, so
  // `getContext('2d')` returns a real Skia-backed context.
  //
  // Scope: we exercise the common-case BACKGROUND-only composition path
  // (no layers). Shape/image/text layers are not exercised here because
  // node-canvas doesn't ship a Path2D polyfill (shape rendering uses
  // `new Path2D()`), and jsdom doesn't decode <img> from data: URLs in
  // the headless test env. The full layered composition path is covered
  // by the editor's snapshot tests and by the Playwright e2e smoke spec
  // — see `e2e/redesign-smoke.spec.ts`. The intent of THIS test is to
  // pin the composer's foundational determinism guarantee (same input
  // bytes in → same pixel bytes out) which any layer-rendering bug
  // would also surface in user-facing previews.
  //
  // 50 cases keeps this test under 1 s wall-clock.
  it('two compositions of the same background-only project produce byte-identical PNGs', async () => {
    const hexColor = fc
      .integer({ min: 0, max: 0xffffff })
      .map(n => `#${n.toString(16).padStart(6, '0')}`)

    await fc.assert(
      fc.asyncProperty(hexColor, async bg => {
        const project: Coh2FaceplateProject = {
          ...newFaceplateProject(),
          backgroundColor: bg,
          layers: [],
        }
        const canvasA = await composeFaceplateCanvas(project)
        const canvasB = await composeFaceplateCanvas(project)
        const a = canvasA.toDataURL('image/png')
        const b = canvasB.toDataURL('image/png')
        return a === b
      }),
      { numRuns: 50 },
    )
  })
})

// ─── 3c. Faceplate-project JSON round-trip ────────────────────────────────────

/**
 * Arbitrary for an ImageLayer built via the public factory (so defaults are valid).
 */
const imageLayerArb: fc.Arbitrary<ImageLayer> = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter(s => /^[a-zA-Z0-9_]+$/.test(s))
  .map(id => {
    const l = newImageLayer(`fpimg_${id}`)
    return l
  })

/**
 * Arbitrary for a TextLayer — use the factory then patch text/color/size to
 * random but valid values.
 */
const textLayerArb: fc.Arbitrary<TextLayer> = fc
  .record({
    text: fc.string({ minLength: 0, maxLength: 80 }),
    fontSize: fc.integer({ min: 8, max: 200 }),
    color: fc.constantFrom('#ffffff', '#ff0000', '#00ff00', '#000000', '#aabbcc'),
    align: fc.constantFrom('left', 'center', 'right') as fc.Arbitrary<'left' | 'center' | 'right'>,
  })
  .map(({ text, fontSize, color, align }) => {
    const l = newTextLayer(text)
    l.fontSize = fontSize
    l.color = color
    l.align = align
    return l
  })

/**
 * Arbitrary for a ShapeLayer — use the factory then patch shapeType.
 */
const shapeLayerArb: fc.Arbitrary<ShapeLayer> = fc
  .constantFrom(
    'rectangle' as const,
    'circle' as const,
    'chevron' as const,
    'star' as const,
    'shield' as const,
  )
  .map(shapeType => {
    const l = newShapeLayer(shapeType)
    return l
  })

/**
 * Arbitrary for a PaintLayer — use the factory with the blank 1×1 PNG.
 */
const paintLayerArb: fc.Arbitrary<PaintLayer> = fc.constant(null).map(() => newPaintLayer())

/**
 * Arbitrary for a faceplate project — a valid shell with random layers.
 */
const faceplateProjectArb: fc.Arbitrary<Coh2FaceplateProject> = fc
  .record({
    packName: fc.string({ minLength: 1, maxLength: 60 }),
    layers: fc.array(fc.oneof(imageLayerArb, textLayerArb, shapeLayerArb, paintLayerArb), {
      minLength: 0,
      maxLength: 5,
    }),
    backgroundColor: fc.option(fc.constantFrom('#000000', '#ff0000', '#aabbcc', '#123456'), {
      nil: null,
    }),
  })
  .map(({ packName, layers, backgroundColor }) => {
    const p = newFaceplateProject(packName)
    p.layers = layers
    p.backgroundColor = backgroundColor
    return p
  })

describe('3c — faceplate-project JSON round-trip (property-based)', () => {
  it('200 random projects: JSON.parse(JSON.stringify(p)) preserves all fields', () => {
    fc.assert(
      fc.property(faceplateProjectArb, p => {
        const serialized = JSON.stringify(p)
        const deserialized = JSON.parse(serialized) as Coh2FaceplateProject

        // Top-level scalars
        expect(deserialized.magic).toBe(p.magic)
        expect(deserialized.version).toBe(p.version)
        expect(deserialized.packName).toBe(p.packName)
        expect(deserialized.id).toBe(p.id)
        expect(deserialized.author).toBe(p.author)
        expect(deserialized.backgroundColor).toBe(p.backgroundColor)
        expect(deserialized.modifiedAt).toBe(p.modifiedAt)

        // Layer fidelity
        expect(deserialized.layers).toHaveLength(p.layers.length)
        for (let i = 0; i < p.layers.length; i++) {
          const orig = p.layers[i]
          const rt = deserialized.layers[i]
          expect(rt.kind).toBe(orig.kind)
          expect(rt.id).toBe(orig.id)
          if (orig.kind !== 'group' && rt.kind !== 'group') {
            expect(rt.x).toBe(orig.x)
            expect(rt.y).toBe(orig.y)
          }
          expect(rt.visible).toBe(orig.visible)
        }
      }),
      { numRuns: 200 },
    )
  })

  it('200 random projects: readFaceplateFile round-trips via File object', async () => {
    await fc.assert(
      fc.asyncProperty(faceplateProjectArb, async p => {
        const json = JSON.stringify(p)
        const file = new File([json], 'fuzz.coh2faceplate', { type: 'application/json' })
        const loaded = await readFaceplateFile(file)

        // readFaceplateFile runs migration which stamps the current version (v7)
        expect(loaded.magic).toBe('coh2-faceplate-project')
        expect(loaded.version).toBe(7)
        expect(loaded.packName).toBe(p.packName)
        expect(loaded.id).toBe(p.id)
        expect(loaded.layers).toHaveLength(p.layers.length)

        return true
      }),
      { numRuns: 200 },
    )
  })
})
