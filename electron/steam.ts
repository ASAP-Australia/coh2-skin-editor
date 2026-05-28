/**
 * steam.ts — Steamworks SDK bridge for CoH2 Workshop publishing.
 *
 * This module is the SINGLE point in the codebase that touches steamworks.js.
 * Everything else (IPC handlers in main.ts, renderer code via preload bridge)
 * goes through the typed surface declared here.
 *
 * Design constraints:
 *
 *   1. Steam-first, no fallback. The app refuses to operate without a
 *      live Steam connection — the user explicitly chose this in v1.0
 *      design ("I don't want a local version of the mod"). Initialization
 *      failures surface to the renderer as `null` or `{ ok: false, ... }`
 *      so the StartScreen can render NoSteamScreen / NoGameScreen.
 *
 *   2. App ID 231430 is hard-coded — we're a CoH2 community tool, full
 *      stop. The user shows as "Playing Company of Heroes 2" in their
 *      friends list while in the editor. Standard pattern for third-party
 *      CoH-targeted tools (e.g. CompanyOfHeroes2.org's mod helper).
 *
 *   3. Init is lazy + idempotent. The first call to `getSteam()` does the
 *      real `steamworks.init()`; subsequent calls reuse the cached client.
 *      If init fails, we cache the failure too so we don't pummel the
 *      Steam process retrying on every IPC call.
 *
 *   4. All bigints cross the IPC boundary as decimal strings. Electron's
 *      structured-clone IPC supports BigInt natively (since Electron 11)
 *      but the renderer-side TypeScript treats Workshop file IDs as
 *      strings everywhere else (URL routing, project.workshopId, etc.),
 *      so we normalise here.
 *
 *   5. Workshop publish/update uses the LEGACY ISteamRemoteStorage API
 *      (PublishWorkshopFile / CommitPublishedFileUpdate). CoH2 (app 231430)
 *      does NOT have a modern ISteamUGC content depot — the modern path
 *      via steamworks.js createItem+updateItem always fails with "a
 *      parameter is invalid". The native addon at
 *      native/coh2-workshop/ implements the proven legacy path.
 */

const COH2_APP_ID = 231430

import type { localplayer as LP, workshop as W } from 'steamworks.js/client'

// ── steamworks.js type surface ─────────────────────────────────────────────
type SteamClient = {
  localplayer: typeof LP
  workshop: typeof W
  apps: {
    isSubscribedApp(appId: number): boolean
    appInstallDir(appId: number): string
  }
}

// ── Native addon type surface ──────────────────────────────────────────────
// Mirrors native/coh2-workshop/index.d.ts. We re-declare here to avoid
// a rootDir-crossing import in the electron tsconfig.

interface NativePublishInput {
  sgaPath: string
  previewPath: string
  appId: number
  title: string
  description: string
  visibility: 0 | 1 | 2 | 3
  tags: string[]
  changeNote?: string
}

interface NativeUpdateInput extends NativePublishInput {
  publishedFileId: bigint
}

interface NativePublishResult {
  publishedFileId: bigint
  agreementNeeded: boolean
}

interface WorkshopNative {
  publishNewItem(input: NativePublishInput): Promise<NativePublishResult>
  updateExistingItem(input: NativeUpdateInput): Promise<NativePublishResult>
  startCallbackPump(): void
  stopCallbackPump(): void
}

let nativeAddon: WorkshopNative | null = null
let nativeAddonLoadAttempted = false

/**
 * Load the native coh2-workshop addon (lazy, idempotent).
 *
 * We defer loading until the first publish/update call so that the
 * addon's steam_bridge_init() runs after steamworks.js has already called
 * SteamAPI_Init — which is required for the dlsym lookups to find the
 * already-loaded libsteam_api.so symbols.
 */
function requireNativeAddon(): WorkshopNative {
  if (nativeAddon) return nativeAddon
  if (nativeAddonLoadAttempted) {
    throw new Error('[workshop] native addon failed to load previously')
  }
  nativeAddonLoadAttempted = true

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path')
  // In production (AppImage), __dirname is inside the asar — the .node binary
  // is in an asarUnpack'd directory. We navigate relative to __dirname.
  // In dev, __dirname is dist-electron/.
  const addonDir = path.join(__dirname, '..', 'native', 'coh2-workshop')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  nativeAddon = require(addonDir) as WorkshopNative
  console.log('[workshop] native addon loaded from', addonDir)
  return nativeAddon
}

// ── Cached init result ─────────────────────────────────────────────────────

interface SteamInitSuccess {
  ok: true
  client: SteamClient
  info: SteamInitInfo
}

interface SteamInitFailure {
  ok: false
  error: SteamInitError
}

type SteamInitState = SteamInitSuccess | SteamInitFailure

/** Public-facing init result returned to the renderer over IPC. */
export interface SteamInitInfo {
  steamId: string
  personaName: string
  ownsApp: boolean
  installPath: string | null
}

/** Discriminated failure reasons. */
export type SteamInitError =
  | { code: 'no-steam'; message: string }
  | { code: 'no-game'; message: string }
  | { code: 'init-failed'; message: string }

let cached: SteamInitState | null = null
let pumpStarted = false

/**
 * Initialise the Steamworks pipe (idempotent).
 *
 * Returns the persona info on success, or a structured error the renderer
 * can use to decide which branch of StartScreen to render. Never throws.
 */
export function initSteam(): SteamInitState {
  if (cached) return cached
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const steamworks = require('steamworks.js') as {
      init: (appId?: number) => SteamClient
    }

    let client: SteamClient
    try {
      client = steamworks.init(COH2_APP_ID)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const code = /steam.*not.*running|init.*steam/i.test(msg) ? 'no-steam' : 'init-failed'
      cached = { ok: false, error: { code, message: msg } }
      return cached
    }

    // Start the callback pump once after Steam is initialised.
    // The native addon's startCallbackPump() installs a 100ms libuv timer
    // that calls SteamAPI_RunCallbacks on the main thread. This is required
    // for ISteamRemoteStorage async results (FileShare, PublishWorkshopFile,
    // CommitPublishedFileUpdate) to fire. steamworks.js v0.4 does not run
    // its own pump from the main process.
    if (!pumpStarted) {
      try {
        const addon = requireNativeAddon()
        addon.startCallbackPump()
        pumpStarted = true
        console.log('[workshop] callback pump started')
      } catch (pumpErr) {
        console.warn('[workshop] could not start callback pump:', pumpErr)
        // Not fatal — the pump can be started lazily at publish time too
      }
    }

    const ownsApp = client.apps.isSubscribedApp(COH2_APP_ID)
    if (!ownsApp) {
      cached = {
        ok: false,
        error: {
          code: 'no-game',
          message: 'This tool requires Company of Heroes 2 on your Steam account.',
        },
      }
      return cached
    }

    const me = client.localplayer.getSteamId()
    const personaName = client.localplayer.getName()
    let installPath: string | null = null
    try {
      installPath = client.apps.appInstallDir(COH2_APP_ID) || null
    } catch {
      installPath = null
    }

    cached = {
      ok: true,
      client,
      info: {
        steamId: me.steamId64.toString(),
        personaName,
        ownsApp: true,
        installPath,
      },
    }
    return cached
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    cached = { ok: false, error: { code: 'init-failed', message: msg } }
    return cached
  }
}

/**
 * Get the live Steam client, or throw with a user-actionable message.
 */
function requireSteamClient(): SteamClient {
  const s = initSteam()
  if (!s.ok) {
    throw new Error(
      s.error.code === 'no-steam'
        ? 'Steam is not running. Start Steam and try again.'
        : s.error.code === 'no-game'
          ? 'Company of Heroes 2 is not in your Steam library.'
          : `Steam init failed: ${s.error.message}`,
    )
  }
  return s.client
}

// ── Workshop publish/update IPC surface ────────────────────────────────────

/** All-in-one publish input. The renderer assembles this from project
 *  state + a metadata dialog. */
export interface PublishWorkshopInput {
  /** Absolute path to the directory containing the .sga + manifest. The
   *  single .sga file in this directory is the Workshop item content. */
  contentPath: string
  /** Absolute path to a PNG thumbnail. 256×256 minimum, < 1 MB recommended. */
  previewPath: string
  title: string
  description: string
  /** Workshop tags: 'Skin' | 'Faceplate' | 'Decal' */
  tags: string[]
  /** `0` Public, `1` FriendsOnly, `2` Private, `3` Unlisted. Default Public. */
  visibility?: 0 | 1 | 2 | 3
  /** Free-text changelog string shown on the Workshop page. Optional. */
  changeNote?: string
}

/** Result of a successful first publish. */
export interface PublishWorkshopResult {
  workshopId: string
  needsAgreement: boolean
}

export interface UpdateWorkshopResult {
  needsAgreement: boolean
}

/**
 * Find the single .sga file inside a directory (the Workshop content dir
 * the renderer creates via tmp:make-publish-dir + write-file).
 *
 * Throws if zero or more than one .sga is found.
 */
function findSgaInDir(contentPath: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path')
  let entries: string[]
  try {
    entries = fs.readdirSync(contentPath)
  } catch (e) {
    throw new Error(`[workshop] content directory not readable: ${contentPath} — ${e}`)
  }
  const sgas = entries.filter(f => f.toLowerCase().endsWith('.sga'))
  if (sgas.length === 0) {
    throw new Error(
      `[workshop] no .sga file found in content directory: ${contentPath} (files: ${entries.join(', ')})`,
    )
  }
  if (sgas.length > 1) {
    console.warn(
      `[workshop] multiple .sga files in content dir, using first: ${sgas[0]} (others: ${sgas.slice(1).join(', ')})`,
    )
  }
  return path.join(contentPath, sgas[0])
}

/**
 * First-time publish via the legacy ISteamRemoteStorage API.
 *
 * Uses our native addon (native/coh2-workshop) which calls:
 *   FileWrite → FileShare → PublishWorkshopFile
 *
 * CoH2 does NOT have a modern ISteamUGC content depot. The steamworks.js
 * createItem + updateItem path always fails with "a parameter is invalid".
 */
export async function publishWorkshopItem(
  input: PublishWorkshopInput,
): Promise<PublishWorkshopResult> {
  // Ensure Steam is initialised (and the callback pump is running)
  requireSteamClient()

  // ── Pre-flight checks ─────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs')
  let contentDirExists = false
  let contentDirIsDir = false
  let contentDirFiles: string[] = []
  let previewExists = false
  let previewSize = -1
  try {
    const cs = fs.statSync(input.contentPath)
    contentDirExists = true
    contentDirIsDir = cs.isDirectory()
    if (contentDirIsDir) contentDirFiles = fs.readdirSync(input.contentPath)
  } catch { /* logged below */ }
  try {
    const ps = fs.statSync(input.previewPath)
    previewExists = true
    previewSize = ps.size
  } catch { /* logged below */ }

  console.log(
    '[workshop:publish] step=pre-flight appId=%d title=%j contentPath=%s contentDirExists=%s isDir=%s files=%j previewPath=%s previewExists=%s previewSize=%d tags=%j visibility=%s changeNote=%j',
    COH2_APP_ID,
    input.title,
    input.contentPath,
    contentDirExists,
    contentDirIsDir,
    contentDirFiles,
    input.previewPath,
    previewExists,
    previewSize,
    input.tags,
    input.visibility ?? 0,
    input.changeNote ?? '(default: Initial upload)',
  )

  if (!contentDirExists || !contentDirIsDir) {
    throw new Error(
      `[workshop:publish] content folder missing or not a directory: ${input.contentPath}`,
    )
  }
  if (!previewExists) {
    throw new Error(`[workshop:publish] preview file not found: ${input.previewPath}`)
  }
  const ONE_MB = 1_048_576
  if (previewSize > ONE_MB) {
    throw new Error(
      `[workshop:publish] preview PNG is ${previewSize} bytes — Steam requires < 1 MB. Resize the preview image.`,
    )
  }

  // ── Log preview dimensions ────────────────────────────────────────────────
  try {
    const previewBuf = fs.readFileSync(input.previewPath)
    if (previewBuf.length >= 24) {
      const w = previewBuf.readUInt32BE(16)
      const h = previewBuf.readUInt32BE(20)
      console.log('[workshop:publish] step=preview-dimensions width=%d height=%d bytes=%d', w, h, previewBuf.length)
    }
  } catch (e) {
    console.warn('[workshop:publish] step=preview-dimensions-failed', e)
  }

  // ── Find the .sga file ────────────────────────────────────────────────────
  const sgaPath = findSgaInDir(input.contentPath)
  console.log('[workshop:publish] step=sga-resolved sgaPath=%s', sgaPath)

  // ── Call native addon ─────────────────────────────────────────────────────
  const addon = requireNativeAddon()
  console.log('[workshop:publish] step=publishNewItem')
  const result = await addon.publishNewItem({
    sgaPath,
    previewPath: input.previewPath,
    appId: COH2_APP_ID,
    title: input.title,
    description: input.description ?? '',
    visibility: (input.visibility ?? 0) as 0 | 1 | 2 | 3,
    tags: input.tags ?? [],
    changeNote: input.changeNote ?? 'Initial upload',
  })

  console.log(
    '[workshop:publish] step=publishNewItem-resolved publishedFileId=%s agreementNeeded=%s',
    result.publishedFileId.toString(),
    result.agreementNeeded,
  )

  if (result.agreementNeeded) {
    const id = result.publishedFileId.toString()
    throw new Error(
      `Steam Workshop Subscriber Agreement not accepted.\n\n` +
      `Please visit https://steamcommunity.com/sharedfiles/itemedit/?id=${id} ` +
      `and accept the agreement, then click Publish again.\n\n` +
      `(Item ID ${id} was allocated.)`,
    )
  }

  return {
    workshopId: result.publishedFileId.toString(),
    needsAgreement: result.agreementNeeded,
  }
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- intentional alias
export interface UpdateWorkshopInput extends PublishWorkshopInput {}

/**
 * Re-publish content under an existing Workshop file ID via legacy
 * ISteamRemoteStorage update path.
 *
 * NOTE: Only items originally published via publishWorkshopItem (this legacy
 * path) can be updated. Items created via the modern ISteamUGC API cannot.
 */
export async function updateWorkshopItem(
  workshopId: string,
  input: UpdateWorkshopInput,
): Promise<UpdateWorkshopResult> {
  requireSteamClient()

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs')
  let contentDirExists = false
  let contentDirIsDir = false
  let contentDirFiles: string[] = []
  let previewExists = false
  let previewSize = -1
  try {
    const cs = fs.statSync(input.contentPath)
    contentDirExists = true
    contentDirIsDir = cs.isDirectory()
    if (contentDirIsDir) contentDirFiles = fs.readdirSync(input.contentPath)
  } catch { /* logged below */ }
  try {
    const ps = fs.statSync(input.previewPath)
    previewExists = true
    previewSize = ps.size
  } catch { /* logged below */ }

  console.log(
    '[workshop:update] step=pre-flight workshopId=%s appId=%d title=%j contentPath=%s contentDirExists=%s isDir=%s files=%j previewPath=%s previewExists=%s previewSize=%d tags=%j visibility=%s changeNote=%j',
    workshopId,
    COH2_APP_ID,
    input.title,
    input.contentPath,
    contentDirExists,
    contentDirIsDir,
    contentDirFiles,
    input.previewPath,
    previewExists,
    previewSize,
    input.tags,
    input.visibility ?? 0,
    input.changeNote ?? '(default: Update)',
  )

  if (!contentDirExists || !contentDirIsDir) {
    throw new Error(
      `[workshop:update] content folder missing or not a directory: ${input.contentPath}`,
    )
  }
  if (!previewExists) {
    throw new Error(`[workshop:update] preview file not found: ${input.previewPath}`)
  }
  const ONE_MB = 1_048_576
  if (previewSize > ONE_MB) {
    throw new Error(
      `[workshop:update] preview PNG is ${previewSize} bytes — Steam requires < 1 MB. Resize the preview image.`,
    )
  }

  try {
    const previewBuf = fs.readFileSync(input.previewPath)
    if (previewBuf.length >= 24) {
      const w = previewBuf.readUInt32BE(16)
      const h = previewBuf.readUInt32BE(20)
      console.log('[workshop:update] step=preview-dimensions width=%d height=%d bytes=%d', w, h, previewBuf.length)
    }
  } catch (e) {
    console.warn('[workshop:update] step=preview-dimensions-failed', e)
  }

  const sgaPath = findSgaInDir(input.contentPath)
  console.log('[workshop:update] step=sga-resolved sgaPath=%s', sgaPath)

  const addon = requireNativeAddon()
  console.log('[workshop:update] step=updateExistingItem itemId=%s', workshopId)
  const result = await addon.updateExistingItem({
    publishedFileId: BigInt(workshopId),
    sgaPath,
    previewPath: input.previewPath,
    appId: COH2_APP_ID,
    title: input.title,
    description: input.description ?? '',
    visibility: (input.visibility ?? 0) as 0 | 1 | 2 | 3,
    tags: input.tags ?? [],
    changeNote: input.changeNote ?? 'Update',
  })

  console.log(
    '[workshop:update] step=updateExistingItem-resolved publishedFileId=%s agreementNeeded=%s',
    result.publishedFileId.toString(),
    result.agreementNeeded,
  )

  return { needsAgreement: result.agreementNeeded }
}

/** A Workshop item published by the current user. */
export interface MyWorkshopItem {
  workshopId: string
  title: string
  description: string
  tags: string[]
  visibility: number
  timeUpdated: number
  previewUrl: string | null
  url: string
}

/**
 * Enumerate the current user's published items for CoH2.
 * Uses steamworks.js getUserItems (ISteamUGC::GetUserItems) — this is a
 * READ-ONLY query, not a publish, so it works fine with the modern UGC API.
 */
export async function getMyWorkshopItems(): Promise<MyWorkshopItem[]> {
  const client = requireSteamClient()
  const me = client.localplayer.getSteamId()
  const out: MyWorkshopItem[] = []
  let page = 1
  const MAX_PAGES = 20
  while (page <= MAX_PAGES) {
    const result = await client.workshop.getUserItems(
      page,
      me.accountId,
      0, // UserListType.Published
      0, // UGCType.Items
      3, // UserListOrder.LastUpdatedDesc
      { creator: COH2_APP_ID, consumer: COH2_APP_ID },
      { includeMetadata: true, language: 'english' },
    )
    for (const it of result.items) {
      if (!it) continue
      out.push({
        workshopId: it.publishedFileId.toString(),
        title: it.title,
        description: it.description,
        tags: it.tags,
        visibility: it.visibility as number,
        timeUpdated: it.timeUpdated,
        previewUrl: it.previewUrl ?? null,
        url: it.url,
      })
    }
    if (out.length >= result.totalResults || result.items.length === 0) break
    page++
  }
  return out
}

/**
 * Re-arm. The renderer's "Retry" button on NoSteamScreen calls this so
 * the next IPC `steam:init` call re-attempts instead of returning the
 * cached "no-steam" failure.
 */
export function resetSteamCache(): void {
  cached = null
}
