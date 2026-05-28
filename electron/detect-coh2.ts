/**
 * Cross-platform Steam / Company of Heroes 2 path detection.
 *
 * Split out from main.ts so the same logic can be exercised by Vitest
 * without pulling in the Electron runtime (electron module imports fail
 * under Node). Caller wires these into IPC handlers in main.ts.
 *
 * Supported platforms:
 *   - win32   — registry → libraryfolders.vdf → drive-letter fallbacks
 *   - darwin  — Steam Library + Crossover bottles + Whisky bottles
 *   - linux   — Steam (.steam, .local/share/Steam, snap, flatpak) +
 *               libraryfolders.vdf expansion + Deck SD card mounts
 *
 * Tests live in `electron/__tests__/detect-coh2.test.ts` and stub `fs`,
 * `os`, and `child_process` so the platform branches can all be
 * exercised in isolation regardless of where the suite runs.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'

/**
 * Pick the platform-appropriate `path` module up-front. Using
 * `path.win32` / `path.posix` explicitly means the function produces
 * deterministic separators even when `os.platform()` is mocked in tests
 * (where Node's default `path` still follows the test host's OS).
 */
function pickPath(platform: NodeJS.Platform): typeof path {
  return platform === 'win32' ? path.win32 : path.posix
}

// ---------------------------------------------------------------------------
// Registry → Steam root (Windows only)
// ---------------------------------------------------------------------------

/** Read Steam's install path from the Windows registry. Tries both the
 *  32-bit-on-64 (Wow6432Node) and the per-user (HKCU) keys because
 *  Steam writes to whichever fits the install mode. Returns null on
 *  non-Windows or when both keys are absent. */
export function getSteamPathFromRegistry(): string | null {
  if (os.platform() !== 'win32') return null
  try {
    const out = execSync('reg query "HKLM\\SOFTWARE\\Wow6432Node\\Valve\\Steam" /v InstallPath', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const match = out.match(/InstallPath\s+REG_SZ\s+(.+)/)
    if (match) return match[1].trim()
  } catch {
    /* registry key not found */
  }
  try {
    const out = execSync('reg query "HKCU\\SOFTWARE\\Valve\\Steam" /v SteamPath', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const match = out.match(/SteamPath\s+REG_SZ\s+(.+)/)
    if (match) return match[1].trim().replace(/\//g, '\\')
  } catch {
    /* ignore */
  }
  return null
}

// ---------------------------------------------------------------------------
// libraryfolders.vdf parser
// ---------------------------------------------------------------------------

/**
 * Parse `<steamRoot>/steamapps/libraryfolders.vdf` and return every
 * library root Steam knows about. Users who install games to a second
 * drive (very common for CoH2 — the game is 30 GB) have their library
 * pointer here. Without this, the install probe would miss them.
 *
 * The VDF format is Valve's KeyValues — a quoted-key/quoted-value tree.
 * We don't need a real parser; the only field we care about is `path`,
 * which appears once per library entry. A simple regex catches all of
 * them across Steam's various format generations (pre-2021 stored
 * indexes as keys, post-2021 stores library objects with a `path`
 * field).
 *
 * The primary steam root is always included in the returned list, even
 * if it has no libraryfolders.vdf (fresh install). Other roots are
 * appended in the order they appear in the VDF.
 */
export function readSteamLibraryFolders(steamRoot: string): string[] {
  const result = [steamRoot]
  const p = pickPath(os.platform())
  const vdfPath = p.join(steamRoot, 'steamapps', 'libraryfolders.vdf')
  let vdf: string
  try {
    vdf = fs.readFileSync(vdfPath, 'utf8')
  } catch {
    return result
  }
  // Match `"path"\s+"<value>"`. Steam normalises to forward slashes
  // since ~2021 but older installs may write Windows-style \\ — strip
  // those back to single since fs.existsSync accepts either.
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

// ---------------------------------------------------------------------------
// detectCoh2Path
// ---------------------------------------------------------------------------

/** Locate the CoH2 install directory (steamapps/common/Company of
 *  Heroes 2). Returns null when no Steam library has the game. */
export function detectCoh2Path(): string | null {
  const platform = os.platform()
  const p = pickPath(platform)
  const gameSubpath = p.join('steamapps', 'common', 'Company of Heroes 2')

  if (platform === 'win32') {
    // Primary path: registry → libraryfolders.vdf. Catches users who
    // installed CoH2 to a secondary library on D:/E:/external drive.
    const primary = getSteamPathFromRegistry()
    const probeRoots = primary ? readSteamLibraryFolders(primary) : []
    // Backstop: common default install locations Steam might pick when
    // the registry key is corrupt or missing (e.g. portable Steam).
    for (const root of [
      'C:\\Program Files (x86)\\Steam',
      'C:\\Program Files\\Steam',
      'D:\\Steam',
      'D:\\SteamLibrary',
      'E:\\Steam',
      'E:\\SteamLibrary',
      'F:\\Steam',
      'F:\\SteamLibrary',
    ]) {
      if (!probeRoots.includes(root)) probeRoots.push(root)
    }
    for (const root of probeRoots) {
      const candidate = p.join(root, gameSubpath)
      if (fs.existsSync(candidate)) return candidate
    }
  } else if (platform === 'darwin') {
    // macOS. CoH2 is Windows-only natively, so users will be running
    // it under Crossover / Whisky / Wineskin. We probe Steam first
    // (Steam Play / Proton-on-macOS via third-party tooling), then a
    // handful of Crossover/Whisky bottle locations.
    const home = os.homedir()
    const steamRoot = p.join(home, 'Library', 'Application Support', 'Steam')
    if (fs.existsSync(steamRoot)) {
      for (const lib of readSteamLibraryFolders(steamRoot)) {
        const candidate = p.join(lib, gameSubpath)
        if (fs.existsSync(candidate)) return candidate
      }
    }
    // Crossover bottles — default location.
    const crossoverBottles = p.join(home, 'Library', 'Application Support', 'CrossOver', 'Bottles')
    if (fs.existsSync(crossoverBottles)) {
      try {
        for (const bottle of fs.readdirSync(crossoverBottles)) {
          const candidate = p.join(
            crossoverBottles,
            bottle,
            'drive_c',
            'Program Files (x86)',
            'Steam',
            gameSubpath,
          )
          if (fs.existsSync(candidate)) return candidate
        }
      } catch {
        /* unreadable bottle list — fall through to Whisky */
      }
    }
    // Whisky bottles — increasingly popular on Apple Silicon.
    const whiskyBottles = p.join(
      home,
      'Library',
      'Containers',
      'com.isaacmarovitz.Whisky',
      'Bottles',
    )
    if (fs.existsSync(whiskyBottles)) {
      try {
        for (const bottle of fs.readdirSync(whiskyBottles)) {
          const candidate = p.join(
            whiskyBottles,
            bottle,
            'drive_c',
            'Program Files (x86)',
            'Steam',
            gameSubpath,
          )
          if (fs.existsSync(candidate)) return candidate
        }
      } catch {
        /* give up */
      }
    }
  } else {
    // Linux / Steam Deck / atomic distros (Bazzite, SteamOS, Silverblue).
    const home = os.homedir()
    const probeRoots: string[] = []
    for (const root of collectLinuxSteamRoots(home, p)) {
      for (const lib of readSteamLibraryFolders(root)) {
        if (!probeRoots.includes(lib)) probeRoots.push(lib)
      }
    }
    for (const root of probeRoots) {
      const candidate = p.join(root, gameSubpath)
      if (fs.existsSync(candidate)) return candidate
    }
    // Mount-point fallbacks: SteamOS/Steam Deck SD card under /run/media,
    // and Bazzite/atomic distros that mount data drives under /var/mnt.
    for (const mountBase of ['/run/media', '/var/mnt', '/mnt']) {
      try {
        if (!fs.existsSync(mountBase)) continue
        for (const top of fs.readdirSync(mountBase)) {
          const topDir = p.join(mountBase, top)
          // First, try as a direct Steam library root (e.g. /var/mnt/games).
          const directCandidate = p.join(topDir, gameSubpath)
          if (fs.existsSync(directCandidate)) return directCandidate
          // Then enumerate one level deeper (e.g. /run/media/<user>/<sdcard>).
          let mounts: string[]
          try {
            mounts = fs.readdirSync(topDir)
          } catch {
            continue
          }
          for (const mount of mounts) {
            const candidate = p.join(topDir, mount, gameSubpath)
            if (fs.existsSync(candidate)) return candidate
          }
        }
      } catch {
        /* mount base unreadable — skip */
      }
    }
  }
  return null
}

/**
 * Enumerate every Linux Steam install root we know how to find. Used by
 * both `detectCoh2Path` and `detectModsPath` so the supported install
 * styles stay in lockstep. Each path returned is filtered for existence
 * by the caller.
 *
 * Covers:
 *   - **Native** Steam: `~/.steam/steam`, `~/.local/share/Steam` (the
 *     classic dotfile + XDG locations Steam writes itself into).
 *   - **Snap** Steam: `~/snap/steam/common/.local/share/Steam`.
 *   - **Flatpak** Steam — the data root, NOT the runtime root. Bazzite,
 *     Silverblue, Kinoite, and most other Fedora atomic distros ship
 *     Steam as flatpak by default and the runtime install path
 *     (`<xdg-data>/flatpak/app/com.valvesoftware.Steam/x86_64/active/files/share/Steam`)
 *     is a read-only OSTree image with no libraryfolders.vdf and no
 *     compatdata. The actual user-writable Steam data is always at
 *     `~/.var/app/com.valvesoftware.Steam/data/Steam/` regardless of
 *     whether the flatpak was installed `--user` or `--system`. We
 *     include both paths so a future Steam packaging change (data moved
 *     back under the runtime mount) doesn't silently break detection,
 *     but the `.var/app/...` path is what works on shipped Bazzite as of
 *     2025-2026.
 *
 * Order matters only for picking a "primary" root when multiple are
 * present — the data flatpak path comes first so on a Bazzite host
 * with both a flatpak install and a legacy `.steam` symlink dangling
 * from an old native install, we read the live one.
 */
function collectLinuxSteamRoots(home: string, p: typeof path): string[] {
  const flatpakDataRoot = p.join(home, '.var', 'app', 'com.valvesoftware.Steam', 'data', 'Steam')
  const xdgData = process.env.XDG_DATA_HOME ?? p.join(home, '.local', 'share')
  const flatpakRuntimeRoot = p.join(
    xdgData,
    'flatpak',
    'app',
    'com.valvesoftware.Steam',
    'x86_64',
    'active',
    'files',
    'share',
    'Steam',
  )
  const all = [
    flatpakDataRoot,
    p.join(home, '.steam', 'steam'),
    p.join(home, '.local', 'share', 'Steam'),
    p.join(home, 'snap', 'steam', 'common', '.local', 'share', 'Steam'),
    // Legacy / non-XDG default. Some Linux Steam installations (older
    // installers, distros that pre-date XDG-conformance, certain
    // SteamCMD setups, and users who manually relocated their Steam
    // data) put the live Steam tree at `~/Steam/` rather than under
    // `~/.local/share/Steam/`. Without this entry we miss real CoH2
    // installs on those systems, our compatdata probe finds the wrong
    // Proton prefix (or none), and Live Sync writes the mod .sga to a
    // dead compatdata clone that CoH2 doesn't actually read — the
    // dreaded "synced green but the mod never shows in-game" failure
    // mode.
    p.join(home, 'Steam'),
    flatpakRuntimeRoot,
  ]
  // De-duplicate by realpath so a symlinked root (e.g. `~/.steam/steam`
  // → `~/.local/share/Steam`) doesn't appear twice in subsequent
  // compatdata probes. Use realpathSync.native when available; fall back
  // to the raw path if the symlink chain is broken.
  const seen = new Set<string>()
  const resolved: string[] = []
  for (const root of all) {
    if (!fs.existsSync(root)) continue
    let real: string
    try {
      real = fs.realpathSync.native(root)
    } catch {
      real = root
    }
    if (seen.has(real)) continue
    seen.add(real)
    resolved.push(root)
  }
  return resolved
}

// ---------------------------------------------------------------------------
// detectModsPath
// ---------------------------------------------------------------------------

/**
 * Locate the user's CoH2 mods folder — `Documents/My Games/Company of
 * Heroes 2/mods/`. Returns null when we can't find any plausible parent.
 * When the parent (`.../Company of Heroes 2/`) exists but the leaf
 * (`mods/`) doesn't, creates the leaf so the first Live Sync write
 * doesn't fail with ENOENT.
 *
 * The probe order mirrors detectCoh2Path's branches — same Steam roots,
 * same library expansion, same Crossover/Whisky bottle enumeration on
 * macOS.
 */
export function detectModsPath(): string | null {
  const platform = os.platform()
  const p = pickPath(platform)
  const home = os.homedir()
  const candidates: string[] = []

  if (platform === 'win32') {
    const profile = process.env.USERPROFILE || home
    candidates.push(p.join(profile, 'Documents', 'My Games', 'Company of Heroes 2', 'mods'))
    const oneDrive = process.env.OneDrive || process.env.OneDriveConsumer
    if (oneDrive) {
      candidates.push(p.join(oneDrive, 'Documents', 'My Games', 'Company of Heroes 2', 'mods'))
    }
  } else if (platform === 'darwin') {
    const docsSubpath = p.join('My Games', 'Company of Heroes 2', 'mods')
    // Steam Play on macOS (rare but possible via third-party tooling)
    const compatSubpath = p.join('steamapps', 'compatdata', '231430', 'pfx', 'drive_c', 'users')
    const macSteamRoot = p.join(home, 'Library', 'Application Support', 'Steam')
    const macUsersDir = p.join(macSteamRoot, compatSubpath)
    if (fs.existsSync(macUsersDir)) {
      try {
        for (const userName of fs.readdirSync(macUsersDir)) {
          for (const docsName of ['Documents', 'My Documents']) {
            candidates.push(p.join(macUsersDir, userName, docsName, docsSubpath))
          }
        }
      } catch {
        /* unreadable users dir — skip */
      }
    }
    // Crossover bottles
    const crossoverBottles = p.join(home, 'Library', 'Application Support', 'CrossOver', 'Bottles')
    if (fs.existsSync(crossoverBottles)) {
      try {
        for (const bottle of fs.readdirSync(crossoverBottles)) {
          const usersDir = p.join(crossoverBottles, bottle, 'drive_c', 'users')
          if (!fs.existsSync(usersDir)) continue
          let names: string[]
          try {
            names = fs.readdirSync(usersDir)
          } catch {
            continue
          }
          for (const userName of names) {
            for (const docsName of ['Documents', 'My Documents']) {
              candidates.push(p.join(usersDir, userName, docsName, docsSubpath))
            }
          }
        }
      } catch {
        /* fall through to Whisky */
      }
    }
    // Whisky bottles
    const whiskyBottles = p.join(
      home,
      'Library',
      'Containers',
      'com.isaacmarovitz.Whisky',
      'Bottles',
    )
    if (fs.existsSync(whiskyBottles)) {
      try {
        for (const bottle of fs.readdirSync(whiskyBottles)) {
          const usersDir = p.join(whiskyBottles, bottle, 'drive_c', 'users')
          if (!fs.existsSync(usersDir)) continue
          let names: string[]
          try {
            names = fs.readdirSync(usersDir)
          } catch {
            continue
          }
          for (const userName of names) {
            for (const docsName of ['Documents', 'My Documents']) {
              candidates.push(p.join(usersDir, userName, docsName, docsSubpath))
            }
          }
        }
      } catch {
        /* give up */
      }
    }
    // Last resort
    candidates.push(p.join(home, 'Documents', docsSubpath))
  } else {
    // Linux / Steam Deck / Bazzite / Silverblue / SteamOS.
    //
    // CoH2 always runs under Proton (Valve, GE-Proton, Proton-tkg, etc.).
    // Custom Proton flavours like GE-Proton change the compatibility
    // runtime in `compatibilitytools.d/`, but they do NOT change the
    // prefix layout — the mods folder is still at
    // `compatdata/231430/pfx/drive_c/users/steamuser/Documents/My Games/Company of Heroes 2/mods`
    // regardless of which Proton fork the user launched the game with.
    // So all we need to find is the Steam root that owns the 231430
    // compatdata; the rest of the path is fixed.
    const compatSubpath = p.join('steamapps', 'compatdata', '231430', 'pfx', 'drive_c', 'users')
    const expandedRoots: string[] = []
    for (const root of collectLinuxSteamRoots(home, p)) {
      for (const lib of readSteamLibraryFolders(root)) {
        if (!expandedRoots.includes(lib)) expandedRoots.push(lib)
      }
    }
    for (const steam of expandedRoots) {
      const usersDir = p.join(steam, compatSubpath)
      if (!fs.existsSync(usersDir)) continue
      let names: string[]
      try {
        names = fs.readdirSync(usersDir)
      } catch {
        continue
      }
      for (const userName of names) {
        for (const docsName of ['Documents', 'My Documents']) {
          candidates.push(
            p.join(usersDir, userName, docsName, 'My Games', 'Company of Heroes 2', 'mods'),
          )
        }
      }
    }
    // Mount fallbacks for atomic distros and Steam Deck SD cards.
    // Bazzite mounts user drives under /var/mnt; SteamOS uses /run/media;
    // Silverblue/Kinoite users often mount under /mnt. A Steam library on
    // a secondary drive normally registers in the primary
    // libraryfolders.vdf (handled above), but if Steam was reset or the
    // user added the library outside of Steam, this catches it.
    for (const mountBase of ['/run/media', '/var/mnt', '/mnt']) {
      try {
        if (!fs.existsSync(mountBase)) continue
        for (const top of fs.readdirSync(mountBase)) {
          const topDir = p.join(mountBase, top)
          const tryRoots: string[] = [topDir]
          try {
            for (const inner of fs.readdirSync(topDir)) {
              tryRoots.push(p.join(topDir, inner))
            }
          } catch {
            /* topDir not a dir or unreadable — fine, we still try it as a root */
          }
          for (const steam of tryRoots) {
            const usersDir = p.join(steam, compatSubpath)
            if (!fs.existsSync(usersDir)) continue
            let names: string[]
            try {
              names = fs.readdirSync(usersDir)
            } catch {
              continue
            }
            for (const userName of names) {
              for (const docsName of ['Documents', 'My Documents']) {
                candidates.push(
                  p.join(usersDir, userName, docsName, 'My Games', 'Company of Heroes 2', 'mods'),
                )
              }
            }
          }
        }
      } catch {
        /* mount base unreadable — skip */
      }
    }
    // Last-resort: a true native install on the host filesystem.
    candidates.push(p.join(home, 'Documents', 'My Games', 'Company of Heroes 2', 'mods'))
  }

  // When MULTIPLE candidates exist (the user has two parallel Steam
  // installs: e.g. `~/.local/share/Steam/...` AND `~/Steam/...`, each
  // with its own Proton prefix for 231430), naively picking the first
  // one in our probe order is the wrong call — only ONE of them is the
  // copy CoH2 actually reads from at launch, and Live Sync writing to
  // the other one looks "successful" but the mod never appears in game.
  // This is the most-reported failure mode on Bazzite / Silverblue /
  // mixed-install Linux systems.
  //
  // Heuristic: among existing candidates, prefer the one whose PARENT
  // (Documents/My Games/Company of Heroes 2/) has the most recent
  // mtime. CoH2 rewrites `local.ini`, `live.dat`, and `flipchart.log`
  // on every launch, so the parent's mtime tracks the last time the
  // game was actually started against that Proton prefix. Falls back
  // to "first existing candidate" when no parent has a usable stat.
  const existing = candidates.filter(c => fs.existsSync(c))
  if (existing.length > 1) {
    const pp = pickPath(platform)
    let best: { path: string; mtimeMs: number } | null = null
    for (const candidate of existing) {
      try {
        const stat = fs.statSync(pp.dirname(candidate))
        if (!best || stat.mtimeMs > best.mtimeMs) {
          best = { path: candidate, mtimeMs: stat.mtimeMs }
        }
      } catch {
        /* skip unreadable parent */
      }
    }
    if (best) return best.path
  }
  if (existing.length === 1) return existing[0]

  // No existing leaf — find the first candidate whose parent
  // (`.../Company of Heroes 2/`) already exists and create the
  // `mods/` leaf there, so the first sync doesn't fail with ENOENT.
  for (const candidate of candidates) {
    const parent = pickPath(platform).dirname(candidate)
    if (fs.existsSync(parent)) {
      try {
        fs.mkdirSync(candidate, { recursive: true })
        return candidate
      } catch {
        /* ignore — fall through to next candidate */
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// detectWorkshopPath
// ---------------------------------------------------------------------------

/**
 * Locate the user's CoH2 Steam Workshop content folder —
 * `<steam-library>/steamapps/workshop/content/231430/`. Returns null when
 * the user has no workshop subscriptions OR no Steam library that has
 * subscribed to any 231430 (CoH2) workshop item.
 *
 * Steam stores workshop content under `steamapps/workshop/content/<appid>/`
 * in the SAME library root that ran the most recent download. This is
 * usually (but not always) the library where the game is installed —
 * users with a small SSD for the game and a large HDD for workshop
 * subscriptions can split them. We enumerate every known library root
 * for the platform and return the FIRST one that has a populated
 * `content/231430/` directory.
 *
 * The directory contains one subfolder per subscribed workshop item,
 * named with the item's numeric Workshop ID (e.g. `1234567890/`). Each
 * folder typically contains a single `.sga` archive plus metadata.
 *
 * Used by the new-project Template Picker so users can seed a fresh
 * project from any of their existing workshop subscriptions.
 */
export function detectWorkshopPath(): string | null {
  const platform = os.platform()
  const p = pickPath(platform)
  const workshopSubpath = p.join('steamapps', 'workshop', 'content', '231430')

  const probeRoots: string[] = []

  if (platform === 'win32') {
    const primary = getSteamPathFromRegistry()
    if (primary) {
      for (const lib of readSteamLibraryFolders(primary)) {
        if (!probeRoots.includes(lib)) probeRoots.push(lib)
      }
    }
    for (const root of [
      'C:\\Program Files (x86)\\Steam',
      'C:\\Program Files\\Steam',
      'D:\\Steam',
      'D:\\SteamLibrary',
      'E:\\Steam',
      'E:\\SteamLibrary',
      'F:\\Steam',
      'F:\\SteamLibrary',
    ]) {
      if (!probeRoots.includes(root)) probeRoots.push(root)
    }
  } else if (platform === 'darwin') {
    const home = os.homedir()
    const macSteamRoot = p.join(home, 'Library', 'Application Support', 'Steam')
    if (fs.existsSync(macSteamRoot)) {
      for (const lib of readSteamLibraryFolders(macSteamRoot)) {
        if (!probeRoots.includes(lib)) probeRoots.push(lib)
      }
    }
  } else {
    // Linux — flatpak, snap, native, atomic distros. Also enumerate
    // mount fallbacks so a user with workshop content on a /var/mnt
    // secondary drive still gets discovered.
    const home = os.homedir()
    for (const root of collectLinuxSteamRoots(home, p)) {
      for (const lib of readSteamLibraryFolders(root)) {
        if (!probeRoots.includes(lib)) probeRoots.push(lib)
      }
    }
    for (const mountBase of ['/run/media', '/var/mnt', '/mnt']) {
      try {
        if (!fs.existsSync(mountBase)) continue
        for (const top of fs.readdirSync(mountBase)) {
          const topDir = p.join(mountBase, top)
          if (!probeRoots.includes(topDir)) probeRoots.push(topDir)
          try {
            for (const inner of fs.readdirSync(topDir)) {
              const innerDir = p.join(topDir, inner)
              if (!probeRoots.includes(innerDir)) probeRoots.push(innerDir)
            }
          } catch {
            /* topDir not a dir — skip */
          }
        }
      } catch {
        /* mount base unreadable — skip */
      }
    }
  }

  for (const root of probeRoots) {
    const candidate = p.join(root, workshopSubpath)
    if (!fs.existsSync(candidate)) continue
    // Confirm there's at least one subscribed item — Steam can leave
    // an empty content/231430/ folder behind after the user unsubscribes
    // from everything, and we don't want to surface "0 items" as a
    // successful detection. (The renderer can still list this folder
    // and get an empty array; we just prefer a populated one.)
    try {
      const entries = fs.readdirSync(candidate)
      if (entries.length > 0) return candidate
    } catch {
      continue
    }
  }
  // Fallback: return the first existing path even if empty, so the
  // renderer can show "no workshop items yet" rather than "couldn't
  // find Steam workshop folder at all".
  for (const root of probeRoots) {
    const candidate = p.join(root, workshopSubpath)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

// ---------------------------------------------------------------------------
// listWorkshopItems
// ---------------------------------------------------------------------------

export interface WorkshopItem {
  /** Numeric Workshop ID (folder name under content/231430/). */
  id: string
  /** Absolute path to the workshop item's directory. */
  dir: string
  /** Absolute path to the .sga archive inside the item dir, or null when
   *  no .sga is present (rare — Steam usually downloads at least one). */
  sgaPath: string | null
}

/**
 * Enumerate every subscribed CoH2 workshop item under the given workshop
 * root. The renderer uses this to populate the Template Picker's
 * "Workshop" section.
 *
 * Implementation notes
 * ────────────────────
 * - We do NOT parse the .sga to extract names or thumbnails here; that
 *   would block the IPC thread on large archives. The renderer calls a
 *   separate IPC (read-file-range) to slurp just the SGA header when it
 *   needs richer metadata.
 * - When a workshop item folder contains multiple .sga files (extremely
 *   rare — only happens if the mod author shipped supplementary archives),
 *   we pick the FIRST one alphabetically so the result is deterministic.
 * - Hidden / dotted folders are skipped so Steam's own bookkeeping dirs
 *   (.locked, .acf, etc.) don't show up as fake "workshop items".
 */
export function listWorkshopItems(workshopRoot: string): WorkshopItem[] {
  const platform = os.platform()
  const p = pickPath(platform)
  let entries: string[]
  try {
    entries = fs.readdirSync(workshopRoot)
  } catch {
    return []
  }
  const items: WorkshopItem[] = []
  for (const id of entries) {
    if (id.startsWith('.')) continue
    // Workshop IDs are always numeric; skip anything else so symlink
    // shenanigans don't slip non-workshop content into the picker.
    if (!/^\d+$/.test(id)) continue
    const dir = p.join(workshopRoot, id)
    let inner: string[]
    try {
      inner = fs.readdirSync(dir)
    } catch {
      continue
    }
    const sgas = inner.filter(n => n.toLowerCase().endsWith('.sga')).sort()
    const sgaPath = sgas.length > 0 ? p.join(dir, sgas[0]) : null
    items.push({ id, dir, sgaPath })
  }
  // Sort newest-first by ID (workshop IDs increase monotonically — newer
  // subscriptions have larger IDs, so this matches "most recent first"
  // without an extra stat() call per item).
  items.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
  return items
}

export interface StockArchive {
  /** Filename without extension — used as the template option `name`. */
  id: string
  /** Absolute path to the .sga archive. */
  path: string
  /** Approximate size in bytes (from fs.statSync) for the hint line. */
  size: number
}

/**
 * Enumerate the stock CoH2 archives the game ships with — `Art*.sga`,
 * `Attrib*.sga`, `Data*.sga`, plus any other `.sga` directly under
 * `<install>/CoH2/Archives/`. The Template Picker exposes these as seed
 * templates for new projects so users can fork from official content
 * (Relic skins, faction art, etc.) without re-importing anything.
 *
 * - `installRoot` is the result of `detectInstallPath()` — the folder
 *   that directly contains `CoH2.exe`. Pass null to short-circuit.
 * - Returns [] when the Archives folder is missing or empty.
 * - Sorted alphabetically by id for stable rendering.
 */
export function listStockArchives(installRoot: string): StockArchive[] {
  const platform = os.platform()
  const p = pickPath(platform)
  const archivesDir = p.join(installRoot, 'CoH2', 'Archives')
  let entries: string[]
  try {
    entries = fs.readdirSync(archivesDir)
  } catch {
    return []
  }
  const out: StockArchive[] = []
  for (const name of entries) {
    if (!name.toLowerCase().endsWith('.sga')) continue
    const full = p.join(archivesDir, name)
    const fileSize = (() => {
      try {
        return fs.statSync(full).size
      } catch {
        return null
      }
    })()
    if (fileSize === null) continue
    const id = name.slice(0, -4)
    out.push({ id, path: full, size: fileSize })
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return out
}
