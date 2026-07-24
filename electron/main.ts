import { app, BrowserWindow, ipcMain, dialog, safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { getDiffusionSidecar } from './diffusion'
import {
  detectCoh2Path,
  detectModsPath,
  detectWorkshopPath,
  listWorkshopItems,
  listStockArchives,
  listInstalledPacks,
} from './detect-coh2'
import {
  initSteam,
  publishWorkshopItem,
  updateWorkshopItem,
  deleteWorkshopItem,
  getMyWorkshopItems,
  resetSteamCache,
  type PublishWorkshopInput,
  type UpdateWorkshopInput,
} from './steam'
import { scanFakeIdSgas, trashFakeIdSgas } from './mods-wipe'

// ── Local type copies ─────────────────────────────────────────────────────────
// The electron directory compiles under `rootDir: "electron"` which prevents
// importing from src/. We re-declare the types used for AI IPC here.
// Canonical definitions live in src/lib/ai/types.ts — keep in sync.

type AiProvider = 'anthropic' | 'openai' | 'google' | 'xai'

interface AiCompleteRequest {
  system: string
  user: string
  model?: string
  maxTokens?: number
  temperature?: number
  provider?: AiProvider
}

interface AiGenerateImageRequest {
  prompt: string
  negativePrompt?: string
  size?: '1024x1024' | '1536x1024' | '1024x1536'
  quality?: 'low' | 'medium' | 'high' | 'auto'
  model?: string
  provider?: AiProvider
}

// ── AI provider configuration ─────────────────────────────────────────────

const PROVIDERS: AiProvider[] = ['anthropic', 'openai', 'google', 'xai']

const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-4o-mini',
  google: 'gemini-2.0-flash',
  // grok-3-mini is the cheap fast tier — perfect for emitting a small
  // CamoPreset JSON. Bump to 'grok-3' if quality is poor.
  xai: 'grok-3-mini',
}

const aiKeyCache: Partial<Record<AiProvider, string>> = {}
let aiActiveProvider: AiProvider = 'anthropic'

function aiKeyPath(p: AiProvider): string {
  return path.join(app.getPath('userData'), `ai-key-${p}.bin`)
}

function aiSettingsPath(): string {
  return path.join(app.getPath('userData'), 'ai-settings.json')
}

function loadAiKey(p: AiProvider): void {
  const file = aiKeyPath(p)
  try {
    if (!fs.existsSync(file)) return
    const buf = fs.readFileSync(file)
    if (safeStorage.isEncryptionAvailable()) {
      aiKeyCache[p] = safeStorage.decryptString(buf)
    } else {
      // Fallback: plaintext was written because keychain was unavailable
      // at write time. Stored as utf8 — see saveAiKey().
      aiKeyCache[p] = buf.toString('utf8')
      console.warn(`[ai] keychain unavailable, key for ${p} loaded in plaintext`)
    }
  } catch (e) {
    console.warn(`[ai] failed to load key for ${p}:`, e)
  }
}

function saveAiKey(p: AiProvider, key: string): void {
  const file = aiKeyPath(p)
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(file, safeStorage.encryptString(key))
  } else {
    console.warn(`[ai] keychain unavailable; storing key for ${p} in plaintext at ${file}`)
    fs.writeFileSync(file, key, 'utf8')
  }
  aiKeyCache[p] = key
}

function clearAiKey(p: AiProvider): void {
  const file = aiKeyPath(p)
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file)
  } catch {
    /* ignore */
  }
  delete aiKeyCache[p]
}

function loadAiSettings(): void {
  try {
    const file = aiSettingsPath()
    if (!fs.existsSync(file)) return
    const obj = JSON.parse(fs.readFileSync(file, 'utf8')) as { activeProvider?: string }
    if (PROVIDERS.includes(obj.activeProvider as AiProvider))
      aiActiveProvider = obj.activeProvider as AiProvider
  } catch (e) {
    console.warn('[ai] settings load failed', e)
  }
}

function saveAiSettings(): void {
  try {
    fs.writeFileSync(aiSettingsPath(), JSON.stringify({ activeProvider: aiActiveProvider }))
  } catch (e) {
    console.warn('[ai] settings save failed', e)
  }
}

// ── Provider HTTP adapters ────────────────────────────────────────────
// Each takes the decrypted key + the normalised request, returns the
// assistant's plain-text reply. Errors bubble up; the renderer surfaces
// them in the modal.

async function callAnthropic(key: string, req: AiCompleteRequest) {
  const model = req.model ?? DEFAULT_MODELS.anthropic
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.4,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
    }),
  })
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`)
  const j = (await r.json()) as {
    content?: { type: string; text?: string }[]
    usage?: unknown
  }
  const text = (j.content ?? [])
    .filter(b => b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text as string)
    .join('')
  return { text, model, usage: j.usage }
}

async function callOpenAi(key: string, req: AiCompleteRequest) {
  const model = req.model ?? DEFAULT_MODELS.openai
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_completion_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.4,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
    }),
  })
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`)
  const j = (await r.json()) as {
    choices?: { message?: { content?: string } }[]
    usage?: unknown
  }
  const text = j.choices?.[0]?.message?.content ?? ''
  return { text, model, usage: j.usage }
}

async function callGoogle(key: string, req: AiCompleteRequest) {
  const model = req.model ?? DEFAULT_MODELS.google
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { role: 'system', parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.user }] }],
      generationConfig: {
        maxOutputTokens: req.maxTokens ?? 1024,
        temperature: req.temperature ?? 0.4,
      },
    }),
  })
  if (!r.ok) throw new Error(`Google ${r.status}: ${await r.text()}`)
  const j = (await r.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
    usageMetadata?: unknown
  }
  const text =
    j.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? ''
  return { text, model, usage: j.usageMetadata }
}

async function callXai(key: string, req: AiCompleteRequest) {
  // xAI's chat endpoint is OpenAI-compatible — same /chat/completions
  // shape, same `messages` envelope, same auth header. The only knob
  // we don't mirror from callOpenAi is `max_completion_tokens`; xAI
  // still expects the legacy `max_tokens` field.
  const model = req.model ?? DEFAULT_MODELS.xai
  const r = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.4,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
    }),
  })
  if (!r.ok) throw new Error(`xAI ${r.status}: ${await r.text()}`)
  const j = (await r.json()) as {
    choices?: { message?: { content?: string } }[]
    usage?: unknown
  }
  const text = j.choices?.[0]?.message?.content ?? ''
  return { text, model, usage: j.usage }
}

async function callAi(req: AiCompleteRequest) {
  const provider = req.provider ?? aiActiveProvider
  const key = aiKeyCache[provider]
  if (!key) throw new Error(`No API key set for ${provider}. Add one in Settings.`)
  const adapter =
    provider === 'anthropic'
      ? callAnthropic
      : provider === 'openai'
        ? callOpenAi
        : provider === 'xai'
          ? callXai
          : callGoogle
  const out = await adapter(key, req)
  return { ...out, provider }
}

const DEFAULT_IMAGE_MODELS: Record<AiProvider, string> = {
  // Claude can't generate images; the adapter throws when reached.
  anthropic: 'n/a',
  openai: 'gpt-image-1',
  google: 'imagen-3.0-generate-002',
  // xAI ships grok-2-image; $0.07/image. Doesn't honour `quality` or
  // `size` knobs — always 1024² PNG, but we still accept the field for
  // type-uniformity with the other adapters.
  xai: 'grok-2-image',
}

async function callOpenAiImage(key: string, req: AiGenerateImageRequest) {
  const model = req.model ?? DEFAULT_IMAGE_MODELS.openai
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt: req.prompt,
      n: 1,
      size: req.size ?? '1024x1024',
      quality: req.quality ?? 'high',
      output_format: 'png',
      background: 'opaque',
    }),
  })
  if (!r.ok) throw new Error(`OpenAI image ${r.status}: ${await r.text()}`)
  const j = (await r.json()) as { data?: { b64_json?: string }[]; usage?: unknown }
  const b64 = j.data?.[0]?.b64_json
  if (!b64) throw new Error('OpenAI image response missing b64_json')
  return { imageBase64: b64, mimeType: 'image/png' as const, model, usage: j.usage }
}

async function callGoogleImage(key: string, req: AiGenerateImageRequest) {
  const model = req.model ?? DEFAULT_IMAGE_MODELS.google
  // Imagen 3 via the AI Studio / Generative Language API uses the
  // ":predict" surface, which speaks Vertex-style { instances, parameters }
  // payloads rather than the Gemini-style { contents } envelope.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:predict?key=${encodeURIComponent(key)}`
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      instances: [
        {
          prompt: req.prompt,
          // Imagen honours a negative prompt; some prompt-rejection cases
          // are noticeably softer when we explicitly tell it what NOT to
          // draw (tank renders, panel lines, etc).
          ...(req.negativePrompt ? { negativePrompt: req.negativePrompt } : {}),
        },
      ],
      parameters: {
        sampleCount: 1,
        aspectRatio: '1:1',
        // No human faces — irrelevant for camo textures but a cheap
        // safety belt against the model wandering into territory that
        // trips Imagen's people filter and 400s the whole request.
        personGeneration: 'dont_allow',
      },
    }),
  })
  if (!r.ok) throw new Error(`Google image ${r.status}: ${await r.text()}`)
  const j = (await r.json()) as { predictions?: { bytesBase64Encoded?: string }[] }
  const pred = j.predictions?.[0]
  const b64 = pred?.bytesBase64Encoded
  if (!b64) throw new Error('Imagen response missing bytesBase64Encoded')
  return { imageBase64: b64, mimeType: 'image/png' as const, model }
}

async function callXaiImage(key: string, req: AiGenerateImageRequest) {
  // xAI image endpoint is OpenAI-compatible (path, auth header, JSON
  // shape). Differences: no `quality`, no `size`, no `output_format`,
  // no `background`. By default it returns hosted URLs; we ask for
  // base64 to keep the renderer's image pipeline identical across
  // providers (no extra network hop, no CSP wrangling).
  const model = req.model ?? DEFAULT_IMAGE_MODELS.xai
  const r = await fetch('https://api.x.ai/v1/images/generations', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt: req.prompt,
      n: 1,
      response_format: 'b64_json',
    }),
  })
  if (!r.ok) throw new Error(`xAI image ${r.status}: ${await r.text()}`)
  const j = (await r.json()) as { data?: { b64_json?: string }[]; usage?: unknown }
  const b64 = j.data?.[0]?.b64_json
  if (!b64) throw new Error('xAI image response missing b64_json')
  return { imageBase64: b64, mimeType: 'image/png' as const, model, usage: j.usage }
}

async function callAiImage(req: AiGenerateImageRequest) {
  const provider = req.provider ?? aiActiveProvider
  if (provider === 'anthropic') {
    throw new Error(
      'Anthropic does not offer image generation. Switch to OpenAI, Google, or xAI in Settings.',
    )
  }
  const key = aiKeyCache[provider]
  if (!key) throw new Error(`No API key set for ${provider}. Add one in Settings.`)
  const adapter =
    provider === 'openai' ? callOpenAiImage : provider === 'xai' ? callXaiImage : callGoogleImage
  const out = await adapter(key, req)
  return { ...out, provider }
}

// ---------------------------------------------------------------------------
// CDP remote debugging (opt-in via ELECTRON_DEBUG_PORT env var)
// ---------------------------------------------------------------------------
// When set, exposes a Chrome DevTools Protocol endpoint on the given port so
// external automation (CDP client → Runtime.evaluate / Page.captureScreenshot
// / Console.messageAdded) can drive the running Electron renderer headlessly.
// Off by default — set ELECTRON_DEBUG_PORT=9223 in `electron:dev:debug`.
//
// MUST run before app.whenReady() — Electron only honours command-line
// switches that are appended during the Chromium init phase.
if (process.env.ELECTRON_DEBUG_PORT) {
  const port = process.env.ELECTRON_DEBUG_PORT
  app.commandLine.appendSwitch('remote-debugging-port', port)
  // Bind to all interfaces so attaching from a separate process works under
  // sandboxed/containerised dev sessions. Comment out and pin to 127.0.0.1
  // if running on an untrusted network.
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
  console.log(`[main] CDP debugger listening on 127.0.0.1:${port}`)
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null

/** Glass-border window — OPAQUE.
 *
 *  The "glass card on a dark page" effect (matching the lab01.dev reference)
 *  is entirely web content: a dark opaque BrowserWindow whose body paints a
 *  dark surround (#1a1a1a) and whose renderer floats a styled glass CARD
 *  (.glass-frame / .glass-frame-inner + a blurred spotlight) inside it.
 *
 *  Why opaque, not transparent: `transparent:true` only composites reliably
 *  on X11/XWayland, and forcing XWayland on this AMD/RADV GPU segfaulted the
 *  GPU process (exit 139) → blank window. An opaque window renders reliably
 *  on native Wayland, and because the whole effect is in web content it can
 *  be screenshot-verified via CDP. */

function createWindow() {
  // HEADLESS_HIDE_ONLY=1 — hide the window the same way HEADLESS_SCREENSHOT
  // does, but DON'T trigger the auto-capture-and-quit. Used when an
  // external CDP client wants to drive a long-running renderer (rotate
  // camera, capture multiple frames) without ever showing a window on the
  // user's display.
  const headless = !!process.env.HEADLESS_SCREENSHOT || !!process.env.HEADLESS_HIDE_ONLY
  // App icon for the taskbar/dock. Set explicitly on the BrowserWindow so the
  // ASAP logo shows even on an UNPACKAGED dev run (`npx electron .`). The
  // electron-builder `icon` field in package.json only applies to packaged
  // builds — without this line a dev/audit-launched window falls back to the
  // generic Electron atom in the taskbar. In dev the asset lives in public/;
  // in a built run Vite has copied it into dist/. Mirror the same NODE_ENV
  // branch the renderer loader uses further below.
  const appIconPath =
    process.env.NODE_ENV === 'development'
      ? path.join(__dirname, '..', 'public', 'asap-logo.png')
      : path.join(__dirname, '..', 'dist', 'asap-logo.png')
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    icon: appIconPath,
    // Centre the window on the primary display when it first appears.
    // Without this, Electron uses the OS window manager's default placement
    // (top-left on most Linux compositors, cascading on Windows), which on
    // a 4K monitor leaves the 1440×900 chrome stranded in the corner. The
    // user reported the app opening "off to the side" — `center: true`
    // anchors the initial geometry to the screen midpoint. The flag is
    // ignored if the user later resizes/moves and we restore that
    // position; for v1.0 we just want the first paint to be visually
    // centred.
    center: true,
    // Hide the window until the renderer signals it's painted at least one
    // frame. Without this gate, Electron pops a white (or worse, partly-
    // rendered) BrowserWindow on screen and you watch the React tree
    // assemble in real time — the user reported this as the app "showing
    // itself before everything's rendered on the connect screen". We
    // re-show it from `ready-to-show` below, which fires after the
    // renderer's first paint has committed. The `headless` modes keep
    // the original off behaviour because they capture via
    // webContents.capturePage() and never need to surface the window.
    show: false,
    paintWhenInitiallyHidden: true,
    frame: false,
    // TRANSPARENT window so rounded corners show the desktop and the
    // glass-frame drop-shadow floats. The earlier opaque mode (#1a1a1a)
    // was a workaround for a GPU crash caused by `ozone-platform=x11`
    // (forced XWayland) segfaulting the AMD/RADV GPU process — NOT by
    // transparency itself. With XWayland force removed and the app running
    // on native Wayland, transparent:true renders correctly.
    // `hasShadow:false` lets the CSS box-shadow on .glass-frame be the
    // only visible shadow (it sits in the 10px #root margin around the
    // card). `frame:false` keeps the custom WindowControls pill.
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Never throttle the renderer (or its Web Workers) when the window is
      // occluded/unfocused. Without this, an occluded window starves the BC
      // texture-decode worker pool — a sub-second 2048² RGT decode balloons to
      // 20+ seconds, so clicking a vehicle leaves the viewport empty while the
      // user waits (and an effect re-run can cancel the load before the meshes
      // are ever added). Mirrors the audit-capture window's setting.
      backgroundThrottling: false,
    },
  })

  // ── Window control IPC ──────────────────────────────────────────────────
  ipcMain.handle('window-minimize', () => mainWindow?.minimize())
  ipcMain.handle('window-maximize', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  })
  ipcMain.handle('window-close', () => mainWindow?.close())
  ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() ?? false)

  // ── CoH2 detection ────────────────────────────────────────────────────
  ipcMain.handle('detect-coh2', () => detectCoh2Path())

  // ── CoH2 mods-folder detection (separate from install — see
  //    detectModsPath() for the search order). Returns the absolute path
  //    to mods/, or null if Documents/My Games/Company of Heroes 2/ can't
  //    be located. The renderer wraps this path with nativePathToHandle
  //    and stashes the handle in IDB under coh2-mods so Live Sync writes
  //    don't need a separate user gesture.
  ipcMain.handle('detect-coh2-mods', () => detectModsPath())

  // ── CoH2 workshop content folder. Returns the absolute path to
  //    `<steam-library>/steamapps/workshop/content/231430/` for the
  //    library that holds the user's subscribed workshop items, or null
  //    when no library has any. Used by the Template Picker in the
  //    new-project flow so users can seed a fresh faceplate / decal-pack
  //    / skin-pack project from any of their existing workshop subs.
  ipcMain.handle('detect-coh2-workshop', () => detectWorkshopPath())

  // ── Enumerate workshop items under a given root. Returns one entry
  //    per numeric workshop-ID folder, each with the path to its primary
  //    .sga (or null when the folder is empty). The renderer then opens
  //    the SGA via the existing read-file-range path to extract preview
  //    thumbnails — this handler stays cheap (no archive parsing).
  ipcMain.handle('list-workshop-items', (_e, root?: string) => listWorkshopItems(root || detectWorkshopPath() || ''))

  // ── Enumerate installed skin + decal packs from the mods directories.
  //    Reads mods/skins/*.sga, mods/decals/subscriptions/*.sga, and
  //    mods/faceplates/subscriptions/*.sga; parses the .info embedded in
  //    each archive to extract the human-readable pack name. Cheap: only
  //    the TOC + single .info file are read; results are mtime-cached.
  //    Falls back to basename-derived name when no .info is present.
  ipcMain.handle('list-installed-packs', (_e, modsRoot?: string) =>
    listInstalledPacks(modsRoot || detectModsPath() || ''),
  )

  // ── Enumerate the stock CoH2 archives that ship with the base game.
  //    Reads <installRoot>/CoH2/Archives/*.sga and returns id + path +
  //    size for each. The Template Picker surfaces these as "From game
  //    files" seed templates so users can fork from official content
  //    without re-importing anything. Cheap — stat-only, no SGA parsing.
  ipcMain.handle('list-stock-archives', (_e, installRoot: string) =>
    listStockArchives(installRoot),
  )

  // ── Generic write-file (Live Sync writes built SGAs into the mods
  //    folder; readFileRange + listDir cover the read path, this closes
  //    the write side). Creates parent directories as needed so a fresh
  //    mods/ folder doesn't need pre-existing skins/ or
  //    extension/subscriptions/ subdirs. Accepts the bytes as a
  //    transferable ArrayBuffer to avoid base64 overhead. */
  ipcMain.handle('write-file', async (_e, filePath: string, bytes: ArrayBuffer) => {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
    await fs.promises.writeFile(filePath, Buffer.from(bytes))
  })

  // ── One-time mods-folder migration (v1.0). Scans for pre-v1.0 fake-
  //    Workshop-ID SGAs that fail lobby validation and moves them to the
  //    OS trash (not unlink — recoverable via Recycle Bin / Trash if we
  //    misclassified a real Workshop subscription). See electron/mods-
  //    wipe.ts for the classification heuristic.
  ipcMain.handle('mods:scan-fake-ids', (_e, modsRoot: string) => {
    return scanFakeIdSgas(modsRoot)
  })
  ipcMain.handle(
    'mods:trash-fake-ids',
    async (_e, paths: string[], modsRoot: string) => {
      return await trashFakeIdSgas(paths, modsRoot)
    },
  )

  // ── AI: settings + key management + completions ───────────────────────
  ipcMain.handle('ai:get-settings', () => ({
    activeProvider: aiActiveProvider,
    providers: PROVIDERS.map(p => ({ provider: p, hasKey: !!aiKeyCache[p] })),
  }))

  ipcMain.handle('ai:set-active-provider', (_e, p: string) => {
    if (!PROVIDERS.includes(p as AiProvider)) throw new Error(`Unknown provider: ${p}`)
    aiActiveProvider = p as AiProvider
    saveAiSettings()
    return true
  })

  ipcMain.handle('ai:set-key', (_e, p: string, key: string) => {
    if (!PROVIDERS.includes(p as AiProvider)) throw new Error(`Unknown provider: ${p}`)
    if (typeof key !== 'string' || !key.trim()) throw new Error('Empty key')
    saveAiKey(p as AiProvider, key.trim())
    return true
  })

  ipcMain.handle('ai:clear-key', (_e, p: string) => {
    if (!PROVIDERS.includes(p as AiProvider)) throw new Error(`Unknown provider: ${p}`)
    clearAiKey(p as AiProvider)
    return true
  })

  ipcMain.handle('ai:complete', async (_e, req: AiCompleteRequest) => {
    return await callAi(req)
  })

  ipcMain.handle('ai:generate-image', async (_e, req: AiGenerateImageRequest) => {
    return await callAiImage(req)
  })

  // ── Tier-3: local diffusion sidecar (stable-diffusion.cpp) ───────────────
  //
  // These handlers mirror the cloud ai:* handlers above, but route to the
  // local sd-server child process instead of a cloud API. The sidecar is
  // lazy-spawned on the first `diffusion:start` or `diffusion:generate-image`
  // call — not on app launch — so the GPU isn't claimed until needed.
  //
  // getDiffusionSidecar() is safe to call here (inside ipcMain.handle which
  // only fires after app.whenReady()) — app.getPath('userData') is ready.
  ipcMain.handle('diffusion:get-status', () => getDiffusionSidecar().getStatus())
  ipcMain.handle('diffusion:list-models', () => getDiffusionSidecar().listModels())
  ipcMain.handle('diffusion:list-loras', () => getDiffusionSidecar().listLoras())
  ipcMain.handle('diffusion:start', async (_e, model: string) => {
    await getDiffusionSidecar().start(model)
    return getDiffusionSidecar().getStatus()
  })
  ipcMain.handle('diffusion:stop', async () => {
    await getDiffusionSidecar().stop()
    return getDiffusionSidecar().getStatus()
  })
  ipcMain.handle('diffusion:generate-image', async (_e, req) => {
    return await getDiffusionSidecar().generate(req)
  })
  ipcMain.handle('diffusion:edit-image', async (_e, req) => {
    return await getDiffusionSidecar().editImage(req)
  })
  ipcMain.handle('diffusion:get-body-mask', (_e, faction: string, vehicleId: string) => {
    return getDiffusionSidecar().getBodyMask(faction, vehicleId)
  })

  // ── Steam Workshop bridge ───────────────────────────────────────────
  // Steam-first: v1.0 requires a live Steam connection. The renderer
  // calls steam:init from the StartScreen and branches on the discriminated
  // failure code (no-steam / no-game / init-failed). Workshop publish/update
  // are gated behind a successful init in the renderer, but the IPC
  // handlers re-check via requireSteamClient() in steam.ts as a safety net.
  ipcMain.handle('steam:init', () => {
    const s = initSteam()
    return s.ok ? { ok: true as const, info: s.info } : { ok: false as const, error: s.error }
  })
  ipcMain.handle('steam:reset', () => {
    resetSteamCache()
  })
  ipcMain.handle('steam:workshop:publish', async (_e, input: PublishWorkshopInput) => {
    return await publishWorkshopItem(input)
  })
  ipcMain.handle(
    'steam:workshop:update',
    async (_e, workshopId: string, input: UpdateWorkshopInput) => {
      return await updateWorkshopItem(workshopId, input)
    },
  )
  ipcMain.handle('steam:workshop:get-mine', async () => {
    return await getMyWorkshopItems()
  })
  ipcMain.handle('steam:workshop:delete', async (_e, workshopId: string) => {
    return await deleteWorkshopItem(workshopId)
  })

  // ── Workshop content staging dir ────────────────────────────────────
  // Creates a fresh temporary directory for staging Workshop content before
  // publishing. The renderer builds the SGA + manifest into this dir, then
  // passes it as `contentPath` to steam:workshop:publish. The dir is unique
  // per call (mkdtemp) so concurrent publishes don't collide.
  ipcMain.handle('tmp:make-publish-dir', async () => {
    const base = path.join(app.getPath('temp'), 'coh2-workshop-publish-')
    const dir = await fs.promises.mkdtemp(base)
    return dir
  })

  // ── Native folder picker (fallback if auto-detect fails) ────────────
  ipcMain.handle('pick-directory', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select your CoH2 installation folder',
      properties: ['openDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // ── File system reads ──────────────────────────────────────────────────
  ipcMain.handle('read-file', async (_e, filePath: string) => {
    const buf = await fs.promises.readFile(filePath)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  })

  // Range read — used by the SGA reader to load TOC + individual file
  // blobs lazily, avoiding 300+ MB IPC transfers per archive open.
  ipcMain.handle(
    'read-file-range',
    async (_e, filePath: string, start: number, length: number) => {
      const fd = await fs.promises.open(filePath, 'r')
      try {
        const buf = Buffer.alloc(length)
        const { bytesRead } = await fd.read(buf, 0, length, start)
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + bytesRead)
      } finally {
        await fd.close()
      }
    },
  )

  ipcMain.handle('file-stat', async (_e, filePath: string) => {
    try {
      const s = await fs.promises.stat(filePath)
      return { size: s.size }
    } catch {
      return null
    }
  })

  ipcMain.handle('list-dir', async (_e, dirPath: string) => {
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
      return entries.map(e => ({ name: e.name, isDirectory: e.isDirectory() }))
    } catch {
      return []
    }
  })

  ipcMain.handle('file-exists', (_e, filePath: string) => {
    return fs.existsSync(filePath)
  })

  // Expose the Electron resources directory to the renderer so it can resolve
  // bundled extraResources paths (e.g. keys/template_0001.sga).
  ipcMain.handle('get-resources-path', () => process.resourcesPath)

  // ── Load ──────────────────────────────────────────────────────────────
  if (process.env.NODE_ENV === 'development') {
    // In dev, Vite serves under the same base path it would for GitHub
    // Pages — load the explicit URL so we don't follow a 302 first.
    // HEADLESS_SCREENSHOT_BYPASS=1 → force ConnectScreen with no Viewport
    // (useful when host has no GPU)
    // HEADLESS_SCREENSHOT_EDITOR=1 → skip Connect, land in Editor with auto-
    //   detected install (used by automated screenshot smoke tests)
    const hideTank = process.env.HEADLESS_HIDE_TANK ? '&hideTank=1' : ''
    const url = process.env.HEADLESS_SCREENSHOT_BYPASS
      ? 'http://localhost:5173/?screenshot=1'
      : process.env.HEADLESS_SCREENSHOT_EDITOR
        ? `http://localhost:5173/?headless=editor${hideTank}`
        : 'http://localhost:5173/'
    mainWindow.loadURL(url)
    // DevTools are now opt-in via `OPEN_DEVTOOLS=1` instead of opening on
    // every `electron:dev` launch. The user reported the detached panel
    // popping up every time they opened the app as noise. CI screenshot
    // runs never want DevTools, and the dev flow is a focused-write
    // loop where the user opens the panel themselves when they need it.
    if (process.env.OPEN_DEVTOOLS && !process.env.HEADLESS_SCREENSHOT) {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
  } else {
    const search = process.env.HEADLESS_SCREENSHOT_BYPASS
      ? 'screenshot=1'
      : process.env.HEADLESS_SCREENSHOT_EDITOR
        ? 'headless=editor'
        : ''
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), search ? { search } : undefined)
  }

  // HEADLESS_SCREENSHOT=/path/to/out.png → wait for first paint, capture, quit.
  // Useful in CI / sandboxed sessions where the host's screenshot tool can't
  // see the Electron window. Uses Electron's own webContents.capturePage()
  // which works regardless of the windowing system.
  if (process.env.HEADLESS_SCREENSHOT) {
    const outPath = process.env.HEADLESS_SCREENSHOT
    const delayMs = Number(process.env.HEADLESS_DELAY_MS ?? '6000')
    if (process.env.HEADLESS_FORWARD_CONSOLE) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mainWindow.webContents.on('console-message', (...args: any[]) => {
        const msg = typeof args[2] === 'string' ? args[2] : (args[0]?.message ?? '')
        if (msg) console.log('[renderer]', msg)
      })
    }
    const grab = async () => {
      console.log('[screenshot] grabbing...')
      try {
        const img = await mainWindow!.webContents.capturePage()
        const buf = img.toPNG()
        fs.writeFileSync(outPath, buf)
        const { width, height } = img.getSize()
        console.log(`[screenshot] wrote ${outPath} (${width}x${height}, ${buf.length} bytes)`)
      } catch (e) {
        console.error('[screenshot] failed', e)
      } finally {
        app.quit()
      }
    }
    // Fire on first paint OR after a hard timeout, whichever comes first.
    let grabbed = false
    const fire = () => {
      if (!grabbed) {
        grabbed = true
        grab()
      }
    }
    mainWindow.webContents.on('did-finish-load', () => {
      console.log(`[screenshot] did-finish-load — waiting ${delayMs}ms for paint`)
      setTimeout(fire, delayMs)
    })
    // Hard fallback if did-finish-load never fires
    setTimeout(fire, delayMs + 15000)
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Wait until the REACT TREE has committed and painted before surfacing
  // the window. The renderer fires `renderer-ready` via the preload
  // bridge once main.tsx has done its first rAF dance after
  // createRoot().render(), so by then the AuthShell + ConnectScreen
  // subtree is on screen.
  //
  // Why not `ready-to-show`: that event fires after Chromium paints the
  // first frame of the DOCUMENT — which for us is the static-welcome
  // HTML skeleton in index.html (kept around for Lighthouse LCP on the
  // web build). Showing the window then meant the user briefly saw the
  // unstyled static card before React hydrated over it. The user
  // reported this as "a broken connect menu and background appear
  // before the app loads".
  //
  // We keep a hard safety timeout so a renderer that never reports
  // ready (crash, JS exception in mount, blocked import) can't leave
  // the window permanently invisible. 6 s comfortably exceeds the
  // worst-case React mount on a cold cache; if anything is still
  // happening at that point the user is better off seeing whatever
  // shipped than staring at a blank screen.
  //
  // The headless code paths above either keep the window hidden the
  // whole time (HEADLESS_HIDE_ONLY) or call `capturePage()` without
  // surfacing the window (HEADLESS_SCREENSHOT), so we skip the
  // auto-show for those.
  if (!headless) {
    let shown = false
    const surface = () => {
      if (shown || !mainWindow) return
      shown = true
      // Re-centre right before showing. Electron applies the constructor's
      // `center: true` flag at creation, but some Linux compositors (KWin
      // in particular) re-place a hidden window when it's later shown,
      // landing it in the top-left of the active output rather than the
      // primary display midpoint. The explicit center() call here is a
      // belt-and-braces fix for the user-reported "doesn't open in the
      // centre" symptom — a no-op on platforms where the constructor flag
      // already worked, and a guaranteed centre on the ones where it
      // didn't.
      mainWindow.center()
      mainWindow.show()
    }
    ipcMain.once('renderer-ready', surface)
    // Safety net — never let the window stay invisible.
    setTimeout(surface, 6000)
  }
}

// ── Linux/Wayland console-noise suppression ─────────────────────────────
// On KDE Plasma + Wayland with a Mesa/RADV stack, Chromium emits two
// classes of stderr noise on every launch:
//
//   1. `WARNING: radv is not a conformant Vulkan implementation, testing
//      use only.` — printed by Mesa whenever the Vulkan loader probes the
//      driver. We don't actually need Vulkan (the renderer is WebGL2 +
//      Canvas2D), so disabling it removes the warning without losing any
//      capability.
//
//   2. `wayland_wp_color_manager.cc: Unable to set image transfer
//      function / Failed to populate image description` — Chromium tries
//      to negotiate the wp_color_management_v1 Wayland protocol, which
//      KWin doesn't fully implement yet. The negotiation failure is
//      harmless (Chromium falls back to sRGB) but Chromium logs it at
//      ERROR severity.
//
// Disabling the `WaylandPerSurfaceScale` and `WaylandWpColorManager`
// features stops Chromium from probing those protocols at all. The
// renderer falls back to sRGB and DPR=1 scaling, which is what we
// already assume in the WebGL shader pipeline. No visible difference;
// the terminal stays clean.
//
// Linux-only — on macOS/Windows these switches are silently ignored.
if (process.platform === 'linux') {
  // Stops the "radv is not conformant" Mesa warning.
  app.commandLine.appendSwitch(
    'disable-features',
    ['Vulkan', 'WaylandPerSurfaceScale', 'WaylandWpColorManager'].join(','),
  )
  // Force ANGLE->GL backend (skip Vulkan entirely on the GPU process).
  app.commandLine.appendSwitch('use-gl', 'angle')
  app.commandLine.appendSwitch('use-angle', 'gl')

  // Required for true-alpha framebuffer on native Wayland (transparent:true).
  // NO ozone-platform=x11 or ozone-platform-hint=x11 — forcing XWayland on
  // this AMD/RADV GPU segfaulted the GPU process (exit 139) → blank window.
  // The app runs on native Wayland exclusively.
  app.commandLine.appendSwitch('enable-transparent-visuals')
}

// ── SHOWCASE=1 gate ───────────────────────────────────────────────────────────
// Editor-render showcase: loads the app at ?audit=1&showcase=1, mounts
// AuditRunner's showcase mode (real Viewport + real overlayCanvas camo diffuse +
// real TC1 badge decal), and captures plain/camo/decal/camo+decal PNGs for ONE
// vehicle. DO NOT launch CoH2; reads SGAs read-only.
if (process.env.SHOWCASE === '1') {
  import('./showcase-capture').then(({ runShowcaseCapture }) => {
    runShowcaseCapture()
      .then(() => console.log('[showcase] Capture complete.'))
      .catch(e => { console.error('[showcase] Capture failed:', e); process.exit(1) })
  }).catch(e => {
    console.error('[showcase] Failed to load showcase-capture module:', e)
    process.exit(1)
  })
// ── VERIFY_VISUAL=1 gate ──────────────────────────────────────────────────────
// Phase-2 visual unwrap verifier: loads the app at ?audit=1&verify=1, mounts
// AuditRunner's verify mode (real Viewport + real TC1 badge shader), and
// captures base/cal PNG pairs for all 61 vehicles. DO NOT launch CoH2; reads
// SGAs read-only. Kept as its own gate so existing audit modes are untouched.
} else if (process.env.VERIFY_VISUAL === '1') {
  import('./verify-visual-capture').then(({ runVerifyVisualCapture }) => {
    runVerifyVisualCapture()
      .then(() => {
        console.log('[verify-visual] Capture complete, exiting.')
        app.quit()
      })
      .catch(e => {
        console.error('[verify-visual] Capture failed:', e)
        process.exit(1)
      })
  }).catch(e => {
    console.error('[verify-visual] Failed to load verify-visual-capture module:', e)
    process.exit(1)
  })
// ── UI_CAPTURE=1 gate ─────────────────────────────────────────────────────────
// Redesign-v2 UI-capture harness: loads the REAL production app (dist/, the
// normal main-window render path — NOT ?audit), drives it to named screens by
// clicking buttons like a user via webContents.executeJavaScript, and captures
// a PNG per state into artifacts/redesign-v2/ui-verify/. Real GPU. DO NOT
// launch CoH2; reads SGAs read-only. See electron/ui-capture.ts.
} else if (process.env.UI_CAPTURE === '1') {
  import('./ui-capture').then(({ runUiCapture }) => {
    runUiCapture()
      .then(() => console.log('[ui-capture] Capture complete.'))
      .catch(e => {
        console.error('[ui-capture] Capture failed:', e)
        process.exit(1)
      })
  }).catch(e => {
    console.error('[ui-capture] Failed to load ui-capture module:', e)
    process.exit(1)
  })
// ── AUDIT_REAL=1 gate ─────────────────────────────────────────────────────────
// Real-pipeline audit: loads the actual app at ?audit=1, mounts the real
// Viewport (MeshPhysicalMaterial + IBL + normalMap etc.), captures via
// webContents.capturePage(). DO NOT launch CoH2; reads SGAs read-only.
} else if (process.env.AUDIT_REAL === '1') {
  import('./audit-capture-real').then(({ runAuditCaptureReal }) => {
    runAuditCaptureReal()
      .then(() => {
        console.log('[audit-real] Capture complete, exiting.')
        app.quit()
      })
      .catch(e => {
        console.error('[audit-real] Capture failed:', e)
        process.exit(1)
      })
  }).catch(e => {
    console.error('[audit-real] Failed to load audit-capture-real module:', e)
    process.exit(1)
  })
// ── AUDIT_CAPTURE=1 gate ──────────────────────────────────────────────────────
// Legacy: loads audit-renderer.html (reimplemented renderer, flat diffuse only).
// Kept for reference but superseded by AUDIT_REAL=1.
} else if (process.env.AUDIT_CAPTURE === '1') {
  import('./audit-capture').then(({ runAuditCapture }) => {
    runAuditCapture()
      .then(() => {
        console.log('[audit] Capture complete, exiting.')
        app.quit()
      })
      .catch(e => {
        console.error('[audit] Capture failed:', e)
        process.exit(1)
      })
  }).catch(e => {
    console.error('[audit] Failed to load audit-capture module:', e)
    process.exit(1)
  })
} else {
  app.whenReady().then(() => {
    // Create the window first so the renderer can paint immediately.
    // AI settings + key decryption (safeStorage.decryptString) are deferred
    // to after createWindow() — on Linux with kwallet/gnome-keyring each
    // decrypt round-trips to the daemon and can block 50–500 ms. The keys
    // are only needed when the renderer calls `ai:complete`, not at startup.
    createWindow()
    // Load after window creation: no IPC handler fires before the renderer
    // is interactive, so there is no race — if ai:complete arrives before
    // these finish (extremely unlikely in practice), it will see an empty
    // aiKeyCache and return a "no key" error, which is correct behaviour.
    setImmediate(() => {
      loadAiSettings()
      for (const p of PROVIDERS) loadAiKey(p)
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Ensure the sd-server child is reaped before Electron exits.
//
// Without this, closing the window sends the child a SIGHUP that it may
// or may not handle, and on Windows it becomes a zombie that holds the
// GPU. The `before-quit` event fires on all quit paths (menu Quit, Ctrl-C,
// window-close on non-macOS) so this is the reliable place to hook cleanup.
//
// Pattern: preventDefault() -> async stop -> app.quit() (which re-fires
// before-quit, but isRunning() returns false the second time so we don't
// loop infinitely).
app.on('before-quit', async e => {
  const sidecar = getDiffusionSidecar()
  if (sidecar.isRunning()) {
    e.preventDefault()
    await sidecar.stop()
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
