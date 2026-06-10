#!/usr/bin/env node
/**
 * game-harness.mjs — CoH2 in-game verification harness
 *
 * Installs a built mod SGA into CoH2's mods folder, launches the game via
 * Steam, and reads the engine's pack-load verdict from warnings.log, so a
 * human (or automated pass) can verify that created decals/skins/faceplates
 * actually load in-game.
 *
 * Modelled on the AoE3 DE harness pattern (log-tail verdict) but WITHOUT the
 * C++ gamescope fork — we use the existing steam:// URI launch path and tail
 * warnings.log, same as tools/ingame-load-test.sh.
 *
 * BLOCKERS / prerequisites:
 *   - Steam must be running and you must be logged in.
 *   - CoH2 must be CLOSED before running `install` (the game holds a file
 *     lock on .sga files while open — writes will fail or be ignored).
 *   - Screenshots require `grim` (Wayland) or `spectacle` (KDE).
 *     CAVEAT: `spectacle` may trigger a KWin permission dialog on Bazzite/KDE
 *     — prefer `grim` which is a passive pixel read with no mouse-grab.
 *     Neither tool is available in a headless/CI environment.
 *   - This script does NOT launch the game or take screenshots during
 *     automated testing; only `detect` and `install` (with --dest) run safely
 *     without the user's Steam session.
 *
 * Steam App ID: 231430
 *
 * Subcommands:
 *   detect                               Print modsRoot, warnings.log, install root.
 *   install <pack.sga> [options]         Copy SGA into correct mods subfolder.
 *     --type  skin|decal|faceplate       Default: skin
 *     --id    <numericId or guid>        Default: derived from source filename
 *     --dest  <override-modsRoot>        Override auto-detected modsRoot (for testing)
 *     --force                            Overwrite an existing file (default: refuse)
 *   launch                               Launch CoH2 via steam://rungameid/231430.
 *   verdict [options]                    Tail warnings.log for pack-load verdict.
 *     --timeout <seconds>                Max wait (default 120)
 *     --clear                            Truncate warnings.log before waiting
 *   shot [path]                          Capture a desktop screenshot.
 *   verify <pack.sga> [options]          detect → install → clear → launch → verdict.
 *     (same options as install + verdict)
 */
import { spawn, execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  statSync,
  writeFileSync,
  readFileSync,
  openSync,
  ftruncateSync,
  closeSync,
} from 'node:fs'
import { readdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const STEAM_APP_ID = '231430'
const OUTDIR = '/tmp/coh2-game-harness'
mkdirSync(OUTDIR, { recursive: true })

// ---------------------------------------------------------------------------
// Path detection (ported from electron/detect-coh2.ts to plain Node)
// ---------------------------------------------------------------------------

/** Return every known Linux Steam roots that actually exist on disk. */
function collectLinuxSteamRoots(home) {
  const xdgData = process.env.XDG_DATA_HOME ?? path.join(home, '.local', 'share')
  const flatpakDataRoot = path.join(home, '.var', 'app', 'com.valvesoftware.Steam', 'data', 'Steam')
  const flatpakRuntimeRoot = path.join(
    xdgData,
    'flatpak', 'app', 'com.valvesoftware.Steam',
    'x86_64', 'active', 'files', 'share', 'Steam',
  )
  const all = [
    flatpakDataRoot,
    path.join(home, '.steam', 'steam'),
    path.join(home, '.local', 'share', 'Steam'),
    path.join(home, 'snap', 'steam', 'common', '.local', 'share', 'Steam'),
    // Direct ~/Steam — covers legacy installers and some Bazzite/atomic distro setups
    // where Steam data lives at ~/Steam rather than under ~/.local/share.
    path.join(home, 'Steam'),
    flatpakRuntimeRoot,
  ]
  const seen = new Set()
  const resolved = []
  for (const root of all) {
    if (!existsSync(root)) continue
    let real
    try { real = realpathSync(root) } catch { real = root }
    if (seen.has(real)) continue
    seen.add(real)
    resolved.push(root)
  }
  return resolved
}

/** Parse libraryfolders.vdf to enumerate every Steam library root. */
function readSteamLibraryFolders(steamRoot) {
  const result = [steamRoot]
  const vdfPath = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf')
  let vdf
  try { vdf = readFileSync(vdfPath, 'utf8') } catch { return result }
  const re = /"path"\s+"([^"]+)"/gi
  let m
  while ((m = re.exec(vdf)) !== null) {
    const candidate = m[1].replace(/\\\\/g, '\\')
    if (candidate && candidate !== steamRoot && !result.includes(candidate)) {
      result.push(candidate)
    }
  }
  return result
}

/**
 * Detect CoH2 install root (steamapps/common/Company of Heroes 2).
 * Returns { path, tried[] } — path may be null if not found.
 */
function detectInstallRoot() {
  const tried = []
  const platform = os.platform()
  const home = os.homedir()
  const gameSubpath = path.join('steamapps', 'common', 'Company of Heroes 2')

  if (platform === 'linux') {
    const expandedRoots = []
    for (const root of collectLinuxSteamRoots(home)) {
      for (const lib of readSteamLibraryFolders(root)) {
        if (!expandedRoots.includes(lib)) expandedRoots.push(lib)
      }
    }
    for (const root of expandedRoots) {
      const candidate = path.join(root, gameSubpath)
      tried.push(candidate)
      if (existsSync(candidate)) return { path: candidate, tried }
    }
    // Mount-point fallbacks
    for (const mountBase of ['/run/media', '/var/mnt', '/mnt']) {
      if (!existsSync(mountBase)) continue
      try {
        for (const top of readdirSync(mountBase)) {
          const topDir = path.join(mountBase, top)
          const candidate = path.join(topDir, gameSubpath)
          tried.push(candidate)
          if (existsSync(candidate)) return { path: candidate, tried }
          try {
            for (const inner of readdirSync(topDir)) {
              const c2 = path.join(topDir, inner, gameSubpath)
              tried.push(c2)
              if (existsSync(c2)) return { path: c2, tried }
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
  }
  return { path: null, tried }
}

/**
 * Detect the CoH2 mods root (Documents/My Games/Company of Heroes 2/mods).
 * Uses the mtime-based best-pick heuristic from detect-coh2.ts to handle
 * multiple parallel Proton prefixes correctly.
 * Returns { path, warningsLog, tried[] }.
 */
function detectModsRoot() {
  const tried = []
  const platform = os.platform()
  const home = os.homedir()
  const candidates = []

  if (platform === 'linux') {
    const compatSubpath = path.join('steamapps', 'compatdata', STEAM_APP_ID, 'pfx', 'drive_c', 'users')
    const expandedRoots = []
    for (const root of collectLinuxSteamRoots(home)) {
      for (const lib of readSteamLibraryFolders(root)) {
        if (!expandedRoots.includes(lib)) expandedRoots.push(lib)
      }
    }
    for (const steam of expandedRoots) {
      const usersDir = path.join(steam, compatSubpath)
      tried.push(usersDir + ' (users dir probe)')
      if (!existsSync(usersDir)) continue
      let names
      try { names = readdirSync(usersDir) } catch { continue }
      for (const userName of names) {
        for (const docsName of ['Documents', 'My Documents']) {
          const c = path.join(usersDir, userName, docsName, 'My Games', 'Company of Heroes 2', 'mods')
          candidates.push(c)
          tried.push(c)
        }
      }
    }
    // Mount fallbacks
    for (const mountBase of ['/run/media', '/var/mnt', '/mnt']) {
      if (!existsSync(mountBase)) continue
      try {
        for (const top of readdirSync(mountBase)) {
          const topDir = path.join(mountBase, top)
          const tryRoots = [topDir]
          try { for (const inner of readdirSync(topDir)) tryRoots.push(path.join(topDir, inner)) } catch { /* ok */ }
          for (const steam of tryRoots) {
            const usersDir = path.join(steam, compatSubpath)
            if (!existsSync(usersDir)) continue
            let names
            try { names = readdirSync(usersDir) } catch { continue }
            for (const userName of names) {
              for (const docsName of ['Documents', 'My Documents']) {
                const c = path.join(usersDir, userName, docsName, 'My Games', 'Company of Heroes 2', 'mods')
                candidates.push(c)
                tried.push(c)
              }
            }
          }
        }
      } catch { /* skip */ }
    }
    candidates.push(path.join(home, 'Documents', 'My Games', 'Company of Heroes 2', 'mods'))
    tried.push(path.join(home, 'Documents', 'My Games', 'Company of Heroes 2', 'mods'))
  } else if (platform === 'win32') {
    const profile = process.env.USERPROFILE || home
    candidates.push(path.join(profile, 'Documents', 'My Games', 'Company of Heroes 2', 'mods'))
    const od = process.env.OneDrive || process.env.OneDriveConsumer
    if (od) candidates.push(path.join(od, 'Documents', 'My Games', 'Company of Heroes 2', 'mods'))
    tried.push(...candidates)
  }

  // Prefer the most recently touched candidate (mtime of parent dir).
  const existing = candidates.filter(c => existsSync(c))
  let modsRoot = null
  if (existing.length > 1) {
    let best = null
    for (const c of existing) {
      try {
        const stat = statSync(path.dirname(c))
        if (!best || stat.mtimeMs > best.mtimeMs) best = { path: c, mtimeMs: stat.mtimeMs }
      } catch { /* skip */ }
    }
    if (best) modsRoot = best.path
  } else if (existing.length === 1) {
    modsRoot = existing[0]
  }

  // Derive warnings.log path from modsRoot (same Proton prefix, under Documents)
  let warningsLog = null
  if (modsRoot) {
    // modsRoot: .../drive_c/users/steamuser/Documents/My Games/Company of Heroes 2/mods
    // warnings.log: .../drive_c/users/steamuser/Documents/My Games/Company of Heroes 2/warnings.log
    const coh2Dir = path.dirname(modsRoot)
    const wl = path.join(coh2Dir, 'warnings.log')
    warningsLog = wl  // may not exist yet (game not launched)
  }

  return { path: modsRoot, warningsLog, tried }
}

// ---------------------------------------------------------------------------
// Install-destination logic
// ---------------------------------------------------------------------------

/**
 * Compute the target SGA path inside modsRoot.
 *   skin     → <modsRoot>/skins/<numericId>.sga
 *   decal    → <modsRoot>/decals/subscriptions/<guid>.sga
 *   faceplate→ <modsRoot>/faceplates/subscriptions/<guid>.sga
 *
 * ID rules:
 *   - For skins: the engine scans mods/skins/ for %I64u.sga (unsigned 64-bit
 *     decimal integer filenames) only — so the ID must be a decimal integer.
 *     If no --id given, use source file's basename (strip .sga).
 *   - For decals/faceplates: use --id as the GUID (32-hex), or fall back to
 *     source file's basename (strip .sga).
 */
function installDest(modsRoot, type, id) {
  switch (type) {
    case 'skin':
      return path.join(modsRoot, 'skins', `${id}.sga`)
    case 'decal':
      return path.join(modsRoot, 'decals', 'subscriptions', `${id}.sga`)
    case 'faceplate':
      return path.join(modsRoot, 'faceplates', 'subscriptions', `${id}.sga`)
    default:
      throw new Error(`Unknown asset type: ${type}. Must be skin, decal, or faceplate.`)
  }
}

// ---------------------------------------------------------------------------
// Verdict matching
// ---------------------------------------------------------------------------

// Success: line contains the SGA id AND one of: loaded / registered / success
// Failure: line contains a signature/permission/structure rejection.
// Source: tools/ingame-load-test.sh L113-127 and harness.md §3, PLUS the
// real-world rejection strings observed in warnings.log during an actual run
// (2026-06-09): an unsigned [Sig:0] pack logs "not permitted" and
// "invalid file structure" via "MOD -- Error loading mod pack ...". The
// original regex missed these, so a genuinely-rejected pack would read as
// TIMEOUT instead of FAIL. Now caught.
const SUCCESS_ID_RE = /loaded|registered|success/i
const FAILURE_RE = /not signed|not unsigned|invalid signature|signature.*fail|not permitted|invalid file structure|error loading mod pack/i

function matchVerdictLine(line, id) {
  const lower = line.toLowerCase()
  if (lower.includes(id.toLowerCase())) {
    if (SUCCESS_ID_RE.test(lower)) return 'PASS'
    if (FAILURE_RE.test(lower)) return 'FAIL'
  }
  if (FAILURE_RE.test(lower)) return 'FAIL'
  return null
}

// ---------------------------------------------------------------------------
// Subcommand implementations
// ---------------------------------------------------------------------------

function cmdDetect() {
  const installResult = detectInstallRoot()
  const modsResult = detectModsRoot()

  console.log('=== CoH2 Path Detection ===')
  console.log()
  console.log('Install root:')
  if (installResult.path) {
    console.log('  FOUND  ', installResult.path)
  } else {
    console.log('  NOT FOUND')
  }
  console.log('  Tried:')
  for (const t of installResult.tried) console.log('    -', t)

  console.log()
  console.log('Mods root (modsRoot):')
  if (modsResult.path) {
    console.log('  FOUND  ', modsResult.path)
  } else {
    console.log('  NOT FOUND')
  }
  console.log('  Tried:')
  for (const t of modsResult.tried) console.log('    -', t)

  console.log()
  console.log('Warnings log:')
  if (modsResult.warningsLog) {
    const exists = existsSync(modsResult.warningsLog)
    console.log(` ${exists ? 'EXISTS' : 'not yet written'} `, modsResult.warningsLog)
  } else {
    console.log('  Cannot derive (modsRoot not found)')
  }
}

function cmdInstall(sgaPath, opts) {
  const { type = 'skin', id: idOpt, dest: destOverride, force = false } = opts

  if (!sgaPath) { console.error('Error: missing <pack.sga> argument'); process.exit(1) }
  if (!existsSync(sgaPath)) { console.error(`Error: SGA not found: ${sgaPath}`); process.exit(1) }

  const baseName = path.basename(sgaPath)
  const id = idOpt || baseName.replace(/\.sga$/i, '')

  // Validate skin IDs are numeric (engine only scans %I64u.sga).
  if (type === 'skin' && !/^\d+$/.test(id)) {
    console.error(`Error: skin ID must be a decimal integer (engine scans %I64u.sga). Got: "${id}"`)
    console.error('       Pass --id <numericId> to override.')
    process.exit(1)
  }

  let modsRoot = destOverride
  if (!modsRoot) {
    const detected = detectModsRoot()
    if (!detected.path) {
      console.error('Error: could not auto-detect modsRoot. Use --dest <path> to specify it.')
      process.exit(1)
    }
    modsRoot = detected.path
  }

  const dest = installDest(modsRoot, type, id)
  const destDir = path.dirname(dest)

  console.log('Install summary:')
  console.log('  Source  :', sgaPath)
  console.log('  Type    :', type)
  console.log('  ID      :', id)
  console.log('  Dest    :', dest)
  console.log()

  if (existsSync(dest)) {
    if (!force) {
      console.log('SKIPPED — destination already exists. Use --force to overwrite.')
      console.log('Would install to:', dest)
      process.exit(0)
    }
    console.log('(Overwriting existing file due to --force)')
  }

  mkdirSync(destDir, { recursive: true })
  copyFileSync(sgaPath, dest)

  const srcSize = statSync(sgaPath).size
  const dstSize = statSync(dest).size
  if (srcSize !== dstSize) {
    console.error(`Error: size mismatch after copy! src=${srcSize} dst=${dstSize}`)
    process.exit(1)
  }
  console.log(`Installed ${(dstSize / 1024).toFixed(1)} KB → ${dest}`)
}

function cmdLaunch() {
  const cmd = 'steam'
  const args = [`steam://rungameid/${STEAM_APP_ID}`]
  console.log('Launching CoH2:', cmd, args.join(' '))
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' })
  child.unref()
  console.log('Spawned pid:', child.pid, '(detached — game starts asynchronously via Steam)')
  console.log('Tip: wait at least 30 s for the engine to initialise before running `verdict`.')
}

async function cmdVerdict(opts) {
  const { timeout = 120, clear = false, id: idOpt } = opts

  const modsResult = detectModsRoot()
  if (!modsResult.warningsLog) {
    console.error('Error: could not locate warnings.log (modsRoot not found).')
    process.exit(2)
  }
  const logPath = modsResult.warningsLog
  console.log('Watching:', logPath)
  console.log(`Timeout: ${timeout}s${clear ? ' (clearing log first)' : ''}`)
  console.log('ID filter:', idOpt || '(any)')

  // --clear: truncate the log so stale lines aren't matched.
  if (clear && existsSync(logPath)) {
    const fd = openSync(logPath, 'r+')
    ftruncateSync(fd, 0)
    closeSync(fd)
    console.log('Cleared warnings.log.')
  }

  // Poll-based tail: re-read from a growing offset every 500ms.
  const deadline = Date.now() + timeout * 1000
  let offset = 0
  let result = null

  while (Date.now() < deadline) {
    if (existsSync(logPath)) {
      try {
        const content = readFileSync(logPath, 'utf8')
        const newContent = content.slice(offset)
        if (newContent.length > 0) {
          const lines = newContent.split('\n')
          // The last split may be a partial line — hold it back.
          offset += newContent.length - (newContent.endsWith('\n') ? 0 : lines[lines.length - 1].length)
          const complete = newContent.endsWith('\n') ? lines.slice(0, -1) : lines.slice(0, -1)
          for (const line of complete) {
            if (!line.trim()) continue
            const verdict = idOpt ? matchVerdictLine(line, idOpt) : (FAILURE_RE.test(line) ? 'FAIL' : null)
            if (verdict) {
              console.log('[verdict line]', line)
              result = verdict
              break
            }
          }
        }
      } catch { /* log not readable yet */ }
    }
    if (result) break
    await sleep(500)
  }

  console.log()
  if (result === 'PASS') {
    console.log('VERDICT: PASS — pack loaded successfully.')
    process.exit(0)
  } else if (result === 'FAIL') {
    console.log('VERDICT: FAIL — engine rejected the pack (signature or load error).')
    process.exit(1)
  } else {
    console.log('VERDICT: TIMEOUT — no matching verdict line within', timeout, 's.')
    console.log('Tip: check the log manually:')
    console.log(`  grep -iE "loaded|registered|not signed|invalid signature" "${logPath}" | tail -20`)
    process.exit(2)
  }
}

async function cmdShot(outPath) {
  const dest = outPath || path.join(OUTDIR, `shot-${Date.now()}.png`)

  // Try grim first (Wayland, fully passive — no mouse grab, no permission dialog).
  try {
    execFileSync('grim', [dest], { stdio: 'pipe', timeout: 8000 })
    const size = statSync(dest).size
    console.log(`Screenshot saved (grim): ${dest} (${(size / 1024).toFixed(1)} KB)`)
    return
  } catch { /* grim not available or failed */ }

  // Fall back to spectacle (KDE/KWin).
  // CAVEAT: spectacle may trigger a KWin portal permission dialog on
  // Bazzite/KDE — this is a known blocker. If it prompts, grant it once
  // and it won't ask again. Prefer grim to avoid this.
  try {
    execFileSync('spectacle', ['-b', '-n', '-o', dest], { stdio: 'pipe', timeout: 10000 })
    const size = statSync(dest).size
    console.log(`Screenshot saved (spectacle): ${dest} (${(size / 1024).toFixed(1)} KB)`)
    return
  } catch { /* spectacle not available or failed */ }

  console.error('Error: no screenshot tool available. Install grim (preferred) or spectacle.')
  console.error('       grim is a passive Wayland capture — no permission dialog.')
  console.error('       spectacle may pop a KWin portal permission dialog on first use.')
  process.exit(1)
}

async function cmdVerify(sgaPath, opts) {
  const { type = 'skin', id: idOpt, dest: destOverride, force = false, timeout = 120 } = opts
  const baseName = path.basename(sgaPath || '')
  const id = idOpt || baseName.replace(/\.sga$/i, '')

  console.log('=== verify: detect ===')
  cmdDetect()

  console.log()
  console.log('=== verify: install ===')
  cmdInstall(sgaPath, { type, id, dest: destOverride, force })

  console.log()
  console.log('=== verify: launch ===')
  cmdLaunch()

  console.log()
  console.log('Waiting 30 s for engine to boot before tailing log…')
  await sleep(30000)

  console.log()
  console.log('=== verify: verdict ===')
  await cmdVerdict({ timeout, clear: true, id })
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const USAGE = `
game-harness.mjs — CoH2 in-game verification harness
Steam App ID: ${STEAM_APP_ID}

Usage: node scripts/harness/game-harness.mjs <subcommand> [options]

Subcommands:
  detect
      Locate CoH2 install root, Proton modsRoot, and warnings.log path.
      Probes multiple Steam roots (flatpak, ~/.local/share/Steam, ~/Steam, snap).
      Reports what it tried and what it found (or not).

  install <pack.sga> [--type skin|decal|faceplate] [--id <id>] [--dest <modsRoot>] [--force]
      Copy the SGA into the correct mods subfolder:
        skin     → <modsRoot>/skins/<numericId>.sga
        decal    → <modsRoot>/decals/subscriptions/<guid>.sga
        faceplate→ <modsRoot>/faceplates/subscriptions/<guid>.sga
      NOTE: skin IDs must be decimal integers (%I64u.sga — the engine ignores
      anything else). Decal/faceplate IDs are 32-hex GUIDs.
      --dest overrides auto-detected modsRoot (useful for dry-run / testing).
      Refuses to overwrite an existing file without --force.

  launch
      Fire steam://rungameid/${STEAM_APP_ID} (detached). Does NOT block.
      Steam must be running and logged in.

  verdict [--timeout <seconds>] [--clear] [--id <numericId|guid>]
      Tail warnings.log for up to --timeout seconds (default 120).
      Success substrings (with ID match): "loaded", "registered", "success"
      Failure substrings: "not signed", "not unsigned", "invalid signature",
                          "signature.*fail"
      --clear truncates warnings.log before waiting (avoids stale matches).
      Exit codes: 0=PASS, 1=FAIL, 2=TIMEOUT.

  shot [path]
      Capture a desktop screenshot. Tries grim first (passive Wayland),
      falls back to spectacle (KDE). Neither works headlessly.
      CAVEAT: spectacle may pop a KWin portal permission dialog on Bazzite/KDE
      on first use — prefer grim which has no mouse-grab or permission prompt.

  verify <pack.sga> [--type ...] [--id ...] [--dest ...] [--force] [--timeout ...]
      One-shot: detect → install → launch → (30 s wait) → verdict.
      This is the primary entry point for a full in-game load test.

Blockers (cannot be automated away):
  1. Steam must be running and logged in before launch/verify.
  2. CoH2 must be CLOSED during install (game holds file lock on .sga files).
  3. Screenshots need grim or spectacle — neither is available headlessly.
  4. No headless game rendering — a real display session is required.

Example (full load test):
  echo test > /tmp/dummy.sga
  node scripts/harness/game-harness.mjs install /tmp/dummy.sga \\
    --type skin --id 1779088672641532 --dest /tmp/testmods --force
  # (real run — needs Steam + closed CoH2):
  node scripts/harness/game-harness.mjs verify out/verification/signed/1779088672641532.sga \\
    --type skin --id 1779088672641532 --timeout 180
`.trim()

function parseArgs(argv) {
  const args = argv.slice(2)
  const opts = {}
  const positional = []
  let i = 0
  while (i < args.length) {
    const a = args[i]
    if (a === '--type')    { opts.type    = args[++i] }
    else if (a === '--id')      { opts.id      = args[++i] }
    else if (a === '--dest')    { opts.dest    = args[++i] }
    else if (a === '--timeout') { opts.timeout = Number(args[++i]) }
    else if (a === '--force')   { opts.force   = true }
    else if (a === '--clear')   { opts.clear   = true }
    else if (a === '--help' || a === '-h') { opts.help = true }
    else positional.push(a)
    i++
  }
  return { positional, opts }
}

const { positional, opts } = parseArgs(process.argv)
const [cmd, ...rest] = positional

if (!cmd || opts.help) {
  console.log(USAGE)
  process.exit(0)
}

try {
  switch (cmd) {
    case 'detect':
      cmdDetect()
      break
    case 'install':
      cmdInstall(rest[0], opts)
      break
    case 'launch':
      cmdLaunch()
      break
    case 'verdict':
      await cmdVerdict(opts)
      break
    case 'shot':
      await cmdShot(rest[0])
      break
    case 'verify':
      await cmdVerify(rest[0], opts)
      break
    default:
      console.error(`Unknown subcommand: ${cmd}`)
      console.error('Run with --help for usage.')
      process.exit(1)
  }
  process.exit(0)
} catch (e) {
  console.error('game-harness error:', e.message)
  process.exit(1)
}
