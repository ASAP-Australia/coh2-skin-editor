/**
 * diffusion.ts — Tier-3 local image generation via stable-diffusion.cpp sidecar.
 *
 * Spawns `sd-server` (from leejet/stable-diffusion.cpp) as a child process that
 * listens on a free localhost port and exposes an OpenAI-compatible
 * /v1/images/generations endpoint. The Electron main process owns the entire
 * lifecycle: discovery, spawn, health-polling, generation, and graceful shutdown.
 *
 * Design constraints that shape this module:
 *
 *   - Single child process at a time. The GPU/CPU is a shared resource; queuing
 *     parallel requests would bloat VRAM and slow every job. The renderer is
 *     expected to serialise calls (or respect the `generating` state).
 *
 *   - Lazy start. We don't spawn on app launch — the binary is optional and many
 *     users will never install it. spawn() is called on the first generate() or
 *     when the renderer calls `diffusion:start` explicitly.
 *
 *   - Port auto-selection. We probe 7860-7900 at spawn time so multiple
 *     Electron instances (dev + production) don't collide, and so we don't
 *     hard-code a port that might already be in use by the system.
 *
 *   - SIGTERM → wait 3s → SIGKILL shutdown pattern keeps the GPU unblocked
 *     and avoids zombie processes when the window closes.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as net from 'net'
import * as child_process from 'child_process'
import { app } from 'electron'

// ── Local type copies ─────────────────────────────────────────────────────────
// The electron directory compiles under `rootDir: "electron"` which prevents
// importing from src/. We duplicate the diffusion types here — the canonical
// definitions live in src/lib/ai/types.ts and native-fs.ts imports from there.
// The runtime shape is identical; keep in sync if the canonical types change.

type DiffusionState =
  | 'unavailable'
  | 'no-model'
  | 'idle'
  | 'starting'
  | 'ready'
  | 'generating'
  | 'error'

interface DiffusionStatus {
  state: DiffusionState
  message?: string
  binaryPath: string | null
  availableModels: string[]
  activeModel: string | null
  port: number | null
}

export interface DiffusionGenerateImageRequest {
  prompt: string
  negativePrompt?: string
  width?: number
  height?: number
  steps?: number
  cfgScale?: number
  sampler?: 'euler' | 'euler_a' | 'dpm++2m' | 'dpm++2m_karras' | 'lcm'
  seed?: number
  loras?: { name: string; weight: number }[]
  model?: string
}

export interface DiffusionEditImageRequest extends DiffusionGenerateImageRequest {
  /** Base64-encoded PNG of the source image (no `data:` prefix). */
  imageBase64: string
  /** Denoising strength (0..1). 0 = copy original, 1 = full redraw.
   *  0.4 is the recommended default for subtle adjustments. */
  strength?: number
}

interface DiffusionGenerateImageResponse {
  imageBase64: string
  mimeType: 'image/png'
  width: number
  height: number
  durationMs: number
  model: string
  seed: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Map Node's process.platform values to the directory names we bundle
 *  the sd-server binary under inside extraResources. */
function platformDir(): 'linux' | 'win' | 'mac' {
  if (process.platform === 'win32') return 'win'
  if (process.platform === 'darwin') return 'mac'
  return 'linux'
}

/** Platform-specific binary name (Windows needs the .exe suffix). */
function binaryName(): string {
  return process.platform === 'win32' ? 'sd-server.exe' : 'sd-server'
}

// ─────────────────────────────────────────────────────────────────────────────
// Free-port probe
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the first port in [startPort, endPort] that is free on 127.0.0.1
 * by briefly opening a TCP server on it. Rejects if all ports are occupied.
 *
 * We bind on 127.0.0.1 (not 0.0.0.0) because sd-server is local-only and
 * binding on loopback avoids firewall prompts on macOS and Windows.
 */
function findFreePort(startPort = 7860, endPort = 7900): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = startPort

    const tryNext = () => {
      if (port > endPort) {
        reject(new Error(`No free port found in range ${startPort}-${endPort}`))
        return
      }
      const server = net.createServer()
      const candidate = port++

      server.once('error', () => {
        // Port is occupied; try the next one
        tryNext()
      })

      server.listen(candidate, '127.0.0.1', () => {
        // Got it — close immediately so sd-server can bind to it
        server.close(() => resolve(candidate))
      })
    }

    tryNext()
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// DiffusionSidecar
// ─────────────────────────────────────────────────────────────────────────────

export class DiffusionSidecar {
  // ── Instance state ────────────────────────────────────────────────────────

  private _state: DiffusionState = 'idle'
  private _message: string | undefined
  private _binaryPath: string | null = null
  private _currentModel: string | null = null
  private _currentPort: number | null = null
  private _child: child_process.ChildProcess | null = null

  // Seed from most recent start (resolved at generate time)
  private _lastSeed: number = -1

  constructor() {
    // Resolve the binary path eagerly so getStatus() can report it even
    // before the sidecar has been started. Also sets the initial state:
    // `unavailable` when the binary can't be found, `no-model` when
    // the binary is present but the models directory is empty, otherwise
    // `idle`.
    this._binaryPath = this._discoverBinary()
    if (this._binaryPath === null) {
      this._state = 'unavailable'
      this._message =
        'sd-server binary not found. Install it in userData/diffusion/bin/ or set COH2_SDCPP_BIN.'
    } else {
      // Ensure models directory exists so the user knows where to put files
      const models = this._listModels()
      this._state = models.length === 0 ? 'no-model' : 'idle'
      if (this._state === 'no-model') {
        this._message = `No model files found in ${this._modelsDir()}. Drop a .gguf or .safetensors there.`
      }
    }
  }

  // ── Directory helpers ─────────────────────────────────────────────────────

  private _modelsDir(): string {
    return path.join(app.getPath('userData'), 'diffusion', 'models')
  }

  private _lorasDir(): string {
    return path.join(app.getPath('userData'), 'diffusion', 'loras')
  }

  private _ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }

  // ── Binary discovery ──────────────────────────────────────────────────────

  /**
   * Walks through the priority-ordered candidate locations for sd-server
   * and returns the first path that points to an existing regular file.
   *
   * Priority:
   *   1. COH2_SDCPP_BIN env var  — developer override / custom install
   *   2. process.resourcesPath   — production (electron-builder extraResources)
   *   3. app.getAppPath()/../resources — vite-electron dev layout
   *   4. userData/diffusion/bin  — user self-installed binary
   */
  private _discoverBinary(): string | null {
    const plat = platformDir()
    const bin = binaryName()

    const candidates: string[] = []

    if (process.env.COH2_SDCPP_BIN) {
      candidates.push(process.env.COH2_SDCPP_BIN)
    }

    // process.resourcesPath is set by Electron in both production and dev,
    // but in dev it points to the app package directory rather than an
    // asar-unpacked resources/ subfolder. We include it anyway — worst case
    // the stat() returns null and we move on.
    try {
      candidates.push(path.join(process.resourcesPath, 'bin', plat, bin))
    } catch {
      // process.resourcesPath can throw before app is ready in some test
      // harnesses; ignore and continue.
    }

    try {
      candidates.push(path.join(app.getAppPath(), '..', 'resources', 'bin', plat, bin))
    } catch {
      /* not ready */
    }

    try {
      candidates.push(path.join(app.getPath('userData'), 'diffusion', 'bin', bin))
    } catch {
      /* not ready */
    }

    for (const candidate of candidates) {
      try {
        const stat = fs.statSync(candidate)
        if (stat.isFile()) return candidate
      } catch {
        // File doesn't exist or isn't accessible — try next candidate
      }
    }

    return null
  }

  // ── Model / LoRA discovery ────────────────────────────────────────────────

  /** Scan the models directory for .gguf and .safetensors files.
   *  Creates the directory if absent (so users can see where to put files).
   *  Returns sorted filenames (not paths). */
  private _listModels(): string[] {
    const dir = this._modelsDir()
    this._ensureDir(dir)
    try {
      return fs
        .readdirSync(dir)
        .filter(f => f.endsWith('.gguf') || f.endsWith('.safetensors'))
        .sort()
    } catch {
      return []
    }
  }

  /** Same as _listModels but for LoRA files. Used to validate
   *  req.loras[].name before appending them to the prompt. */
  private _listLoras(): string[] {
    const dir = this._lorasDir()
    this._ensureDir(dir)
    try {
      return fs
        .readdirSync(dir)
        .filter(f => f.endsWith('.gguf') || f.endsWith('.safetensors'))
        .sort()
    } catch {
      return []
    }
  }

  /** Discover bundled LoRA files shipped inside the app's resources.
   *
   *  In production builds electron-builder copies the `resources/loras/`
   *  directory into `<resourcesPath>/loras/`. In dev the equivalent path
   *  is relative to the app package root. We probe both locations the same
   *  way _discoverBinary() probes binary candidates. */
  private _bundledLorasDir(): string[] {
    const candidates: string[] = []
    try {
      candidates.push(path.join(process.resourcesPath, 'loras'))
    } catch {
      /* not ready */
    }
    try {
      candidates.push(path.join(app.getAppPath(), '..', 'resources', 'loras'))
    } catch {
      /* not ready */
    }
    return candidates
  }

  /** Resolve a LoRA stem name to its absolute on-disk path. Searches the same
   *  priority chain as `listLoras()`: userData/diffusion/loras/ first, then
   *  bundled <resourcesPath>/loras/ (or dev fallback). Returns null if no
   *  matching `.safetensors` file is found. The absolute path is what the
   *  sd-server `sd_cpp_extra_args` schema expects for `lora[].path`. */
  private _resolveLoraPath(stem: string): string | null {
    const filename = `${stem}.safetensors`
    const candidates: string[] = [this._lorasDir(), ...this._bundledLorasDir()]
    for (const dir of candidates) {
      const fp = path.join(dir, filename)
      try {
        if (fs.existsSync(fp)) return fp
      } catch {
        /* ignore */
      }
    }
    return null
  }

  /** Public discovery for the IPC `diffusion:list-loras` handler.
   *
   *  Checks two locations in priority order so userData overrides bundled
   *  copies but a userData copy doesn't appear twice:
   *    1. userData/diffusion/loras/  — user-installed or fine-tuned LoRAs
   *    2. <resourcesPath>/loras/     — shipping LoRA (coh2-camo-v1, etc.)
   *
   *  Returns `.safetensors` stem names (without the extension) because:
   *    - The UI displays the name directly without stripping suffixes.
   *    - Internally we re-resolve stem → absolute path via _resolveLoraPath().
   *  De-duplicates by stem so an override in userData doesn't show up twice. */
  listLoras(): string[] {
    const seen = new Set<string>()
    const results: string[] = []

    const addFromDir = (dir: string) => {
      try {
        if (!fs.existsSync(dir)) return
        for (const f of fs.readdirSync(dir).sort()) {
          if (!f.endsWith('.safetensors')) continue
          const stem = f.replace(/\.safetensors$/, '')
          if (!seen.has(stem)) {
            seen.add(stem)
            results.push(stem)
          }
        }
      } catch {
        // Directory unreadable — skip silently
      }
    }

    // userData wins: check user-installed LoRAs first
    addFromDir(this._lorasDir())

    // Bundled fallback: coh2-camo-v1 and any other shipped adapters
    for (const dir of this._bundledLorasDir()) {
      addFromDir(dir)
    }

    return results
  }

  // ── Body-mask discovery ──────────────────────────────────────────────────
  //
  // Per-vehicle body masks live alongside the LoRAs in resources/masks/ and
  // are bundled into <resourcesPath>/masks/ in production. Each mask is a
  // single-channel PNG (white=body=paint with camo, black=track/equipment=
  // preserve vanilla) with the filename `<faction>_<vehicleId>.png`.
  //
  // Used by the renderer at inference time to composite the LoRA-generated
  // texture onto the vanilla UV atlas so equipment/track UV regions stay
  // pixel-identical to vanilla — that's what makes the output a "valid CoH2
  // texture file". The composite is done in the renderer (canvas math is
  // cheap; PNG roundtrip through IPC is not), so this handler only exists
  // to feed the mask bytes to the renderer.

  /** Candidate directories for bundled body masks, prod first then dev. */
  private _bundledMasksDir(): string[] {
    const candidates: string[] = []
    try {
      candidates.push(path.join(process.resourcesPath, 'masks'))
    } catch {
      /* not ready */
    }
    try {
      candidates.push(path.join(app.getAppPath(), '..', 'resources', 'masks'))
    } catch {
      /* not ready */
    }
    return candidates
  }

  /** Return the bundled body-mask PNG bytes for the given vehicle, base64-
   *  encoded. Returns null when no mask is shipped — caller treats that as
   *  "paint the whole atlas" (no equipment preservation). */
  getBodyMask(faction: string, vehicleId: string): string | null {
    const filename = `${faction}_${vehicleId}.png`
    for (const dir of this._bundledMasksDir()) {
      const fp = path.join(dir, filename)
      try {
        if (fs.existsSync(fp)) {
          return fs.readFileSync(fp).toString('base64')
        }
      } catch {
        /* ignore */
      }
    }
    return null
  }

  // ── Port probe ────────────────────────────────────────────────────────────

  private async _pickPort(): Promise<number> {
    return findFreePort(7860, 7900)
  }

  // ── Health check ─────────────────────────────────────────────────────────

  /**
   * Poll GET /v1/models every 1s. Resolves true on 200 OK, false on timeout.
   * sd-server only starts serving after the model is fully loaded into memory,
   * which on slow hardware with a large GGUF can take 10-30s.
   */
  private _pollHealthcheck(port: number, timeoutMs: number): Promise<boolean> {
    return new Promise(resolve => {
      const deadline = Date.now() + timeoutMs
      let done = false

      const check = async () => {
        if (done) return
        if (Date.now() > deadline) {
          done = true
          resolve(false)
          return
        }
        try {
          const r = await fetch(`http://127.0.0.1:${port}/v1/models`, {
            signal: AbortSignal.timeout(2000),
          })
          if (r.ok) {
            done = true
            resolve(true)
            return
          }
        } catch {
          // Not up yet — swallow and retry
        }
        if (!done) setTimeout(check, 1000)
      }

      check()
    })
  }

  // ── Spawn ─────────────────────────────────────────────────────────────────

  /**
   * Spawn the sd-server child process and wait for it to be ready.
   *
   * Readiness is detected by either:
   *   (a) The process stdout emitting a line containing "listening on"
   *       (case-insensitive), or
   *   (b) The health check endpoint returning 200 OK.
   * Whichever fires first wins. Both listeners are cleaned up after.
   *
   * Failure modes:
   *   - Child exits before printing the ready signal → rejects with its
   *     exit code so the user sees a useful error.
   *   - 90s hard timeout → rejects with a timeout error. This covers
   *     cases where the binary silently hangs (corrupt GGUF, OOM).
   */
  async start(modelOverride?: string): Promise<void> {
    // Already up — nothing to do
    if (this._state === 'ready' || this._state === 'generating') return

    if (this._state === 'starting') {
      // Another caller is already waiting; don't double-spawn. We can't
      // elegantly await the existing promise here without a more complex
      // event pattern, so we poll briefly and then error out.
      throw new Error('Diffusion sidecar is already starting')
    }

    if (this._state === 'unavailable') {
      throw new Error(this._message ?? 'sd-server binary not found')
    }

    // Re-check binary (might have been installed after constructor ran)
    if (!this._binaryPath) {
      this._binaryPath = this._discoverBinary()
      if (!this._binaryPath) {
        this._state = 'unavailable'
        this._message = 'sd-server binary not found'
        throw new Error(this._message)
      }
    }

    // Resolve model
    const models = this._listModels()
    if (models.length === 0) {
      this._state = 'no-model'
      this._message = `No model files found in ${this._modelsDir()}`
      throw new Error(this._message)
    }

    const modelFile = modelOverride ?? models[0]
    if (!models.includes(modelFile)) {
      throw new Error(`Model "${modelFile}" not found. Available: ${models.join(', ')}`)
    }

    const modelPath = path.join(this._modelsDir(), modelFile)
    const port = await this._pickPort()

    this._state = 'starting'
    this._message = `Loading model ${modelFile}…`
    this._currentPort = port

    const args = [
      '-m',
      modelPath,
      '--listen-port',
      String(port),
      '--listen-ip',
      '127.0.0.1',
      '--diffusion-fa', // Flash attention — meaningful speed gain on RDNA
      '--vae-on-cpu', // RDNA Vulkan workaround: VAE decode on CPU avoids
      '--clip-on-cpu', //   the NaN/black-image bug seen on RX 6000/7000
      '--offload-to-cpu', // Keep peak VRAM under 16 GB for most SDXL models
      '-t',
      '8', // 8 threads for CPU fallback ops (tokeniser, etc.)
    ]

    console.log(`[diffusion] spawning: ${this._binaryPath} ${args.join(' ')}`)

    const child = child_process.spawn(this._binaryPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this._child = child

    // Pipe child output to console so developers can see what sd-server
    // is doing without having to tail a separate log file.
    child.stdout!.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n').filter(Boolean)
      for (const line of lines) console.log('[diffusion]', line)
    })
    child.stderr!.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n').filter(Boolean)
      for (const line of lines) console.error('[diffusion]', line)
    })

    await new Promise<void>((resolve, reject) => {
      let settled = false

      const settle = (err?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(hardTimeout)
        if (err) {
          this._state = 'error'
          this._message = err.message
          this._currentPort = null
          this._child = null
          reject(err)
        } else {
          this._state = 'ready'
          this._message = undefined
          this._currentModel = modelFile
          resolve()
        }
      }

      // Hard 90-second timeout — covers the case where sd-server starts but
      // the model file is so large it takes longer than the poll loop catches.
      const hardTimeout = setTimeout(() => {
        settle(new Error('sd-server did not become ready within 90 seconds'))
        child.kill('SIGKILL')
      }, 90_000)

      // (a) stdout "listening on" signal — sd-server prints this as soon as
      //     it binds the port and before model loading completes in some
      //     builds. We also start health-polling concurrently so whichever
      //     is more reliable wins.
      child.stdout!.on('data', (chunk: Buffer) => {
        if (/listening on/i.test(chunk.toString())) {
          settle()
        }
      })

      // (b) Health poll — more reliable than parsing log strings across
      //     builds. Runs until settled or the 90s deadline.
      this._pollHealthcheck(port, 88_000).then(ok => {
        if (ok) settle()
        else if (!settled) settle(new Error('sd-server health check timed out'))
      })

      // Child exited before we got a ready signal — probably a bad model
      // path or a missing library.
      child.once('exit', (code, signal) => {
        if (!settled) {
          settle(new Error(`sd-server exited prematurely (code=${code ?? signal})`))
        }
      })

      child.once('error', err => {
        settle(new Error(`Failed to spawn sd-server: ${err.message}`))
      })
    })

    console.log(`[diffusion] ready — model=${modelFile}, port=${port}`)
  }

  // ── Shutdown ──────────────────────────────────────────────────────────────

  /** Gracefully terminate the child. Called from the app before-quit handler
   *  to avoid zombie sd-server processes that hold the GPU.
   *
   *  SIGTERM → 3s grace period → SIGKILL if still alive.
   */
  async stop(): Promise<void> {
    const child = this._child
    if (!child) return

    console.log('[diffusion] stopping sd-server…')
    child.kill('SIGTERM')

    await new Promise<void>(resolve => {
      const forcekill = setTimeout(() => {
        console.warn('[diffusion] sd-server did not exit within 3s — sending SIGKILL')
        child.kill('SIGKILL')
        resolve()
      }, 3000)

      child.once('exit', () => {
        clearTimeout(forcekill)
        resolve()
      })
    })

    console.log('[diffusion] sd-server stopped')
    this._child = null
    this._currentPort = null
    this._currentModel = null
    // After a clean stop, go back to idle (not error) so the user can
    // restart without having to reset anything.
    const models = this._listModels()
    this._state = models.length === 0 ? 'no-model' : 'idle'
    this._message = undefined
  }

  // ── isRunning ─────────────────────────────────────────────────────────────

  /** True when the child process is alive and we should defer quit. */
  isRunning(): boolean {
    return (
      this._child !== null &&
      (this._state === 'ready' || this._state === 'generating' || this._state === 'starting')
    )
  }

  // ── Generate ──────────────────────────────────────────────────────────────

  /**
   * Run a single image generation. The state machine must be in `ready`
   * or `idle` (in which case we start first). Busy-rejects `generating`
   * so the renderer can show a "busy" error instead of silently queueing.
   *
   * Prompt construction: LoRA tokens are prepended as `<lora:NAME:WEIGHT>`
   * tokens separated by spaces. sd.cpp parses these out of the prompt string
   * before sending to the model's text encoder — no API field for it.
   *
   * Timeout: 5 minutes. Local generation on CPU-fallback with a large SDXL
   * Q4 model at 1024² can take 3-4 minutes even with 8 threads. We'd rather
   * surface a clear timeout than leave the renderer waiting indefinitely.
   */
  async generate(req: DiffusionGenerateImageRequest): Promise<DiffusionGenerateImageResponse> {
    if (this._state === 'unavailable') {
      throw new Error(this._message ?? 'sd-server binary not found. Install it first.')
    }
    if (this._state === 'no-model') {
      throw new Error(
        this._message ??
          'No diffusion model installed. Drop a .gguf into userData/diffusion/models/.',
      )
    }
    if (this._state === 'generating') {
      throw new Error(
        'Diffusion sidecar busy; wait for the previous generation to finish before starting a new one.',
      )
    }

    // Auto-start if idle or error (allow retry after error)
    if (this._state === 'idle' || this._state === 'error') {
      await this.start(req.model)
    }

    // If start() asked for a different model than what's loaded, restart.
    // (Only relevant when state was already `ready` and caller passes model=.)
    if (req.model && req.model !== this._currentModel && this._state === 'ready') {
      await this.stop()
      await this.start(req.model)
    }

    // Transition to generating
    this._state = 'generating'
    const started = Date.now()

    try {
      const port = this._currentPort!

      // Build the prompt. sd-server's OpenAI-compatible /v1/images/generations
      // endpoint does NOT parse `<lora:...>` prompt syntax (see examples/server/
      // api.md "Global LoRA rule"). Instead, structured LoRA entries are
      // injected via the `sd_cpp_extra_args` extension block — a JSON payload
      // matching the native sdcpp API schema, embedded in the prompt and
      // stripped by the server before generation.
      let prompt = req.prompt
      if (req.loras && req.loras.length > 0) {
        const loraEntries: { path: string; multiplier: number }[] = []
        for (const l of req.loras) {
          const stem = l.name.replace(/\.safetensors$/, '')
          const absPath = this._resolveLoraPath(stem)
          if (!absPath) {
            console.warn(`[diffusion] LoRA "${l.name}" not found in any loras dir; skipping`)
            continue
          }
          loraEntries.push({ path: absPath, multiplier: l.weight })
        }
        if (loraEntries.length > 0) {
          const extraArgs = JSON.stringify({ lora: loraEntries })
          prompt = `${req.prompt} <sd_cpp_extra_args>${extraArgs}</sd_cpp_extra_args>`
        }
      }

      // Map our friendly sampler names to the values sd-server expects.
      // sd.cpp's HTTP server accepts the 'euler', 'euler_a', 'dpm++2m' etc.
      // names directly in sampler_name — no translation needed.
      const body = {
        prompt,
        negative_prompt: req.negativePrompt ?? '',
        width: req.width ?? 1024,
        height: req.height ?? 1024,
        steps: req.steps ?? 6,
        cfg_scale: req.cfgScale ?? 1.0,
        sampler_name: req.sampler ?? 'euler',
        seed: req.seed ?? -1,
        n: 1,
        response_format: 'b64_json',
      }

      // 5-minute timeout — local generation on CPU can be slow
      const controller = new AbortController()
      const timeoutHandle = setTimeout(() => controller.abort(), 5 * 60 * 1000)

      let resp: Response
      try {
        resp = await fetch(`http://127.0.0.1:${port}/v1/images/generations`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeoutHandle)
      }

      if (!resp.ok) {
        const text = await resp.text().catch(() => '(unreadable body)')
        throw new Error(`sd-server ${resp.status}: ${text}`)
      }

      const json = (await resp.json()) as {
        data?: { b64_json?: string; seed?: number }[]
      }

      const item = json.data?.[0]
      const b64 = item?.b64_json
      if (!b64) {
        throw new Error('sd-server response missing data[0].b64_json')
      }

      // sd-server echoes back the resolved seed when -1 was passed
      const resolvedSeed = item?.seed ?? req.seed ?? -1

      const durationMs = Date.now() - started
      this._state = 'ready'

      return {
        imageBase64: b64,
        mimeType: 'image/png',
        width: req.width ?? 1024,
        height: req.height ?? 1024,
        durationMs,
        model: this._currentModel!,
        seed: resolvedSeed,
      }
    } catch (err) {
      // On error, drop back to `ready` if the child is still alive so the
      // renderer can retry. If the child died, mark as `error`.
      if (this._child && !this._child.killed) {
        this._state = 'ready'
      } else {
        this._state = 'error'
        this._child = null
        this._currentPort = null
        this._currentModel = null
      }

      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Diffusion generate failed: ${msg}`, { cause: err })
    }
  }

  // ── Edit (img2img) ────────────────────────────────────────────────────────

  /**
   * Refine an existing image via img2img. Routes to /sdapi/v1/img2img on the
   * sd-server sidecar (the WebUI-compatible endpoint), which accepts base64
   * init_images inline — no multipart/form-data required.
   *
   * Uses the same state-machine guard as generate(): auto-starts when idle,
   * rejects when already generating.
   *
   * `strength` (denoising_strength) controls how much the init image is
   * respected. 0 = exact copy, 1 = full redraw. 0.4 is a sensible default
   * for camo adjustments: composition is preserved but palette / texture
   * can shift meaningfully.
   */
  async editImage(req: DiffusionEditImageRequest): Promise<DiffusionGenerateImageResponse> {
    if (this._state === 'unavailable') {
      throw new Error(this._message ?? 'sd-server binary not found. Install it first.')
    }
    if (this._state === 'no-model') {
      throw new Error(this._message ?? 'No diffusion model installed.')
    }
    if (this._state === 'generating') {
      throw new Error('Diffusion sidecar busy; wait for the current job to finish.')
    }

    // Auto-start if not running yet
    if (this._state === 'idle' || this._state === 'error') {
      await this.start(req.model)
    }

    // Reload if a different model is requested
    if (req.model && req.model !== this._currentModel && this._state === 'ready') {
      await this.stop()
      await this.start(req.model)
    }

    this._state = 'generating'
    const started = Date.now()

    try {
      const port = this._currentPort!

      // Splice LoRA entries via sd_cpp_extra_args, identical to generate()
      let prompt = req.prompt
      if (req.loras && req.loras.length > 0) {
        const loraEntries: { path: string; multiplier: number }[] = []
        for (const l of req.loras) {
          const stem = l.name.replace(/\.safetensors$/, '')
          const absPath = this._resolveLoraPath(stem)
          if (!absPath) {
            console.warn(`[diffusion] LoRA "${l.name}" not found; skipping`)
            continue
          }
          loraEntries.push({ path: absPath, multiplier: l.weight })
        }
        if (loraEntries.length > 0) {
          const extraArgs = JSON.stringify({ lora: loraEntries })
          prompt = `${req.prompt} <sd_cpp_extra_args>${extraArgs}</sd_cpp_extra_args>`
        }
      }

      // /sdapi/v1/img2img — WebUI-compatible JSON endpoint. Accepts base64
      // in init_images[], so no multipart form-data encoding needed. The
      // `denoising_strength` field controls img2img strength (0..1).
      const body = {
        prompt,
        negative_prompt: req.negativePrompt ?? '',
        init_images: [`data:image/png;base64,${req.imageBase64}`],
        denoising_strength: req.strength ?? 0.4,
        width: req.width ?? 1024,
        height: req.height ?? 1024,
        steps: req.steps ?? 6,
        cfg_scale: req.cfgScale ?? 1.0,
        sampler_name: req.sampler ?? 'euler',
        seed: req.seed ?? -1,
        batch_size: 1,
      }

      const controller = new AbortController()
      const timeoutHandle = setTimeout(() => controller.abort(), 5 * 60 * 1000)

      let resp: Response
      try {
        resp = await fetch(`http://127.0.0.1:${port}/sdapi/v1/img2img`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeoutHandle)
      }

      if (!resp.ok) {
        const text = await resp.text().catch(() => '(unreadable body)')
        throw new Error(`sd-server img2img ${resp.status}: ${text}`)
      }

      // /sdapi/v1/img2img returns { images: string[], info: string }
      // where each image is a bare base64 PNG (no data: prefix).
      const json = (await resp.json()) as {
        images?: string[]
        info?: string
      }

      const b64 = json.images?.[0]
      if (!b64) throw new Error('sd-server img2img response missing images[0]')

      // The WebUI endpoint buries the resolved seed inside the `info` JSON
      // string. Parse it best-effort; fall back to the requested seed.
      let resolvedSeed = req.seed ?? -1
      if (json.info) {
        try {
          const info = JSON.parse(json.info) as { seed?: number }
          if (typeof info.seed === 'number') resolvedSeed = info.seed
        } catch {
          /* tolerate unparseable info */
        }
      }

      const durationMs = Date.now() - started
      this._state = 'ready'

      return {
        imageBase64: b64,
        mimeType: 'image/png',
        width: req.width ?? 1024,
        height: req.height ?? 1024,
        durationMs,
        model: this._currentModel!,
        seed: resolvedSeed,
      }
    } catch (err) {
      if (this._child && !this._child.killed) {
        this._state = 'ready'
      } else {
        this._state = 'error'
        this._child = null
        this._currentPort = null
        this._currentModel = null
      }
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Diffusion editImage failed: ${msg}`, { cause: err })
    }
  }

  // ── Status ────────────────────────────────────────────────────────────────

  getStatus(): DiffusionStatus {
    return {
      state: this._state,
      message: this._message,
      binaryPath: this._binaryPath,
      availableModels: this._listModels(),
      activeModel: this._currentModel,
      port: this._currentPort,
    }
  }

  /** Public alias used by the IPC `diffusion:list-models` handler. */
  listModels(): string[] {
    return this._listModels()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton factory
// ─────────────────────────────────────────────────────────────────────────────

// One instance per Electron main process. We can't use a module-level `const`
// initialised at import time because the Electron `app` module isn't ready
// until after `app.whenReady()` resolves — app.getPath('userData') would throw.
// Instead we lazily create on first call, which always happens after app-ready
// (from inside an ipcMain.handle, which only fires after the window is open).

let _sidecar: DiffusionSidecar | null = null

export function getDiffusionSidecar(): DiffusionSidecar {
  if (!_sidecar) {
    _sidecar = new DiffusionSidecar()
  }
  return _sidecar
}
