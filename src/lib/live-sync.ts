/**
 * Live Sync — debounced, opt-in auto-export of the active skin / faceplate
 * project into the user's CoH2 mods directory whenever a change is made.
 *
 * Architecture
 * ────────────
 * `LiveSyncManager` is a lightweight observable singleton. React components
 * subscribe via `useLiveSync()` which wraps `useSyncExternalStore`.
 *
 * State machine
 * ─────────────
 *   idle      — enabled, nothing pending
 *   queued    — a sync is in flight; another mutation arrived → will re-run
 *   syncing   — export + write is in progress
 *   synced    — last write succeeded; reason ages ("just now" → "30 s ago" …)
 *   error     — last write failed; reason explains why
 *   disabled  — feature is off (localStorage flag)
 *
 * The "synced" freshness ticker runs as a 30-second repeating interval; it
 * only updates the reason string, does no FS work.
 */

import type { Coh2SkinProject } from '@/lib/project'
import type { Coh2FaceplateProject } from '@/lib/faceplate-project'
import type { Coh2DecalPackProject } from '@/lib/decal-pack-project'
// Electron auto-detect bridge. In a browser host the native-fs functions
// are no-ops (isElectron() returns false, detect* return null) so this
// module stays usable on the web. We import statically rather than via
// dynamic `await import(...)` to avoid the extra microtask delays that
// would push picker-fallback timing past the test suite's microtask
// flush limits.
import { isElectron, detectModsPath, detectInstallPath, nativePathToHandle, makeTmpPublishDir, writeFile } from '@/lib/native-fs'

// ─── Types ────────────────────────────────────────────────────────────────────

export type LiveSyncState = 'idle' | 'syncing' | 'synced' | 'queued' | 'error' | 'disabled'

/** State of the background Workshop auto-update (separate from local sync). */
export type WorkshopSyncState = 'idle' | 'pushing' | 'synced' | 'error'

export interface WorkshopSyncStatus {
  state: WorkshopSyncState
  reason: string
}

export interface LiveSyncSnapshot {
  state: LiveSyncState
  reason: string
  enabled: boolean
  /** Status of the last (or in-progress) Workshop auto-update. */
  workshopSync: WorkshopSyncStatus
  actions: {
    toggle: () => void
    syncNow: () => void
    connectInstall: () => Promise<void>
  }
}

type SyncKind = 'skin' | 'faceplate' | 'decal'

/** Union of every project shape Live Sync knows how to build. Each `kind`
 *  branch in `_build()` narrows to a concrete project type. */
type AnyProject = Coh2SkinProject | Coh2FaceplateProject | Coh2DecalPackProject

/**
 * Thrown by `_build()` when the signing key pool / template SGA is absent from
 * the build (e.g. packaged Electron app without `tools/publish-templates.sh`).
 * `_runSync` catches this specifically and sets state to `idle` with an
 * informative tooltip — no red error cross — because the absence is expected.
 */
class KeyPoolAbsentError extends Error {
  constructor() {
    super('Signing template not available')
    this.name = 'KeyPoolAbsentError'
  }
}

type Listener = () => void

// ─── Persistence key ──────────────────────────────────────────────────────────

const LS_ENABLED_KEY = 'coh2-skin:live-sync-enabled'
const IDB_DIR_KEY = 'coh2-skin:install-dir-handle'

// ─── IndexedDB helpers (inline, no dependency) ────────────────────────────────

const IDB_NAME = 'coh2-skin-editor'
const IDB_VER = 1
const IDB_STORE = 'handles'

function openLiveSyncDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(IDB_NAME, IDB_VER)
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(IDB_STORE)) {
        r.result.createObjectStore(IDB_STORE)
      }
    }
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

async function idbGetHandle(key: string): Promise<FileSystemDirectoryHandle | null> {
  const db = await openLiveSyncDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key)
    tx.onsuccess = () => resolve((tx.result ?? null) as FileSystemDirectoryHandle | null)
    tx.onerror = () => reject(tx.error)
  })
}

async function idbSetHandle(key: string, val: FileSystemDirectoryHandle): Promise<void> {
  const db = await openLiveSyncDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(val, key)
    tx.onsuccess = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ─── Freshness label helper ───────────────────────────────────────────────────

function freshnessLabel(syncedAt: number): string {
  const secs = Math.floor((Date.now() - syncedAt) / 1000)
  if (secs < 5) return 'Synced just now'
  if (secs < 90) return `Synced ${secs} s ago`
  const mins = Math.floor(secs / 60)
  return `Synced ${mins} min ago`
}

/**
 * The step Live Sync CANNOT do for you.
 *
 * "Synced" means the pack has been written into the CoH2 mods folder — that is
 * genuinely all this app can automate. CoH2 will NOT show a skin just because
 * it is installed: it must also be EQUIPPED, and the equipped loadout lives
 * server-side in an encrypted blob, so nothing local can set it.
 *
 * Verified 2026-07-27: a skin built by this app was installed into
 * mods/skins/ and a match was started. The pack is byte-structurally identical
 * to third-party skins the engine renders (same
 * art/armies/<faction>/vehicles/<id>/skins/<modGuid>_<season>/ layout), yet the
 * vehicles rendered in their default camo — because nothing had equipped it.
 *
 * Without this hint a user reasonably concludes the app is broken, so it is
 * surfaced wherever sync status is shown.
 */
export const EQUIP_HINT =
  'Installed — to see it in game, equip it in CoH2: main menu → your player card → weapons-case icon → drag the skin onto a vehicle slot. Custom skins only render in Custom Games, not Automatch.'

/** Tooltip for the pack-name pill, including the equip step once synced. */
export function liveSyncTooltip(
  enabled: boolean,
  reason: string,
  state: LiveSyncState,
  prefix = 'Click to rename',
): string {
  if (!enabled) return `${prefix} — Live Sync is off`
  const base = `${prefix} — Live Sync: ${reason}`
  return state === 'synced' ? `${base}\n\n${EQUIP_HINT}` : base
}

// ─── Manager ──────────────────────────────────────────────────────────────────

class LiveSyncManager {
  private _state: LiveSyncState
  private _reason: string
  private readonly _listeners: Set<Listener> = new Set()

  // Cached snapshot for useSyncExternalStore identity stability. React calls
  // getSnapshot during render and compares with Object.is — if we ever return
  // a new reference without the store actually mutating, React assumes it
  // tore mid-render and re-renders forever (Maximum update depth exceeded).
  // We rebuild the snapshot only when _state / _reason / _syncedAt change,
  // and invalidate this cache before notifying listeners.
  private _snapshot: LiveSyncSnapshot | null = null

  // Debounce timer handle
  private _debounceTimer: number | null = null
  // Queued work — the last scheduled call's arguments
  private _queued: { kind: SyncKind; project: AnyProject } | null = null
  // Whether a sync is currently in flight
  private _inFlight = false
  // Freshness ticker
  private _freshnessTimer: number | null = null
  private _syncedAt = 0

  // ── Workshop push state ───────────────────────────────────────────────────
  /** Coalescing timer handle for the Workshop push (12 s idle delay). */
  private _wsTimer: number | null = null
  /** Whether a Workshop update IPC call is currently in flight. */
  private _wsInFlight = false
  /** The workshopId currently being pushed (guard against overlapping pushes). */
  private _wsPushingId: string | null = null
  /** Current Workshop auto-update state. */
  private _wsState: WorkshopSyncState = 'idle'
  private _wsReason = ''

  constructor() {
    // Q7 (Live Sync opt-out): Live Sync defaults ON — every edit (decal
    // drag, camo change, name/icon update) is debounced and written into
    // the user's CoH2 mods folder automatically — but the user can now
    // pause it via the badge toggle. The enabled flag is persisted in
    // localStorage so the choice survives across sessions. A missing flag
    // (first run, or upgrade from the old always-on build that only ever
    // wrote 'true') defaults to ON, preserving the prior default behaviour
    // exactly. Only an explicit persisted 'false' starts the session paused.
    const persisted = localStorage.getItem(LS_ENABLED_KEY)
    if (persisted === 'false') {
      this._state = 'disabled'
      this._reason = 'Live Sync is off'
    } else {
      // Default ON. Re-assert the persisted flag so the badge and the
      // _resolveModsHandle() first-use picker path see a consistent value.
      localStorage.setItem(LS_ENABLED_KEY, 'true')
      this._state = 'idle'
      this._reason = 'No changes yet'
    }
  }

  // ── Observable ──────────────────────────────────────────────────────────────

  subscribe(listener: Listener): () => void {
    this._listeners.add(listener)
    return () => this._listeners.delete(listener)
  }

  getSnapshot(): LiveSyncSnapshot {
    return this._snapshot ?? (this._snapshot = this._buildSnapshot())
  }

  private _buildSnapshot(): LiveSyncSnapshot {
    return {
      state: this._state,
      reason: this._reason,
      enabled: this._state !== 'disabled',
      workshopSync: { state: this._wsState, reason: this._wsReason },
      actions: {
        toggle: () => this.setEnabled(this._state === 'disabled'),
        syncNow: () => {
          if (this._queued) {
            void this._runSync(this._queued.kind, this._queued.project)
          }
        },
        connectInstall: () => this.connectInstall(),
      },
    }
  }

  private _notify() {
    this._listeners.forEach(l => l())
  }

  private _setState(state: LiveSyncState, reason: string) {
    this._state = state
    this._reason = reason
    // Invalidate cached snapshot BEFORE notifying — when subscribers wake up
    // and call getSnapshot(), they must see the freshly-built object that
    // reflects the new state.
    this._snapshot = null
    this._notify()
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  isEnabled(): boolean {
    return this._state !== 'disabled'
  }

  /**
   * Q7 (Live Sync opt-out): honour the disable flag.
   *
   * `setEnabled(true)`  — resume syncing. Transitions out of `disabled`,
   *   persists the flag, fires the first-use mods-folder picker if needed,
   *   and (when a mutation is already queued) triggers one sync of the
   *   latest state so re-enabling doesn't require another edit to catch up.
   *
   * `setEnabled(false)` — PAUSE syncing. Persists the flag, cancels any
   *   pending debounce / freshness timers, and moves to the `disabled`
   *   state. While disabled, `schedule()` early-returns (see its
   *   `isEnabled()` guard) so no build or FS write happens. Any in-flight
   *   sync is allowed to finish, but its `finally` block will NOT replay
   *   queued work because it re-checks `isEnabled()`.
   *
   * No-ops when the requested state already matches, so a redundant toggle
   * doesn't reset timers or re-fire the picker.
   */
  setEnabled(enabled: boolean) {
    if (enabled === this.isEnabled()) return

    localStorage.setItem(LS_ENABLED_KEY, enabled ? 'true' : 'false')

    if (enabled) {
      this._setState('idle', 'No changes yet')
      // First-time enable: if we don't have a writeable mods-folder
      // handle in IDB yet, kick off the directory picker now. This call
      // is wired to the click handler that triggered the call, so the
      // user-gesture requirement for `showDirectoryPicker` is still
      // satisfied. Errors (user cancelled, picker unavailable) are
      // swallowed — the badge will keep state=idle with reason "No
      // changes yet", and the first scheduled sync surfaces a precise
      // "Connect to game install" error if no handle exists.
      void this._ensureModsHandleOnEnable()

      // Resume: if a mutation was captured while paused (schedule() stores
      // the latest project even though it early-returns on the write), sync
      // that latest state now so re-enabling immediately reflects it. Only
      // fires when nothing is already in flight.
      if (this._queued && !this._inFlight) {
        this._runSync(this._queued.kind, this._queued.project).catch(() => {
          /* _runSync sets its own error state; nothing to do here */
        })
      }
    } else {
      // Pause: stop scheduled work and drop the debounce/freshness timers so
      // no build or write fires while disabled. Keep `_queued` intact so a
      // later re-enable can replay the most recent edit.
      if (this._debounceTimer != null) {
        window.clearTimeout(this._debounceTimer)
        this._debounceTimer = null
      }
      this._stopFreshnessTicker()
      this._setState('disabled', 'Live Sync is off')
    }
  }

  /** First-enable convenience: in Electron, auto-detect the mods folder
   *  silently (no picker — the main process knows where Documents/My
   *  Games/Company of Heroes 2/mods lives). In a browser, fall back to
   *  showing the directory picker once — persisted to IDB so the prompt
   *  only ever fires the first time. */
  private async _ensureModsHandleOnEnable(): Promise<void> {
    // Electron mode: no picker needed — _resolveModsHandle() will
    // call detectModsPath() on every sync, so we don't have to do
    // anything here other than confirm the detection works. We still
    // tick the state to "idle" so the badge looks ready.
    if (isElectron()) {
      try {
        const modsPath = await detectModsPath()
        if (modsPath) return
        // detection failed — fall through to the browser picker as a
        // last resort. Unusual: probably means the user's CoH2 install
        // exists but they've never launched the game, so the Documents
        // tree doesn't exist yet. Re-detection on first sync will
        // create the leaf folder.
      } catch {
        /* fall through to browser picker */
      }
    }
    try {
      const existing = await idbGetHandle(IDB_DIR_KEY)
      if (existing) return
      await this.connectInstall()
    } catch {
      // User cancelled the picker, or the API isn't available in this
      // environment. Either way, the user can re-trigger by toggling off
      // and on again, or the first sync attempt will report the missing
      // handle.
    }
  }

  /**
   * Schedule a sync after 1500 ms of inactivity. Re-calling resets the
   * debounce timer so rapid mutations (e.g. dragging a slider) coalesce
   * into a single write. If a sync is already in flight the incoming work
   * is stored as `_queued` and replayed when the flight lands.
   */
  schedule(kind: SyncKind, project: AnyProject) {
    // Q7: while paused, capture the latest project but do NOT build/write
    // or touch state. Storing it lets a subsequent `setEnabled(true)` sync
    // the most recent edit without waiting for another mutation.
    if (!this.isEnabled()) {
      this._queued = { kind, project }
      return
    }

    // Always store the latest work so a late-arriving mutation beats an
    // earlier one that hasn't fired yet.
    this._queued = { kind, project }
    this._setState('queued', 'Changes pending…')

    // Reset the debounce window.
    if (this._debounceTimer != null) {
      window.clearTimeout(this._debounceTimer)
    }

    if (this._inFlight) {
      // A sync is already running — the queued work will be picked up in
      // _runSync's finally block.
      return
    }

    this._debounceTimer = window.setTimeout(() => {
      this._debounceTimer = null
      if (this._queued) {
        void this._runSync(this._queued.kind, this._queued.project)
      }
    }, 1500)
  }

  /** Fire immediately, bypassing the debounce. */
  flush() {
    // Q7: paused Live Sync must never write, even on an explicit flush.
    // `_queued` may hold a captured edit for a later re-enable, so gate on
    // isEnabled() rather than relying on _queued being empty.
    if (!this.isEnabled()) return
    if (this._debounceTimer != null) {
      window.clearTimeout(this._debounceTimer)
      this._debounceTimer = null
    }
    if (this._queued && !this._inFlight) {
      void this._runSync(this._queued.kind, this._queued.project)
    }
  }

  /** Open a directory picker for the CoH2 mods folder (readwrite). */
  async connectInstall(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- showDirectoryPicker not in all lib.dom typings
    const handle: FileSystemDirectoryHandle = await (globalThis as any).showDirectoryPicker({
      id: 'coh2-mods-live-sync',
      mode: 'readwrite',
      startIn: 'documents',
    })
    await idbSetHandle(IDB_DIR_KEY, handle)
    this._setState('idle', 'Install connected — edits will sync automatically')
  }

  // ── Core sync ────────────────────────────────────────────────────────────────

  private async _runSync(kind: SyncKind, project: AnyProject): Promise<void> {
    this._inFlight = true
    this._queued = null
    this._stopFreshnessTicker()
    this._setState('syncing', 'Building and writing mod…')

    try {
      // 1. Resolve mods directory handle
      const modsResult = await this._resolveModsHandle()
      if (!modsResult) {
        this._inFlight = false
        // Distinct from the "Connect" picker on app startup — that one
        // grabs the GAME INSTALL (Steam/…/Company of Heroes 2/) so we
        // can read meshes + textures. Live Sync needs the user's MODS
        // folder under Documents/My Games — a different OS directory
        // the File System Access API can't reach from the install
        // handle. Phrase the prompt so a user who just connected on
        // startup isn't confused by being asked again.
        // NOT an error — the project is already saved locally and can be
        // published to Workshop. Writing into the CoH2 mods folder is an
        // OPTIONAL convenience for in-game testing. Showing a red error
        // cross on the title pill for "haven't picked the optional folder
        // yet" alarmed users who expected a green tick. Keep it 'idle'
        // (green) with an informative tooltip; the folder picker is still
        // reachable from the TopBar "Install to mods folder" action.
        this._setState(
          'idle',
          'Saved locally — connect your CoH2 mods folder for optional in-game live sync',
        )
        return
      }
      const { handle: modsHandle, nativePath: modsNativePath } = modsResult

      // 2. Build the SGA bytes
      const bytes = await this._build(kind, project, modsHandle)

      // 3. Write to disk
      await this._writeFile(modsHandle, modsNativePath, kind, project, bytes)

      // 4. Success
      this._syncedAt = Date.now()
      this._setState('synced', 'Synced just now')
      this._startFreshnessTicker()

      // 5. If the project has a real Workshop ID, schedule an auto-update
      //    of the existing listing. This is fire-and-forget — failures are
      //    isolated from local sync (the badge reports them separately via
      //    workshopSync status, and this catch block is NOT reached).
      const wsId = (project as { workshopId?: string }).workshopId
      if (isRealWorkshopId(wsId)) {
        this._scheduleWorkshopPush(kind, project, bytes.filename, wsId)
      }
    } catch (err: unknown) {
      // KeyPoolAbsentError is kept for back-compat but is no longer thrown
      // by _build() — the unsigned exportSkinPack path runs whenever signing
      // keys are absent, without needing the template SGA. This guard is
      // intentionally left as dead code so any future re-introduction of the
      // throw would still degrade gracefully rather than showing a red error.
      if (err instanceof KeyPoolAbsentError) {
        this._setState(
          'idle',
          'Saved locally — signing template unavailable (run tools/publish-templates.sh)',
        )
        return
      }

      const msg = err instanceof Error ? err.message : String(err)
      const name = err instanceof Error ? (err as { name?: string }).name : undefined

      const isLocked =
        name === 'NotAllowedError' ||
        name === 'InvalidStateError' ||
        msg.toLowerCase().includes('locked') ||
        msg.toLowerCase().includes('busy')

      const isPermission = name === 'SecurityError' || name === 'NotFoundError'

      // "read-only in Electron IPC layer" means createWritable() was called on a
      // native-fs stub handle — should not happen after the _writeFile Electron
      // fix below, but if it ever does, degrade gracefully rather than showing
      // a permanent red cross that confuses users who haven't set up live sync.
      const isElectronReadOnly = msg.includes('read-only in Electron IPC layer')

      // A5: a raw network "Failed to fetch" (TypeError) means a bundled asset
      // the signed-export path needs (keys/template SGA) couldn't be read —
      // typically because the packaged renderer loads from `file://`, where
      // Chromium's fetch refuses the scheme, or the signing template simply
      // isn't bundled in this build. Either way the project IS saved locally;
      // only the OPTIONAL in-game live-sync write is unavailable. Surfacing a
      // red "Sync failed: Failed to fetch" on a metadata rename alarmed users
      // (reported on "click to rename"). Degrade gracefully like a missing key
      // pool: stay green/idle with an informative tooltip.
      const isFetchFailure =
        name === 'TypeError' && msg.toLowerCase().includes('failed to fetch')

      // I2b FIX: empty/new project has no vehicles with decals or a template —
      // collectExportVehicleIds() throws this message. It is NOT a sync error;
      // it means the project has nothing to export yet. Degrade to 'idle' so
      // the user sees "Nothing to sync yet" instead of a red "Sync failed".
      const isEmptyProject =
        msg.includes('no vehicles with decals or a chosen template')

      if (isLocked) {
        this._setState('error', 'Close CoH2 to sync — the mod file is locked by the game')
      } else if (isPermission) {
        this._setState('error', 'Reconnect to your CoH2 install — permission lapsed')
      } else if (isElectronReadOnly) {
        this._setState(
          'idle',
          'Saved locally — connect your CoH2 mods folder for optional in-game live sync',
        )
      } else if (isFetchFailure) {
        this._setState(
          'idle',
          'Saved locally — connect your CoH2 mods folder for optional in-game live sync',
        )
      } else if (isEmptyProject) {
        this._setState(
          'idle',
          'Nothing to sync yet — add a decal or select a template to enable live sync',
        )
      } else {
        this._setState('error', `Sync failed: ${msg}`)
      }
    } finally {
      this._inFlight = false

      // If another mutation arrived while we were syncing, run it now.
      const pending: { kind: SyncKind; project: AnyProject } | null = this._queued
      if (pending !== null && this.isEnabled()) {
        this._queued = null
        const { kind, project } = pending
        this._debounceTimer = window.setTimeout(() => {
          this._debounceTimer = null
          void this._runSync(kind, project)
        }, 100)
      }
    }
  }

  // ── Workshop auto-update ──────────────────────────────────────────────────

  private _setWsState(state: WorkshopSyncState, reason: string) {
    this._wsState = state
    this._wsReason = reason
    this._snapshot = null
    this._notify()
  }

  /**
   * Coalesce Workshop pushes: reset a 12-second idle timer on each call.
   * If a push for this workshopId is already in flight, skip (no queue).
   *
   * The 12 s delay gives the user time to finish a burst of edits before
   * we invoke the Steam IPC call (which has its own rate-limit risks).
   * The local 1.5 s debounce is intentionally much shorter — local FS
   * writes are cheap; Workshop API calls are not.
   */
  private _scheduleWorkshopPush(
    kind: SyncKind,
    project: AnyProject,
    sgaFilename: string,
    workshopId: string,
  ) {
    // If a push for this exact item is already in flight, skip — no queue.
    if (this._wsInFlight && this._wsPushingId === workshopId) return

    // Cancel any pending coalesce timer and restart the 12 s window.
    if (this._wsTimer != null) {
      window.clearTimeout(this._wsTimer)
      this._wsTimer = null
    }

    this._setWsState('pushing', 'Workshop update pending…')

    this._wsTimer = window.setTimeout(() => {
      this._wsTimer = null
      void this._doWorkshopUpdate(kind, project, sgaFilename, workshopId)
    }, 12_000)
  }

  /**
   * Execute the Workshop update IPC call.
   *
   * contentPath: the native mods subdirectory that already contains the
   *   SGA Live Sync just wrote (no re-build needed).
   * previewPath: a temp PNG generated from the project's stored thumbnail
   *   or icon — the smallest available data URL we already have.
   *   Never creates a new Workshop item (uses `.update()` only).
   */
  private async _doWorkshopUpdate(
    kind: SyncKind,
    project: AnyProject,
    sgaFilename: string,
    workshopId: string,
  ) {
    if (!isElectron()) return // Workshop API only available in Electron
    if (this._wsInFlight) return // guard against concurrent calls

    this._wsInFlight = true
    this._wsPushingId = workshopId

    try {
      this._setWsState('pushing', 'Pushing to Workshop…')

      // ── Resolve the native mods root path ───────────────────────────────
      const modsPath = await detectModsPath()
      if (!modsPath) {
        this._setWsState('error', 'Workshop update skipped — mods path not detected')
        return
      }

      // ── Build contentPath: the subdirectory where the SGA lives ──────────
      // Must match the subdirectory logic in _writeFile().
      let contentPath: string
      // For skins: also pass the exact SGA path so the Workshop update picks
      // the correct file even when multiple skin projects share mods/skins/.
      // findSgaInDir() falls back to alphabetical-first, which is wrong when
      // more than one project has written an SGA to the same directory.
      let specificSgaPath: string | undefined
      if (kind === 'skin') {
        contentPath = `${modsPath}/skins`
        // sgaFilename is already the deterministic `<numericId>.sga` computed
        // by deriveNumericIdFromProjectId — always defined for skins.
        if (sgaFilename) specificSgaPath = `${contentPath}/${sgaFilename}`
      } else if (kind === 'decal') {
        contentPath = `${modsPath}/decals/subscriptions`
      } else {
        contentPath = `${modsPath}/faceplates/subscriptions`
      }

      // ── Generate a preview PNG from the project's stored thumbnail ────────
      // The preview is written to a fresh temp file to satisfy the required
      // previewPath argument of the update API.
      const previewPng = await buildWorkshopPreviewFromProject(kind, project)
      const tmpDir = await makeTmpPublishDir()
      const previewPath = `${tmpDir}/preview.png`
      await writeFile(previewPath, previewPng)

      // ── Compose the update input ──────────────────────────────────────────
      const p = project as { packName?: string; packDescription?: string; workshopId?: string; workshopVisibility?: 0 | 1 | 2 | 3 }
      const tagsByKind: Record<SyncKind, string[]> = {
        skin: ['Skin'],
        faceplate: ['Faceplate'],
        decal: ['Decal'],
      }
      // Use the project's persisted visibility so an auto-sync NEVER demotes
      // a Public/FriendsOnly item to Unlisted. Fall back to 3 (Unlisted) only
      // when the project has never been published and has no stored visibility.
      const updateVisibility: 0 | 1 | 2 | 3 = p.workshopVisibility ?? 3
      const input: {
        contentPath: string
        sgaPath?: string
        previewPath: string
        title: string
        description: string
        tags: string[]
        visibility: 0 | 1 | 2 | 3
        changeNote: string
      } = {
        contentPath,
        ...(specificSgaPath ? { sgaPath: specificSgaPath } : {}),
        previewPath,
        title: p.packName ?? 'Untitled',
        description: p.packDescription ?? '',
        tags: tagsByKind[kind],
        // Preserve the user's chosen visibility. Defaults to 3 (Unlisted) only
        // when the project has no stored workshopVisibility (i.e. it was
        // published before this field was added). An UPDATE must not silently
        // flip a Public/FriendsOnly item to Unlisted.
        visibility: updateVisibility,
        changeNote: 'Auto-synced by Live Sync',
      }

      // SAFETY: we only ever call .update(), never .publish().
      // isRealWorkshopId() was already verified by the caller.
      await window.electronAPI!.steam.workshop.update(workshopId, input)

      this._setWsState('synced', 'Workshop synced')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[live-sync] Workshop auto-update failed (non-fatal):', msg)
      this._setWsState('error', `Workshop update failed: ${msg}`)
      // Intentionally NOT re-thrown — local sync already succeeded.
    } finally {
      this._wsInFlight = false
      this._wsPushingId = null
    }
  }

  /**
   * Resolve the CoH2 mods directory handle (and the native FS path when in
   * Electron). Returns `null` when the folder hasn't been connected yet.
   *
   * `nativePath` is non-null only in Electron — callers should use it (via
   * the top-level `writeFile` helper from native-fs) instead of
   * `FileSystemFileHandle.createWritable()`, which is a browser-only API that
   * throws "read-only in Electron IPC layer" on every attempt.
   */
  private async _resolveModsHandle(): Promise<{
    handle: FileSystemDirectoryHandle
    nativePath: string | null
  } | null> {
    // 0. Electron auto-detect (preferred when running as the desktop
    //    app). The main process knows where Steam + Proton lay out
    //    Documents/My Games/Company of Heroes 2/mods — no separate
    //    user gesture needed. This bypasses both IDB lookups below so
    //    the user never sees a second directory picker after the
    //    Connect screen. See electron/main.ts → detectModsPath() for
    //    the search order (Win32 Documents, Proton compatdata,
    //    flatpak Steam, native Linux fallback, mtime-pick when two
    //    parallel Steam roots both have a CoH2 mods leaf).
    if (isElectron()) {
      try {
        const modsPath = await detectModsPath()
        if (modsPath) {
          // Normalise path separators so subdirectory joins are consistent.
          const norm = modsPath.replace(/\\/g, '/')
          return { handle: nativePathToHandle(norm), nativePath: norm }
        }
      } catch {
        // detection failed — fall through to the browser IDB paths.
        // Live Sync in a browser tab can still work via the File
        // System Access API picker route below.
      }
    }

    // 1. Prefer the Live-Sync-specific handle (`IDB_DIR_KEY`) — set when
    //    the user enabled Live Sync and picked a writable mods folder
    //    via the first-enable picker.
    // 2. Fall back to the app-wide `coh2-mods` key — set when the user
    //    picked a mods folder via the TopBar's "Install to mods folder"
    //    flow. Same IDB, different key — sharing the handle so the user
    //    doesn't have to pick the same folder twice.
    //
    // Either source must have a still-granted readwrite permission, or
    // we re-request it (which is allowed inside a user gesture — clicks
    // on the LiveSync badge satisfy that).
    for (const key of [IDB_DIR_KEY, 'coh2-mods']) {
      const handle = await idbGetHandle(key)
      if (!handle) continue

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- queryPermission is File System Access API extra not in all lib.dom typings
      const status = await (handle as any).queryPermission?.({ mode: 'readwrite' })
      if (status === 'granted') return { handle, nativePath: null }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same as above
      const re = await (handle as any).requestPermission?.({ mode: 'readwrite' })
      if (re === 'granted') return { handle, nativePath: null }
    }

    return null
  }

  private async _build(
    kind: SyncKind,
    project: AnyProject,
    _modsHandle: FileSystemDirectoryHandle,
  ): Promise<{ bytes: Uint8Array; filename: string }> {
    if (kind === 'skin') {
      const skinProject = project as Coh2SkinProject
      // Need the install root to read vanilla textures. The mods handle is the
      // write target; the install root must be resolved separately. We try the
      // coh2-fs saved handle first (KEY_INSTALL in idb). If absent — which is
      // the normal case in Electron, where ConnectScreen stores the install
      // handle only in React state, not IDB — fall back to the Electron
      // auto-detect so Live Sync stays seamless without piping React state
      // into this singleton.
      let installHandle: FileSystemDirectoryHandle | null = await idbGetHandle('coh2-install')
      if (!installHandle && isElectron()) {
        try {
          const installPath = await detectInstallPath()
          if (installPath) installHandle = nativePathToHandle(installPath)
        } catch {
          /* detection unavailable — fall through to the throw below */
        }
      }
      if (!installHandle) throw new Error('CoH2 install handle not found — reconnect first')

      // Stable numeric id so live-sync overwrites the SAME `<numericId>.sga`
      // on every save. CoH2's engine scans mods/skins/ for `%I64u.sga` only.
      const stableNumericId = deriveNumericIdFromProjectId(skinProject.id)
      // Prefer patchExport (signed template) when the key pool is present —
      // the signed SGA satisfies CoH2's in-game loader. When the key pool is
      // absent (release builds that don't ship the 377 MB template SGA), fall
      // back to exportSkinPack (unsigned). Unsigned SGAs load fine in CoH2
      // locally ([Sig:0], verified in-game); the signed path is only needed for
      // Workshop publishing.
      const { patchExport, exportSkinPack, hasSigningKeys } = await import('@/lib/mod-export')
      let result: { bytes: Uint8Array; filename: string }
      if (await hasSigningKeys()) {
        try {
          result = await patchExport(
            installHandle,
            skinProject,
            () => {},
            stableNumericId,
          )
        } catch (patchErr: unknown) {
          // patchExport can fail if the template slot sizes no longer match
          // (e.g. RGT format mismatch) or if the template SGA is corrupt.
          // Unsigned SGAs load fine in CoH2 locally ([Sig:0]); only Workshop
          // publishing requires the signed template. Degrade gracefully so
          // live-sync always writes an SGA and reaches 'synced'.
          const patchMsg = patchErr instanceof Error ? patchErr.message : String(patchErr)
          console.warn(`[live-sync] patchExport failed (${patchMsg}); falling back to unsigned exportSkinPack`)
          result = await exportSkinPack(
            installHandle,
            skinProject,
            () => {},
            undefined,
            stableNumericId,
          )
        }
      } else {
        result = await exportSkinPack(
          installHandle,
          skinProject,
          () => {},
          undefined,
          stableNumericId,
        )
      }
      // filename from ExportResult already has the extension; numericId is the raw numeric string
      return { bytes: result.bytes, filename: result.filename }
    } else if (kind === 'decal') {
      const decalProject = project as Coh2DecalPackProject
      const { buildDecalMod, DECAL_ICON_SIZE, DECAL_TEXTURE_SIZE } = await import(
        '@/lib/decal-mod-build'
      )

      // 32-hex GUID is used for BOTH the in-archive asset references AND
      // the on-disk filename. The CoH2 engine's ARC loader happily reads
      // any filename pattern in `mods/decals/subscriptions/` — verified
      // by inspecting the engine's `warnings.log` enumeration during a
      // live launch, which logs:
      //   ARC -- ...\790bfac8...e12.sga 19676 B [ID:...]
      // for our 32-hex-named output exactly the same way it logs the
      // numeric Workshop subscription IDs that sit alongside it. The
      // distinction between "32-hex" and "numeric Workshop ID" filenames
      // is purely cosmetic — Workshop downloads land with numeric names
      // because that's the Workshop ID; locally-built mods can use any
      // basename, and Live Sync uses the deterministic 32-hex GUID so
      // successive saves overwrite-in-place rather than accumulating
      // duplicates.
      const guid = deriveGuidFromId(decalProject.id)

      // Compose the 64×64 inventory-icon canvas by stacking every visible
      // decal's rasterised PNG. Best-effort — in jsdom / no-canvas envs we
      // fall back to an all-transparent buffer so the SGA structure is still
      // valid (the in-game thumbnail is just blank).
      const iconRgba = await renderDecalIcon(decalProject, DECAL_ICON_SIZE)

      // Compose the full 280×280 decal texture for the per-faction RGTs.
      // The engine paints this onto each vehicle's badge UV island at 280×280;
      // passing the 64×64 icon source would produce blank vehicle markings.
      const decalRgba = await renderDecalTexture(decalProject, DECAL_TEXTURE_SIZE)

      // v6: compute per-part per-faction RGBAs for the atlas bake.
      const { partsForBake } = await import('@/lib/atlas-parts')
      const partRgbas = await partsForBake(decalProject)

      const result = await buildDecalMod({ project: decalProject, iconRgba, decalRgba, partRgbas, guid })
      const filename = `${guid}.sga`
      return { bytes: result.sga, filename }
    } else {
      const faceplateProject = project as Coh2FaceplateProject
      const { buildFaceplateMod, generateGuid, ATLAS_WIDTH, ATLAS_HEIGHT } =
        await importFaceplateBuilder()

      // Same single-id strategy as decals — see the decal branch above
      // for the full rationale. tl;dr: the engine's ARC loader accepts
      // any basename in `mods/faceplates/subscriptions/`, so we use the
      // deterministic 32-hex GUID for both internal asset refs AND the
      // on-disk filename.
      //
      // CRITICAL: prefer the project's STABLE `guid` over a hash of the
      // project id. The manual publish path (FaceplateEditor.handleRequestBuild
      // → buildFaceplateMod) bakes `project.guid` into the SGA's attrib pbgid
      // and asset paths. If Live Sync instead derived the GUID from the id, the
      // locally-synced .sga would register a DIFFERENT pbgid than the
      // Workshop-published copy — so the faceplate the user tweaks via Live
      // Sync and the faceplate they publish become two separate in-game
      // identities, and the published one never matches the local file the
      // engine actually loaded. Using `project.guid` aligns both paths to one
      // identity. Fall back to the id-hash only for legacy projects that
      // somehow lack a guid (migrateFaceplateProject backfills one, so this is
      // belt-and-suspenders).
      const guid = faceplateProject.guid ?? deriveGuidFromId(faceplateProject.id)
      // generateGuid is still exported for non-sync code paths that legitimately
      // need a fresh guid (e.g. one-shot SGA exports for a project that has no
      // id yet); reference it here so a future inadvertent removal would still
      // surface a type error rather than a silent runtime regression.
      void generateGuid

      // Render the faceplate canvas — best-effort blank atlas for v1.
      const atlas = await renderFaceplateAtlas(faceplateProject, ATLAS_WIDTH, ATLAS_HEIGHT)

      const result = await buildFaceplateMod({ project: faceplateProject, atlasRgba: atlas, guid })
      const filename = `${guid}.sga`
      return { bytes: result.sga, filename }
    }
  }

  private async _writeFile(
    modsHandle: FileSystemDirectoryHandle,
    modsNativePath: string | null,
    kind: SyncKind,
    _project: AnyProject,
    { bytes, filename }: { bytes: Uint8Array; filename: string },
  ): Promise<void> {
    // Per-item-type subdirectories. CoH2's loader bucketises subscriptions
    // by item kind — it will NOT load a faceplate from mods/extension/ or
    // a decal from mods/faceplates/. Empirically verified against the
    // user's live Workshop-subscription tree at
    // ~/Steam/.../Company of Heroes 2/mods/{faceplates,decals,extension}/subscriptions/
    // where every faceplate sub sits in mods/faceplates/subscriptions/
    // and every decal sub sits in mods/decals/subscriptions/. Writing
    // to mods/extension/subscriptions/ produces an .sga the engine
    // silently ignores — Live Sync goes green but the item never
    // appears in the in-game inventory. This was the root cause of
    // the "georgedroidfaceplate doesn't appear in game" report.
    //
    // For skins: write to <modsRoot>/skins/<id>.sga
    // For faceplates: write to <modsRoot>/faceplates/subscriptions/<id>.sga

    // Electron: `createWritable()` is a browser-only File System Access API
    // not bridged over IPC (it throws "read-only in Electron IPC layer").
    // Use the `writeFile` helper from native-fs instead, which calls
    // window.electronAPI.writeFile() via the preload bridge.
    if (modsNativePath !== null) {
      let subdir: string
      if (kind === 'skin') {
        subdir = `${modsNativePath}/skins`
      } else if (kind === 'decal') {
        subdir = `${modsNativePath}/decals/subscriptions`
      } else {
        subdir = `${modsNativePath}/faceplates/subscriptions`
      }
      await writeFile(`${subdir}/${filename}`, bytes)
      return
    }

    let targetDir = modsHandle

    if (kind === 'skin') {
      try {
        targetDir = await modsHandle.getDirectoryHandle('skins', { create: true })
      } catch {
        /* modsHandle might already be skins/ directly */
      }
    } else if (kind === 'decal') {
      // Decal pack: mods/decals/subscriptions/
      // Empirically verified at
      //   ~/Steam/.../Company of Heroes 2/mods/decals/subscriptions/
      // — every workshop-subscribed decal pack lives under this exact
      // directory (e.g. `mods/decals/subscriptions/859505244.sga` for
      // "Wikinger Decal Remover"). Writing to mods/faceplates/ or
      // mods/extension/ produces an .sga the engine silently ignores
      // for decal lookups.
      try {
        const decalsRoot = await modsHandle.getDirectoryHandle('decals', { create: true })
        targetDir = await decalsRoot.getDirectoryHandle('subscriptions', { create: true })
      } catch {
        /* fall back to modsHandle root */
      }
    } else {
      // Faceplate: mods/faceplates/subscriptions/
      try {
        const ext = await modsHandle.getDirectoryHandle('faceplates', { create: true })
        targetDir = await ext.getDirectoryHandle('subscriptions', { create: true })
      } catch {
        /* fall back to modsHandle root */
      }
    }

    const fh = await targetDir.getFileHandle(filename, { create: true })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- createWritable not in all lib.dom versions
    const w = await (fh as any).createWritable({ keepExistingData: false })
    await w.write(bytes)
    await w.close()
  }

  // ── Freshness ticker ─────────────────────────────────────────────────────────

  private _startFreshnessTicker() {
    this._stopFreshnessTicker()
    this._freshnessTimer = window.setInterval(() => {
      if (this._state === 'synced') {
        this._reason = freshnessLabel(this._syncedAt)
        this._snapshot = null
        this._notify()
      } else {
        this._stopFreshnessTicker()
      }
    }, 30_000)
  }

  private _stopFreshnessTicker() {
    if (this._freshnessTimer != null) {
      window.clearInterval(this._freshnessTimer)
      this._freshnessTimer = null
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Derive a stable 32-hex guid from a project id string so successive syncs of
 * the same faceplate overwrite the same .sga file rather than creating new mods.
 *
 * Strategy:
 *   1. If the id is ALREADY a 32-hex guid (with/without dashes), use it
 *      verbatim. This preserves the prior contract — projects that arrived
 *      with a real guid keep that guid.
 *   2. Otherwise, hash the id with a deterministic 128-bit MurmurHash3-style
 *      mixer and emit the 32 hex chars. This is the path app-generated ids
 *      like `fp_8pgrxhqd4j` take. The hash is pure (no clock, no random),
 *      so successive syncs of the SAME project always overwrite the SAME
 *      `<guid>.sga` rather than littering `mods/faceplates/subscriptions/`
 *      with one file per edit session. Before this fix the call was
 *      `deriveGuidFromId(id) ?? generateGuid()` — the fallback `generateGuid`
 *      is random, which produced the "11 GUID files for 2 projects" bug
 *      reported during user-level QA.
 *
 *   Returns the 32-hex string. Never returns null any more — every id maps
 *   to some guid. (Callers that previously branched on null can drop the
 *   branch.)
 */
export function deriveGuidFromId(id: string): string {
  const cleaned = id.replace(/-/g, '').toLowerCase()
  if (/^[0-9a-f]{32}$/.test(cleaned)) return cleaned

  // 128-bit FNV-1a (split into 4 × 32-bit lanes seeded by lane index so the
  // lanes don't drift in lockstep — a pure 4x parallel FNV-1a degenerates
  // to "same hash repeated 4 times" for short strings, which kills entropy).
  // FNV-1a is overkill for collision avoidance here — the input space is
  // a handful of user-typed project ids — but it's tiny, dependency-free,
  // and deterministic across browser/Node so the tests don't need a polyfill.
  const FNV_PRIME = 0x01000193
  const lanes = [0x811c9dc5, 0x84222325, 0x52f7c195, 0x97a285c8]
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned.charCodeAt(i)
    for (let l = 0; l < 4; l++) {
      lanes[l] = ((lanes[l] ^ (c + l * 31)) * FNV_PRIME) >>> 0
    }
  }
  return lanes.map(n => n.toString(16).padStart(8, '0')).join('')
}

/**
 * Derive a STABLE u64-decimal numeric ID from a project id string for use as
 * the on-disk `<numericId>.sga` filename in `mods/skins/`.
 *
 * Why this exists
 * ───────────────
 * CoH2's engine scans `mods/skins/` for `%I64u.sga` (u64 decimal + .sga) —
 * the decal/faceplate trick of using a 32-hex GUID as the filename does
 * NOT work for skins; the loader silently ignores any non-numeric basename.
 * Pre-fix, `exportSkinPack()` minted a fresh `freshPackId()` on every call,
 * so each live-sync save dropped a brand-new `<random-u64>.sga` into
 * `mods/skins/` instead of overwriting the previous one — within a long
 * editing session this littered the user's mods folder with dozens of
 * stale copies of the same project. Surveyed at v1.0-prep against a real
 * user mods/skins/ → confirmed accumulation.
 *
 * Strategy
 * ────────
 * Hash the project id through a 64-bit FNV-1a, then squeeze the result into
 * `[10^15, 9×10^15)` so it:
 *   • Is a valid u64 decimal (the engine's printf scan matches).
 *   • Has the same ~16-digit shape as `freshPackId()` so the on-disk
 *     filenames are visually consistent with manual exports.
 *   • Sits comfortably above the Workshop ID range (~5×10^9 in late 2025)
 *     so we never collide with a real Workshop-subscribed pack.
 *   • Stays below 2^53 (≈9.007×10^15) so the value round-trips through
 *     JS Number without precision loss — matches the contract in
 *     `freshPackId()`'s JSDoc.
 *
 * The hash is pure (no clock, no random), so successive saves of the SAME
 * project always overwrite the SAME `<numericId>.sga`.
 */
export function deriveNumericIdFromProjectId(id: string): string {
  // 64-bit FNV-1a — same family as deriveGuidFromId above, just operating
  // on a single u64 lane for compactness. BigInt math keeps the values
  // exact through the mod-into-range step.
  let h = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const MASK = 0xffffffffffffffffn
  for (let i = 0; i < id.length; i++) {
    h = ((h ^ BigInt(id.charCodeAt(i))) * prime) & MASK
  }
  // Squeeze into [10^15, 9×10^15) — matches freshPackId() digit-count and
  // stays inside JS-Number-safe range.
  const FLOOR = 10n ** 15n // 1e15
  const SPAN = 8n * FLOOR // 8e15 → result lands in [1e15, 9e15)
  return (FLOOR + (h % SPAN)).toString(10)
}

// ─── Lazy import helpers ──────────────────────────────────────────────────────

async function importFaceplateBuilder() {
  const mod = await import('@/lib/faceplate-mod-build')
  const templates = await import('@/lib/faceplate-templates')
  return { ...mod, ATLAS_WIDTH: templates.ATLAS_WIDTH, ATLAS_HEIGHT: templates.ATLAS_HEIGHT }
}

/**
 * Render the full 692×204 faceplate atlas by compositing the user's banner into
 * BANNER_RECT (0,0,624,204) and a downsampled icon into ICON_RECT (624,0,64,64).
 *
 * The banner composer (`composeFaceplateCanvas`) is exported from
 * `FaceplateEditor.tsx` with a `@public` JSDoc tag so knip leaves it alone.
 * We dynamically import it to keep this module off the FaceplateEditor module
 * graph at chunk boundary time (the skin editor doesn't need the faceplate
 * renderer).
 *
 * In test environments (jsdom returns `null` from `getContext('2d')`) we fall
 * back to a blank atlas — the SGA structure is still valid; the texture is
 * just cosmetically empty (this is what the previous TODO punted on).
 */
async function renderFaceplateAtlas(
  project: Coh2FaceplateProject,
  width: number,
  height: number,
): Promise<Uint8ClampedArray> {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')

    // Composite the banner.
    const fe = await import('@/components/FaceplateEditor')
    const banner = await fe.composeFaceplateCanvas(project)
    // BANNER_RECT = (0, 0, 624, 204) per src/lib/faceplate-templates.ts
    ctx.drawImage(banner, 0, 0, 624, 204)

    // ICON_RECT = (624, 0, 64, 64) — the engine samples this region for the
    // 64² inventory + player-profile thumbnail. Two source candidates:
    //
    //   1. User-supplied `project.inventoryIcon` (v7+). Loaded as an Image
    //      and drawn directly into the icon rect. A purpose-built icon
    //      reads far better as a 64² chip than a downsampled wide banner —
    //      this was the v6 behaviour the user explicitly asked us to
    //      replace via the Live Sync icon picker.
    //   2. Fallback: downsample the composed banner. Cosmetically OK but
    //      almost always blurry because the banner is a 624×204 rectangle
    //      that doesn't crop to a clean square.
    let iconDrawn = false
    if (project.inventoryIcon) {
      try {
        const img = await loadImageFromDataUrl(project.inventoryIcon)
        ctx.drawImage(img, 624, 0, 64, 64)
        iconDrawn = true
      } catch (iconErr) {
        // Bad data URL / decode failure / jsdom — fall back to banner
        // downsample so the export still produces a valid (if blurrier)
        // atlas rather than blowing up the whole sync.
        if (typeof console !== 'undefined') {
          console.warn(
            '[live-sync] inventoryIcon decode failed, falling back to banner downsample:',
            iconErr,
          )
        }
      }
    }
    if (!iconDrawn) {
      ctx.drawImage(banner, 624, 0, 64, 64)
    }

    return ctx.getImageData(0, 0, width, height).data
  } catch (err) {
    // jsdom / unavailable canvas / dynamic-import failure → blank but valid.
    if (typeof console !== 'undefined') {
      console.warn('[live-sync] renderFaceplateAtlas fell back to blank atlas:', err)
    }
    return new Uint8ClampedArray(width * height * 4)
  }
}

/**
 * Render the decal-pack inventory thumbnail by stacking every visible decal's
 * rasterised 280×280 canvas, downsampled into a 64×64 RGBA buffer. The
 * downsample matches the inventory-icon DDS size baked into the GFX template
 * (`DECAL_ICON_SIZE`).
 *
 * In jsdom / no-canvas environments the rasteriser fails silently and we
 * return an all-transparent buffer — the SGA structure stays valid, the
 * in-game thumbnail just renders blank. This mirrors the
 * `renderFaceplateAtlas` fallback semantics.
 */
async function renderDecalIcon(
  project: Coh2DecalPackProject,
  size: number,
): Promise<Uint8ClampedArray> {
  try {
    if (typeof document === 'undefined') {
      throw new Error('no document — decal icon falls back to blank')
    }
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')

    // Lazy-import to keep the decal-pack-export module off the live-sync hot
    // path when the user is only editing faceplates / skins.
    const { rasteriseDecal } = await import('@/lib/decal-pack-export')
    const { DECAL_PACK_SIZE } = await import('@/lib/decal-pack-project')

    // Cache decoded source bitmaps so a project with repeated source-image
    // references doesn't decode the same PNG/JPG twice per sync.
    const bitmapCache = new Map<string, ImageBitmap | HTMLImageElement>()
    // v6: collect all shared layers from all parts. v5: use decals[].
    const visible = project.parts
      ? project.parts.flatMap(part => part.shared.filter(d => d.visible))
      : project.decals.filter(d => d.visible)
    let prevCanvas: OffscreenCanvas | HTMLCanvasElement | null = null

    // Compose each decal into the icon canvas. Each decal renders at the
    // full 128² pack size, then we scale-blit the result down into our 64²
    // icon. The icon is a grid-stacked composite — far from pixel-perfect
    // for many decals, but it gives the user a recognisable thumbnail.
    for (const decal of visible) {
      const src = project.sourceImages[decal.sourceImageId]
      if (!src) continue
      const bitmap = await getOrLoadDecalBitmap(bitmapCache, src.dataUrl, src.id)
      const decalCanvas = rasteriseDecal(decal, bitmap, { prevCanvas })
      prevCanvas = decalCanvas
      // Blit the 128² decal into the icon-sized canvas. drawImage will
      // resample to fit — quality is acceptable for a thumbnail.
      ctx.drawImage(
        decalCanvas as CanvasImageSource,
        0,
        0,
        DECAL_PACK_SIZE,
        DECAL_PACK_SIZE,
        0,
        0,
        size,
        size,
      )
    }

    return ctx.getImageData(0, 0, size, size).data
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.warn('[live-sync] renderDecalIcon fell back to blank icon:', err)
    }
    return new Uint8ClampedArray(size * size * 4)
  }
}

/**
 * Render the visible decal stack into a `size`×`size` RGBA buffer for baking
 * into the per-faction vehicle RGT. Unlike `renderDecalIcon`, which downscales
 * the 280×280 decal canvas to a 64×64 thumbnail, this helper renders at the
 * full DECAL_TEXTURE_SIZE (280×280) so the engine sees a full-resolution badge
 * on the vehicle's UV island.
 *
 * In jsdom / no-canvas environments the rasteriser fails silently and we
 * return an all-transparent buffer — the SGA structure stays valid, the
 * in-game decal marking just renders blank.
 */
async function renderDecalTexture(
  project: Coh2DecalPackProject,
  size: number,
): Promise<Uint8ClampedArray> {
  try {
    if (typeof document === 'undefined') {
      throw new Error('no document — decal texture falls back to blank')
    }
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')

    const { rasteriseDecal } = await import('@/lib/decal-pack-export')
    const { DECAL_PACK_SIZE } = await import('@/lib/decal-pack-project')

    // v6 projects: atlas is composited per-faction inside buildDecalMod via partRgbas.
    // Return a blank buffer here; the caller must pass partRgbas separately.
    if (project.parts) {
      return new Uint8ClampedArray(size * size * 4)
    }
    // v5 legacy path below:
    const bitmapCache = new Map<string, ImageBitmap | HTMLImageElement>()
    const visible = project.decals.filter(d => d.visible)
    let prevCanvas: OffscreenCanvas | HTMLCanvasElement | null = null

    // Composite each decal at the full 280×280 pack size, then blit 1:1
    // into the output canvas (no downscale — this IS the full-res texture).
    for (const decal of visible) {
      const src = project.sourceImages[decal.sourceImageId]
      if (!src) continue
      const bitmap = await getOrLoadDecalBitmap(bitmapCache, src.dataUrl, src.id)
      const decalCanvas = rasteriseDecal(decal, bitmap, { prevCanvas })
      prevCanvas = decalCanvas
      ctx.drawImage(
        decalCanvas as CanvasImageSource,
        0,
        0,
        DECAL_PACK_SIZE,
        DECAL_PACK_SIZE,
        0,
        0,
        size,
        size,
      )
    }

    return ctx.getImageData(0, 0, size, size).data
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.warn('[live-sync] renderDecalTexture fell back to blank texture:', err)
    }
    return new Uint8ClampedArray(size * size * 4)
  }
}

/** Helper for `renderDecalIcon` / `renderDecalTexture` — decode-once caching
 *  for source-image data URLs. Mirrors `getOrLoadBitmap` in
 *  `decal-pack-export.ts` but takes the raw data URL + cache key directly. */
async function getOrLoadDecalBitmap(
  cache: Map<string, ImageBitmap | HTMLImageElement>,
  dataUrl: string,
  cacheKey: string,
): Promise<ImageBitmap | HTMLImageElement> {
  const cached = cache.get(cacheKey)
  if (cached) return cached
  if (typeof createImageBitmap !== 'undefined') {
    const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl)
    if (!m) throw new Error('decal source image is not a base64 data URL')
    const bin = atob(m[2])
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const blob = new Blob([bytes], { type: m[1] })
    const bmp = await createImageBitmap(blob)
    cache.set(cacheKey, bmp)
    return bmp
  }
  const img = await loadImageFromDataUrl(dataUrl)
  cache.set(cacheKey, img)
  return img
}

/**
 * Decode a base64 data URL into an HTMLImageElement. Promisified
 * Image.onload/onerror — keeps the renderFaceplateAtlas pipeline async-flat.
 *
 * Used by the inventoryIcon path. In jsdom the Image constructor exists but
 * onload may not fire reliably; callers must catch and fall back.
 */
function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Image decode failed'))
    img.src = dataUrl
  })
}

// ─── Workshop helpers ─────────────────────────────────────────────────────────

/**
 * Guard: true for a real Steam Workshop ID (same range check as PublishSection.tsx:72
 * and PublishToWorkshopDialog.tsx:84). IDs above 5×10⁹ are fake locally-generated
 * IDs produced by freshPackId() — treat as unpublished.
 */
export function isRealWorkshopId(id: string | undefined | null): id is string {
  if (!id) return false
  const n = Number(id)
  return Number.isFinite(n) && n > 0 && n <= 5_000_000_000
}

/**
 * Build a minimal Workshop preview PNG from whatever image data the project
 * already stores, without touching the editor canvas.
 *
 * Priority:
 *   1. faceplate.inventoryIcon (user-supplied square icon, purpose-built)
 *   2. skin.thumbnail (tiny data URL persisted with the project)
 *   3. decal: render a 128×128 icon from the decal stack (reuses renderDecalIcon)
 *   4. Fallback: 256×256 solid #1e2028 placeholder PNG
 *
 * The result is always ≥256 px and < 1 MB so Steam accepts it. The existing
 * Workshop preview is NOT replaced pixel-for-pixel — it is updated to reflect
 * the current project state.
 */
async function buildWorkshopPreviewFromProject(
  kind: SyncKind,
  project: AnyProject,
): Promise<ArrayBuffer> {
  const PREVIEW_SIZE = 512

  // Helper: convert a data URL (any image type) to a PNG ArrayBuffer at PREVIEW_SIZE×PREVIEW_SIZE.
  async function dataUrlToPng(dataUrl: string): Promise<ArrayBuffer> {
    const img = await loadImageFromDataUrl(dataUrl)
    const canvas = document.createElement('canvas')
    canvas.width = PREVIEW_SIZE
    canvas.height = PREVIEW_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    // Fill background so a transparent PNG has a neutral backdrop.
    ctx.fillStyle = '#1e2028'
    ctx.fillRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE)
    // Center-fit the source image.
    const scale = Math.min(PREVIEW_SIZE / img.naturalWidth, PREVIEW_SIZE / img.naturalHeight)
    const w = Math.round(img.naturalWidth * scale)
    const h = Math.round(img.naturalHeight * scale)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, Math.round((PREVIEW_SIZE - w) / 2), Math.round((PREVIEW_SIZE - h) / 2), w, h)
    return await canvasToArrayBuffer(canvas)
  }

  // Helper: encode canvas to PNG ArrayBuffer.
  async function canvasToArrayBuffer(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('toBlob returned null')); return }
        blob.arrayBuffer().then(resolve, reject)
      }, 'image/png')
    })
  }

  try {
    if (kind === 'faceplate') {
      const fp = project as Coh2FaceplateProject
      if (fp.inventoryIcon) return await dataUrlToPng(fp.inventoryIcon)
      // Fall through — try the atlas banner as a fallback thumbnail below.
    }

    if (kind === 'skin') {
      const sp = project as Coh2SkinProject

      // Priority 1: use a slotIcon (user-supplied 256×256 thumbnail) if any
      // slot has one. Prefer the first summer slot with an icon, then any slot.
      const slotsWithIcon = (sp.exportSlots ?? []).filter(s => s.slotIcon)
      const preferredSlot =
        slotsWithIcon.find(s => s.season === 'summer') ?? slotsWithIcon[0] ?? null
      if (preferredSlot?.slotIcon) {
        return await dataUrlToPng(preferredSlot.slotIcon)
      }

      // Priority 2: composite up to 4 vehicleIcons into a 2×2 grid at
      // PREVIEW_SIZE resolution. Each cell is PREVIEW_SIZE/2 px so the result
      // is PREVIEW_SIZE×PREVIEW_SIZE — far sharper than upscaling a single 64px
      // icon 8× to fill the 512px preview.
      const iconEntries = Object.values(sp.vehicleIcons).filter(Boolean)
      if (iconEntries.length > 0) {
        const canvas = document.createElement('canvas')
        canvas.width = PREVIEW_SIZE
        canvas.height = PREVIEW_SIZE
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.fillStyle = '#1e2028'
          ctx.fillRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE)

          const count = Math.min(iconEntries.length, 4)
          // Layout: 1 icon → centred full-size; 2 → side by side;
          //         3 or 4 → 2×2 grid (empty cells stay dark).
          const cols = count === 1 ? 1 : 2
          const rows = count <= 2 ? 1 : 2
          const cellW = Math.floor(PREVIEW_SIZE / cols)
          const cellH = Math.floor(PREVIEW_SIZE / rows)

          ctx.imageSmoothingEnabled = true
          ctx.imageSmoothingQuality = 'high'

          for (let i = 0; i < count; i++) {
            try {
              const img = await loadImageFromDataUrl(iconEntries[i])
              const col = i % cols
              const row = Math.floor(i / cols)
              const dx = col * cellW
              const dy = row * cellH
              // Center-fit the icon within the cell.
              const scale = Math.min(cellW / img.naturalWidth, cellH / img.naturalHeight)
              const dw = Math.round(img.naturalWidth * scale)
              const dh = Math.round(img.naturalHeight * scale)
              ctx.drawImage(
                img,
                dx + Math.round((cellW - dw) / 2),
                dy + Math.round((cellH - dh) / 2),
                dw,
                dh,
              )
            } catch {
              /* skip icons that fail to decode */
            }
          }
          return await canvasToArrayBuffer(canvas)
        }
      }
    }

    if (kind === 'decal') {
      const dp = project as Coh2DecalPackProject
      const { DECAL_PACK_SIZE } = await import('@/lib/decal-pack-project')
      const iconRgba = await renderDecalIcon(dp, DECAL_PACK_SIZE)
      // Convert the RGBA buffer to a canvas then PNG.
      const canvas = document.createElement('canvas')
      canvas.width = DECAL_PACK_SIZE
      canvas.height = DECAL_PACK_SIZE
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no 2d context')
      const imgData = new ImageData(new Uint8ClampedArray(iconRgba.buffer) as Uint8ClampedArray<ArrayBuffer>, DECAL_PACK_SIZE, DECAL_PACK_SIZE)
      ctx.putImageData(imgData, 0, 0)
      return await canvasToArrayBuffer(canvas)
    }
  } catch (err) {
    console.warn('[live-sync] buildWorkshopPreviewFromProject fell back to placeholder:', err)
  }

  // Final fallback: a 256×256 solid colour PNG.
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#1e2028'
    ctx.fillRect(0, 0, 256, 256)
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) { reject(new Error('toBlob returned null')); return }
      blob.arrayBuffer().then(resolve, reject)
    }, 'image/png')
  })
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _instance: LiveSyncManager | null = null

export function getLiveSyncManager(): LiveSyncManager {
  if (!_instance) _instance = new LiveSyncManager()
  return _instance
}

/** Reset singleton — only for tests. */
export function _resetLiveSyncManagerForTest() {
  _instance = null
}

// ─── React hook ──────────────────────────────────────────────────────────────

import { useSyncExternalStore } from 'react'

// Stable SSR snapshot. Frozen module constant so React's identity check in
// useSyncExternalStore never sees a fresh reference between renders (same
// class of bug as the client-side snapshot — a new literal every call would
// trip `Maximum update depth exceeded` under hydration/strict-mode probes).
const SSR_SNAPSHOT: LiveSyncSnapshot = Object.freeze({
  state: 'disabled' as LiveSyncState,
  reason: 'Live Sync not available',
  enabled: false,
  actions: Object.freeze({
    toggle: () => {},
    syncNow: () => {},
    connectInstall: async () => {},
  }),
}) as LiveSyncSnapshot

export function useLiveSync(): LiveSyncSnapshot {
  const manager = getLiveSyncManager()
  return useSyncExternalStore(
    listener => manager.subscribe(listener),
    () => manager.getSnapshot(),
    () => SSR_SNAPSHOT,
  )
}

/**
 * Schedule a live sync after a mutation. Call this from Editor / FaceplateEditor
 * after persisting the project. The manager debounces rapid calls.
 */
export function scheduleLiveSync(kind: SyncKind, project: AnyProject) {
  getLiveSyncManager().schedule(kind, project)
}
