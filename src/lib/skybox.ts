/**
 * CoH2 skybox loader — builds a Three.js CubeTexture from ArtEnvironment.sga.
 *
 * CoH2 skybox textures live under art/ui/skies/<envName>/ and use:
 *   <envName>_sky_side.rgt  — 4:1 strip: front | right | back | left
 *   <envName>_sky_top.rgt   — top cap
 *   <envName>_sky_bot.rgt   — bottom cap (may also be _sky_bottom.rgt)
 *
 * Returns null (not a rejection) if the assets aren't found so callers can
 * fall back to a plain background colour gracefully.
 */

import * as THREE from 'three'
import { type SgaArchive } from './sga'
import { decodeRgt } from './rgt'
import { bcToCanvas } from './bc-decode'

export const SKYBOX_ENVS = [
  'mission_00', 'mission_01', 'mission_02', 'mission_03', 'mission_04',
  'mission_05', 'mission_06', 'mission_07', 'mission_08', 'mission_09',
  'mission_10', 'mission_11', 'mission_12', 'mission_13', 'mission_14',
  'mission_15', 'mission_16',
  'foggy_autumn_day',
  'caen_dawn', 'caen_midday', 'caen_night',
  'stormy_sky',
]

/** Three.js CubeTexture face order: px, nx, py, ny, pz, nz
 *  Maps to the CoH2 side-wrap strip order: right, left, top, bottom, front, back
 *  Strip layout (left→right): front | right | back | left */

async function loadRgtCanvas(archive: SgaArchive, path: string): Promise<HTMLCanvasElement | null> {
  const bytes = await archive.readByPath(path)
  if (!bytes) return null
  try {
    const rgt = decodeRgt(bytes)
    return bcToCanvas(rgt.pixels, rgt.width, rgt.height, rgt.fourCC)
  } catch (e) {
    console.warn('[skybox] failed to decode', path, e)
    return null
  }
}

function sliceCanvas(src: HTMLCanvasElement, x: number, y: number, w: number, h: number): HTMLCanvasElement {
  const dst = document.createElement('canvas')
  dst.width = w; dst.height = h
  dst.getContext('2d')!.drawImage(src, x, y, w, h, 0, 0, w, h)
  return dst
}

function solidCanvas(size: number, color: string): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  ctx.fillStyle = color; ctx.fillRect(0, 0, size, size)
  return c
}

function canvasToTexture(canvas: HTMLCanvasElement): THREE.Texture {
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Try to load a skybox for the given environment name from the archive.
 *  Returns null (graceful) if assets are not found. */
export async function loadSkybox(archive: SgaArchive, envName: string): Promise<THREE.CubeTexture | null> {
  const base = `art/ui/skies/${envName}/${envName}`

  // Try multiple naming conventions seen in CoH2 SGAs
  const sideVariants = [
    `${base}_sky_side.rgt`,
    `${base}_sky.rgt`,
    `art/ui/skies/${envName}/sky_side.rgt`,
    `art/ui/skies/${envName}/sky.rgt`,
  ]
  const topVariants = [
    `${base}_sky_top.rgt`,
    `art/ui/skies/${envName}/sky_top.rgt`,
    `${base}_sky_top_bot.rgt`,
  ]
  const botVariants = [
    `${base}_sky_bot.rgt`,
    `${base}_sky_bottom.rgt`,
    `art/ui/skies/${envName}/sky_bot.rgt`,
    `${base}_sky_top_bot.rgt`,
  ]

  let sideCanvas: HTMLCanvasElement | null = null
  for (const path of sideVariants) {
    sideCanvas = await loadRgtCanvas(archive, path)
    if (sideCanvas) break
  }
  if (!sideCanvas) {
    console.warn('[skybox] no side texture found for', envName)
    return null
  }

  // Side strip is 4 panels wide. Slice: front(0), right(1), back(2), left(3)
  const panelW = Math.floor(sideCanvas.width / 4)
  const panelH = sideCanvas.height
  const front  = sliceCanvas(sideCanvas, 0,           0, panelW, panelH)
  const right  = sliceCanvas(sideCanvas, panelW,      0, panelW, panelH)
  const back   = sliceCanvas(sideCanvas, panelW * 2,  0, panelW, panelH)
  const left   = sliceCanvas(sideCanvas, panelW * 3,  0, panelW, panelH)

  let topCanvas: HTMLCanvasElement | null = null
  for (const path of topVariants) {
    topCanvas = await loadRgtCanvas(archive, path)
    if (topCanvas) break
  }
  let botCanvas: HTMLCanvasElement | null = null
  for (const path of botVariants) {
    botCanvas = await loadRgtCanvas(archive, path)
    if (botCanvas) break
  }

  const fallback = solidCanvas(panelW, '#c8c8d8')
  const top = topCanvas ?? fallback
  const bot = botCanvas ?? fallback

  // CubeTexture face order: px(right), nx(left), py(top), ny(bottom), pz(front), nz(back)
  const cubeTex = new THREE.CubeTexture([
    right, left, top, bot, front, back,
  ].map(c => c as unknown as HTMLImageElement))
  cubeTex.colorSpace = THREE.SRGBColorSpace
  cubeTex.needsUpdate = true
  void canvasToTexture  // keep import used
  return cubeTex
}

/** List all environment names that have at least one asset in the archive. */
export async function listAvailableEnvs(archive: SgaArchive): Promise<string[]> {
  const available: string[] = []
  for (const env of SKYBOX_ENVS) {
    const base = `art/ui/skies/${env}/${env}`
    // Quick presence check — just try one path
    const bytes = await archive.readByPath(`${base}_sky_side.rgt`)
                ?? await archive.readByPath(`art/ui/skies/${env}/sky_side.rgt`)
                ?? await archive.readByPath(`${base}_sky.rgt`)
    if (bytes) available.push(env)
  }
  return available
}

/** Load a ground texture canvas from the archive. Returns null if not found. */
export async function loadGroundTexture(
  archive: SgaArchive, season: 'summer' | 'winter',
): Promise<HTMLCanvasElement | null> {
  const paths = season === 'winter'
    ? [
        'art/terrain/ground/snow_01.rgt',
        'art/terrain/ground/snow.rgt',
        'art/terrain/ground/terrain_snow_01.rgt',
      ]
    : [
        'art/terrain/ground/grass_summer_01.rgt',
        'art/terrain/ground/grass_01.rgt',
        'art/terrain/ground/terrain_grass_01.rgt',
        'art/terrain/ground/grass.rgt',
      ]
  for (const path of paths) {
    const canvas = await loadRgtCanvas(archive, path)
    if (canvas) return canvas
  }
  return null
}
