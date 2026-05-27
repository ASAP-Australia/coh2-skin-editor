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
 */

const COH2_APP_ID = 231430

import type { localplayer as LP, workshop as W } from 'steamworks.js/client'

// ── steamworks.js type surface ─────────────────────────────────────────────
// steamworks.js exports its own .d.ts. We re-declare the small subset we
// need to (a) avoid pulling the whole file into intellisense and (b) keep
// this module's API typed even when the native binding isn't loadable
// (CI box, web build, dev machine without Steam).

type SteamClient = {
  localplayer: typeof LP
  workshop: typeof W
  apps: {
    isSubscribedApp(appId: number): boolean
    appInstallDir(appId: number): string
  }
}

// ── Cached init result ─────────────────────────────────────────────────────
// The result of the FIRST initSteam() call. Either:
//   - { client, info }   → Steam running, all good, info has the persona data
//   - { error }          → init threw, error.code distinguishes failure modes
// We cache so repeated IPC calls (renderer often calls steam.init() defensively)
// don't restart the Steamworks pipe.

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

/** Public-facing init result returned to the renderer over IPC. Mirrors
 *  the shape the StartScreen renders against. */
export interface SteamInitInfo {
  steamId: string
  personaName: string
  ownsApp: boolean
  installPath: string | null
}

/** Discriminated failure reasons. The renderer maps these to the
 *  three branches of the StartScreen (NoSteam / NoGame / generic error). */
export type SteamInitError =
  | { code: 'no-steam'; message: string }
  | { code: 'no-game'; message: string }
  | { code: 'init-failed'; message: string }

let cached: SteamInitState | null = null

/**
 * Initialise the Steamworks pipe (idempotent).
 *
 * Returns the persona info on success, or a structured error the renderer
 * can use to decide which branch of StartScreen to render. Never throws —
 * the renderer doesn't have a try/catch around its boot path and a thrown
 * error here would crash the whole app at the worst possible moment.
 */
export function initSteam(): SteamInitState {
  if (cached) return cached
  try {
    // steamworks.js is loaded on-demand. require() not import — the
    // electron tsconfig compiles to CommonJS and we want runtime resolution
    // so a missing native binary on CI doesn't crash the whole bundle.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const steamworks = require('steamworks.js') as {
      init: (appId?: number) => SteamClient
    }

    let client: SteamClient
    try {
      client = steamworks.init(COH2_APP_ID)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Steam SDK returns one of a handful of fatal messages here.
      // The most common is "Steam is not running" which we surface as a
      // distinct error code so the StartScreen can render the NoSteamScreen
      // branch with its "Start Steam, then click Retry" CTA.
      const code = /steam.*not.*running|init.*steam/i.test(msg) ? 'no-steam' : 'init-failed'
      cached = { ok: false, error: { code, message: msg } }
      return cached
    }

    // CoH2 ownership check. `isSubscribedApp` returns true if the user
    // OWNS the app on this Steam account (purchased, gifted, family
    // sharing). This is the cheapest first-line check; if it's false
    // there's no point trying to publish.
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
 * Used internally by workshop publish/update calls — those are gated
 * behind a successful init() in the renderer, so reaching the throw
 * branch means the user clicked Publish before Steam was ready.
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
   *  whole tree is uploaded as a single Workshop item. */
  contentPath: string
  /** Absolute path to a PNG thumbnail. 256×256 minimum, < 1 MB recommended
   *  by Steam — anything larger gets transcoded on the Steam side and
   *  loses sharpness. */
  previewPath: string
  title: string
  description: string
  /** Workshop tags. We pass through whatever the project type uses
   *  ('Skin' | 'Faceplate' | 'Decal') so CoH2's launcher buckets the
   *  download into the right subscriptions/ subdirectory. */
  tags: string[]
  /** `0` Public, `1` FriendsOnly, `2` Private, `3` Unlisted. Defaults to
   *  Public (chosen as the v1.0 default by user). */
  visibility?: 0 | 1 | 2 | 3
  /** Free-text changelog string shown on the Workshop page next to the
   *  upload timestamp. Optional. */
  changeNote?: string
}

/** Result of a successful first publish. The workshopId is the
 *  Steam-allocated UGC file ID that the user's project should record so
 *  subsequent edits route to `updateWorkshopItem` instead of `publish`. */
export interface PublishWorkshopResult {
  workshopId: string
  needsAgreement: boolean
}

/**
 * First-time publish. Allocates a fresh UGC item then uploads the
 * content. The `needsAgreement` flag is true when the user hasn't
 * accepted the Steam Workshop Subscriber Agreement yet — the renderer
 * shows a banner with a link to the item's edit page where the user
 * accepts on the web, then retries.
 */
export async function publishWorkshopItem(
  input: PublishWorkshopInput,
): Promise<PublishWorkshopResult> {
  const client = requireSteamClient()

  // Step 1: allocate the Workshop file ID. `createItem` triggers the
  // Subscriber Agreement check — the returned `needsToAcceptAgreement`
  // flag is the signal we surface to the renderer.
  const created = await client.workshop.createItem(COH2_APP_ID)
  const itemId = created.itemId
  const needsAgreement = created.needsToAcceptAgreement

  // Step 2: upload content + metadata in a single call. steamworks.js's
  // updateItem bundles SetItem{Title,Description,Content,Preview,Visibility,Tags}
  // + SubmitItemUpdate behind the one promise.
  await client.workshop.updateItem(
    itemId,
    {
      title: input.title,
      description: input.description,
      changeNote: input.changeNote ?? 'Initial publish',
      previewPath: input.previewPath,
      contentPath: input.contentPath,
      tags: input.tags,
      visibility: (input.visibility ?? 0) as 0 | 1 | 2 | 3,
    },
    COH2_APP_ID,
  )

  return {
    workshopId: itemId.toString(),
    needsAgreement,
  }
}

/** Update input — same shape as publish but the caller already knows the
 *  workshopId. */
export interface UpdateWorkshopInput extends PublishWorkshopInput {}

export interface UpdateWorkshopResult {
  needsAgreement: boolean
}

/**
 * Re-publish content under an existing Workshop file ID. Used when the
 * user edits a project and clicks Publish again. The `workshopId` is
 * read from the project's saved state.
 */
export async function updateWorkshopItem(
  workshopId: string,
  input: UpdateWorkshopInput,
): Promise<UpdateWorkshopResult> {
  const client = requireSteamClient()
  const itemId = BigInt(workshopId)
  const result = await client.workshop.updateItem(
    itemId,
    {
      title: input.title,
      description: input.description,
      changeNote: input.changeNote ?? 'Update',
      previewPath: input.previewPath,
      contentPath: input.contentPath,
      tags: input.tags,
      visibility: (input.visibility ?? 0) as 0 | 1 | 2 | 3,
    },
    COH2_APP_ID,
  )
  return { needsAgreement: result.needsToAcceptAgreement }
}

/** A Workshop item published by the current user. Subset of steamworks.js's
 *  WorkshopItem — we surface only what the renderer renders. */
export interface MyWorkshopItem {
  workshopId: string
  title: string
  description: string
  tags: string[]
  visibility: number
  /** Unix seconds. The renderer converts to a relative timestamp. */
  timeUpdated: number
  previewUrl: string | null
  url: string
}

/**
 * Enumerate the current user's published items for CoH2. Used by the
 * StartScreen's "Browse my Workshop items" branch + the per-project
 * publish dialog's "this project is already published" check.
 *
 * Pages through results until the totalResults count is reached, so the
 * renderer doesn't have to handle pagination. CoH2 community has ~5
 * decals/faceplates/skins per typical author, so 1–2 pages tops.
 */
export async function getMyWorkshopItems(): Promise<MyWorkshopItem[]> {
  const client = requireSteamClient()
  const me = client.localplayer.getSteamId()
  const out: MyWorkshopItem[] = []
  let page = 1
  // Hard cap to prevent infinite loops if Steam returns 0/0 forever.
  const MAX_PAGES = 20
  while (page <= MAX_PAGES) {
    const result = await client.workshop.getUserItems(
      page,
      me.accountId,
      5, // UserListType.Subscribed — closest enum value to "items I published"
      0, // UGCType.Items (all UGC items)
      3, // UserListOrder.LastUpdatedDesc (newest first)
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
