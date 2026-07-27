/**
 * END-TO-END SKIN TEST, step 1 of 2 — build a skin with the app's own export
 * pipeline and INSTALL it into the live CoH2 mods folder.
 *
 * WHY THIS EXISTS. Layers A–E each verify a link in the chain: the app writes
 * correct texture bytes, the engine renders textures faithfully, camo/decals
 * appear in-engine. But the chain itself had never been run end to end — every
 * in-game vehicle photographed so far was wearing a THIRD-PARTY Workshop skin
 * (identified as 899558033.sga), never one produced by this app. Until a skin
 * authored here is seen in the running game, "will my skin display correctly?"
 * is unproven.
 *
 * DESIGN — the paint is deliberately hideous. Large magenta/cyan diagonal bands
 * with orange blobs. Nothing in CoH2, and none of the user's 48 installed
 * skins, looks remotely like this. That removes any judgement call from the
 * verification step: if the tank on screen is magenta, it is ours, full stop.
 * A tasteful camo would be indistinguishable from the dozens already installed.
 *
 * GATED. Writing into the user's game install is a side effect, so this is a
 * no-op unless E2E_INSTALL_SKIN=1. `npm test` stays clean.
 *
 *   E2E_INSTALL_SKIN=1 npx vitest run src/lib/__tests__/e2e-install-test-skin.test.ts
 *
 * Uninstall: delete the printed .sga (the test prints its exact path), or run
 * with E2E_UNINSTALL_SKIN=1 to remove any previously installed copy.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import fsSync from 'node:fs'
import path from 'node:path'

import { newProject } from '../project'
import { exportSkinPack } from '../mod-export'
import { VEHICLES } from '../vehicles'

const ENABLED = process.env.E2E_INSTALL_SKIN === '1'
const UNINSTALL = process.env.E2E_UNINSTALL_SKIN === '1'

const SKINS_DIR =
  '/var/home/jflessenkemper/.local/share/Steam/steamapps/compatdata/231430/pfx/drive_c/users/steamuser/Documents/My Games/Company of Heroes 2/mods/skins'
const INSTALL_NAME = 'ZZZ_CLAUDE_E2E_TEST.sga'
const CANDIDATE_ROOTS = [
  '/var/home/jflessenkemper/.local/share/Steam/steamapps/common/Company of Heroes 2',
  '/home/jflessenkemper/.steam/steam/steamapps/common/Company of Heroes 2',
]

function nodeDirHandle(diskPath: string): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name: path.basename(diskPath),
    async getDirectoryHandle(name: string) {
      const sub = path.join(diskPath, name)
      if (!fsSync.existsSync(sub)) throw new Error(`no dir ${sub}`)
      return nodeDirHandle(sub)
    },
    async getFileHandle(name: string) {
      const fp = path.join(diskPath, name)
      if (!fsSync.existsSync(fp)) throw new Error(`no file ${fp}`)
      return {
        kind: 'file',
        name,
        async getFile() {
          const st = fsSync.statSync(fp)
          const fd = fsSync.openSync(fp, 'r')
          return {
            name,
            size: st.size,
            slice(start = 0, end?: number) {
              const e = end ?? st.size
              const len = Math.max(0, e - start)
              return {
                arrayBuffer: async () => {
                  const b = Buffer.alloc(len)
                  if (len > 0) fsSync.readSync(fd, b, 0, len, start)
                  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
                },
              }
            },
            arrayBuffer: async () => {
              const b = fsSync.readFileSync(fp)
              return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
            },
          } as unknown as FileSystemFileHandle
        },
      } as unknown as FileSystemDirectoryHandle
    },
    async *values() {
      for (const e of fsSync.readdirSync(diskPath, { withFileTypes: true })) {
        yield e.isDirectory()
          ? await (this as FileSystemDirectoryHandle).getDirectoryHandle(e.name)
          : await (this as FileSystemDirectoryHandle).getFileHandle(e.name)
      }
    },
  } as unknown as FileSystemDirectoryHandle
}

/** Unmistakable paint: magenta/cyan bands + orange blobs, 2048². */
function screamingDiffuse(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createCanvas } = require('canvas') as typeof import('canvas')
  const c = createCanvas(2048, 2048)
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#FF00C8' // magenta base
  ctx.fillRect(0, 0, 2048, 2048)
  ctx.fillStyle = '#00FFF0' // cyan bands
  ctx.save()
  ctx.translate(1024, 1024)
  ctx.rotate(Math.PI / 5)
  for (let i = -2400; i < 2400; i += 320) ctx.fillRect(i, -2400, 150, 4800)
  ctx.restore()
  ctx.fillStyle = '#FF8A00' // orange blobs
  for (let i = 0; i < 14; i++) {
    ctx.beginPath()
    ctx.ellipse(180 + i * 130, 220 + ((i * 331) % 1700), 150, 90, (i * Math.PI) / 5, 0, Math.PI * 2)
    ctx.fill()
  }
  return c.toDataURL('image/png')
}

// jsdom has no usable fetch base and no real canvas image decode, so
// exportSkinPack's template fetch + image paths need the same polyfills the
// every-vehicle test installs. Without the fetch shim it dies on
// "Invalid URL: /template/<guid>.info".
const TEMPLATE_DIR = path.resolve(__dirname, '../../../public/template')
let realFetch: typeof globalThis.fetch
let realImage: typeof globalThis.Image | undefined
let realCreateImageBitmap: typeof globalThis.createImageBitmap | undefined

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCanvas = require('canvas') as typeof import('canvas')

  realCreateImageBitmap = globalThis.createImageBitmap
  ;(globalThis as unknown as Record<string, unknown>).createImageBitmap = async (
    src: Blob | ArrayBufferView | ArrayBuffer,
  ) => {
    let buf: Buffer
    if (src instanceof Blob) buf = Buffer.from(await src.arrayBuffer())
    else if (ArrayBuffer.isView(src)) buf = Buffer.from(src.buffer, src.byteOffset, src.byteLength)
    else buf = Buffer.from(src as ArrayBuffer)
    return (await nodeCanvas.loadImage(buf)) as unknown as ImageBitmap
  }

  realImage = globalThis.Image
  ;(globalThis as unknown as Record<string, unknown>).Image =
    nodeCanvas.Image as unknown as typeof Image

  realFetch = globalThis.fetch
  ;(globalThis as unknown as { fetch: typeof fetch }).fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const m = url.match(/\/template\/(.+)$/)
    if (m) {
      const buf = await fs.readFile(path.join(TEMPLATE_DIR, m[1]))
      return new Response(new Uint8Array(buf), {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      })
    }
    return realFetch(input, init)
  }) as typeof fetch
})

afterAll(() => {
  ;(globalThis as unknown as { fetch: typeof fetch }).fetch = realFetch
  if (realImage) (globalThis as unknown as Record<string, unknown>).Image = realImage
  if (realCreateImageBitmap) {
    ;(globalThis as unknown as Record<string, unknown>).createImageBitmap = realCreateImageBitmap
  }
})

describe('E2E: install an app-built skin into the live CoH2 mods folder', () => {
  it(ENABLED || UNINSTALL ? 'builds + installs' : 'skipped (set E2E_INSTALL_SKIN=1)', async () => {
    const dest = path.join(SKINS_DIR, INSTALL_NAME)

    if (UNINSTALL) {
      if (fsSync.existsSync(dest)) {
        await fs.unlink(dest)
        console.log(`[e2e-skin] REMOVED ${dest}`)
      } else {
        console.log('[e2e-skin] nothing to remove')
      }
      return
    }
    if (!ENABLED) return

    const installPath = CANDIDATE_ROOTS.find(p => fsSync.existsSync(p))
    expect(installPath, 'CoH2 install not found').toBeTruthy()

    // Every GERMAN vehicle, so whatever the ASAP Verify grid spawns is painted.
    const german = VEHICLES.filter(v => v.faction === 'german')
    expect(german.length).toBeGreaterThan(0)

    const proj = newProject('CLAUDE E2E TEST — DELETE ME')
    proj.packDescription = 'End-to-end verification skin. Magenta/cyan. Safe to delete.'
    proj.author = 'Claude / CoH2 Modding Tool'
    const diffuse = screamingDiffuse()
    for (const v of german) {
      proj.vehicles[v.id] = {
        id: v.id,
        tac: v.defaultTac,
        name: v.displayName,
        decals: [],
        customDiffuseUrl: diffuse,
      }
    }

    const root = nodeDirHandle(installPath!)
    const result = await exportSkinPack(root, proj, () => {})
    expect(result.bytes.length).toBeGreaterThan(2048)
    expect(result.textureCount).toBe(german.length)

    await fs.mkdir(SKINS_DIR, { recursive: true })
    await fs.writeFile(dest, result.bytes)

    console.log(`[e2e-skin] vehicles painted : ${german.length}`)
    console.log(`[e2e-skin] modGuid          : ${result.modGuid}`)
    console.log(`[e2e-skin] numericId        : ${result.numericId}`)
    console.log(`[e2e-skin] INSTALLED        : ${dest} (${result.bytes.length} bytes)`)
    expect(fsSync.existsSync(dest)).toBe(true)
  }, 300_000)
})
