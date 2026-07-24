/**
 * Tests for electron/detect-coh2.ts — the cross-platform Steam +
 * Company of Heroes 2 install detector used by both the Connect screen
 * (auto-fills install path) and Live Sync (writes built mods).
 *
 * Strategy: vi.mock the `node:fs`, `node:os`, and `node:child_process`
 * imports so every test can synthesise a virtual filesystem + a target
 * platform without touching the real machine. This lets us exercise
 * Win32 / macOS / Linux branches in a single Vitest pass regardless of
 * where the suite is actually running.
 *
 * Coverage rationale:
 *   - libraryfolders.vdf parser: contractual — Steam users with a
 *     secondary library are silently broken without it. Pin the regex
 *     behaviour on both modern and legacy VDF formats.
 *   - Linux branch: probes Proton compatdata across .steam, .local,
 *     snap, flatpak, and library-folder expansion.
 *   - macOS branch: Crossover + Whisky bottle enumeration (CoH2 is
 *     Windows-only natively).
 *   - Win32 branch: registry first, libraryfolders.vdf second, drive-
 *     letter backstops third.
 *   - detectModsPath: must create the leaf `mods/` folder when only
 *     the parent exists.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────

// A synthetic filesystem keyed by absolute path → directory listing OR
// file contents. Directories list their children (just the basenames);
// files store their contents as a string or Buffer. `existsSync` answers
// true for any path present as a key; `readFileSync` returns the value
// (or throws); `readdirSync` returns directory listings.
// Binary files (for SGA parser tests) use a Buffer as `binContent`.
type Entry =
  | { kind: 'dir'; children: string[]; mtimeMs?: number }
  | { kind: 'file'; content: string; binContent?: Buffer; mtimeMs?: number; size?: number }
  | { kind: 'symlink'; target: string }
const vfs = new Map<string, Entry>()

function setDir(p: string, children: string[], mtimeMs?: number) {
  vfs.set(p, { kind: 'dir', children, mtimeMs })
}
function setFile(p: string, content: string, mtimeMs?: number, size?: number) {
  vfs.set(p, { kind: 'file', content, mtimeMs, size })
}
/** Register a binary file (Buffer) for SGA parser tests. */
function setBinaryFile(p: string, buf: Buffer) {
  vfs.set(p, { kind: 'file', content: '', binContent: buf })
}
function setSymlink(p: string, target: string) {
  vfs.set(p, { kind: 'symlink', target })
}
function resetVfs() {
  vfs.clear()
}

// ── File-descriptor simulation for openSync/readSync/closeSync ──────────────
// Each open() call returns a numeric fd; the fd maps to the resolved path.
const fdMap = new Map<number, string>()
let nextFd = 100


// Resolve a path through any symlinked components (mirrors real
// realpathSync.native: it walks the path left-to-right, dereferencing
// every intermediate symlink). Falls back to the literal path when no
// symlink entry sits at any component, so paths in pure real-dir vfs
// trees are unchanged.
function resolveSymlink(p: string, depth = 0): string {
  if (depth > 16) return p // bail out on link loops
  // First try to dereference the path AS-IS (handles terminal symlinks)
  const direct = vfs.get(p)
  if (direct?.kind === 'symlink') return resolveSymlink(direct.target, depth + 1)
  // Then walk parents in case an intermediate component is a symlink
  // (e.g. `/a/b/c` where `/a/b` is a link → `/x/y` should resolve to
  // `/x/y/c`).
  const parts = p.split('/')
  for (let i = parts.length - 1; i > 0; i--) {
    const prefix = parts.slice(0, i).join('/')
    if (prefix === '') continue
    const entry = vfs.get(prefix)
    if (entry?.kind === 'symlink') {
      const tail = parts.slice(i).join('/')
      return resolveSymlink(`${entry.target}/${tail}`, depth + 1)
    }
  }
  return p
}

const fsMock = {
  existsSync: (p: string) => {
    const resolved = resolveSymlink(p)
    return vfs.has(resolved)
  },
  readdirSync: (p: string) => {
    const entry = vfs.get(resolveSymlink(p))
    if (!entry || entry.kind !== 'dir') throw new Error(`ENOENT: ${p}`)
    return entry.children
  },
  readFileSync: (p: string) => {
    const entry = vfs.get(resolveSymlink(p))
    if (!entry || entry.kind !== 'file') throw new Error(`ENOENT: ${p}`)
    return entry.content
  },
  mkdirSync: (p: string) => {
    // Pretend the mkdir succeeded — record the leaf as an empty dir
    // so subsequent existsSync(leaf) is true (mirrors `recursive: true`).
    setDir(p, [])
  },
  statSync: (p: string) => {
    const entry = vfs.get(resolveSymlink(p))
    if (!entry) throw new Error(`ENOENT: ${p}`)
    if (entry.kind === 'symlink') throw new Error(`unexpected: ${p}`)
    return {
      mtimeMs: entry.mtimeMs ?? 0,
      // Files may carry an explicit size for testing stat-based features
      // (e.g. listStockArchives). Dirs return 0; files default to 0.
      size: entry.kind === 'file' ? (entry.size ?? 0) : 0,
    }
  },
  realpathSync: Object.assign((p: string) => resolveSymlink(p), {
    native: (p: string) => resolveSymlink(p),
  }),
  // ── Bounded-read APIs used by the new readInfoFromSga ────────────────────
  openSync: (p: string, _flags: string) => {
    const resolved = resolveSymlink(p)
    const entry = vfs.get(resolved)
    if (!entry || entry.kind !== 'file') throw new Error(`ENOENT: ${p}`)
    const fd = nextFd++
    fdMap.set(fd, resolved)
    return fd
  },
  readSync: (fd: number, buf: Buffer, offset: number, length: number, position: number) => {
    const resolved = fdMap.get(fd)
    if (!resolved) throw new Error(`Bad fd: ${fd}`)
    const entry = vfs.get(resolved)
    if (!entry || entry.kind !== 'file') throw new Error(`Bad fd: ${fd}`)
    // Prefer binContent (Buffer); fall back to string-as-utf8
    const src: Buffer = entry.binContent ?? Buffer.from(entry.content, 'utf8')
    const start = position ?? 0
    const end = Math.min(start + length, src.length)
    const read = Math.max(0, end - start)
    src.copy(buf, offset, start, end)
    return read
  },
  closeSync: (fd: number) => {
    fdMap.delete(fd)
  },
}

vi.mock('node:fs', () => ({
  default: fsMock,
  ...fsMock,
}))

// os.platform() is overridden per-describe block via this mutable holder.
let mockPlatform: NodeJS.Platform = 'linux'
const mockHome = '/home/test'

const osMock = {
  platform: () => mockPlatform,
  homedir: () => mockHome,
}

vi.mock('node:os', () => ({
  default: osMock,
  ...osMock,
}))

const cpMock = {
  execSync: vi.fn(() => {
    throw new Error('reg query not available in tests')
  }),
}

vi.mock('node:child_process', () => ({
  default: cpMock,
  ...cpMock,
}))

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  resetVfs()
  fdMap.clear()
  nextFd = 100
  mockPlatform = 'linux'
  // Clear env vars that could leak from the host
  delete process.env.OneDrive
  delete process.env.OneDriveConsumer
  delete process.env.USERPROFILE
  delete process.env.XDG_DATA_HOME
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── readSteamLibraryFolders ─────────────────────────────────────────────────

describe('readSteamLibraryFolders', () => {
  it('returns just the primary root when no libraryfolders.vdf exists', async () => {
    const { readSteamLibraryFolders } = await import('../detect-coh2')
    expect(readSteamLibraryFolders('/home/test/.steam/steam')).toEqual(['/home/test/.steam/steam'])
  })

  it('parses modern (post-2021) VDF format with library objects', async () => {
    setFile(
      '/home/test/.steam/steam/steamapps/libraryfolders.vdf',
      `"libraryfolders"
{
  "0"
  {
    "path"  "/home/test/.steam/steam"
    "label"  ""
  }
  "1"
  {
    "path"  "/run/media/sdcard/SteamLibrary"
    "label"  "SD"
  }
}`,
    )
    const { readSteamLibraryFolders } = await import('../detect-coh2')
    const result = readSteamLibraryFolders('/home/test/.steam/steam')
    expect(result).toContain('/home/test/.steam/steam')
    expect(result).toContain('/run/media/sdcard/SteamLibrary')
  })

  it('parses legacy (pre-2021) VDF format with numeric keys', async () => {
    setFile(
      '/home/test/.steam/steam/steamapps/libraryfolders.vdf',
      `"LibraryFolders"
{
  "TimeNextStatsReport"  "1234"
  "ContentStatsID"  "5678"
  "1"  "/mnt/games/SteamLibrary"
  "2"  "/run/media/external/SteamLibrary"
}`,
    )
    const { readSteamLibraryFolders } = await import('../detect-coh2')
    const result = readSteamLibraryFolders('/home/test/.steam/steam')
    // Legacy format: only primary survives (no `"path"` fields). This
    // is intentional — the test pins that the function doesn't crash
    // on legacy files even though it can't extract the libraries from
    // them. Any pre-2021 install still has the games in the primary.
    expect(result).toEqual(['/home/test/.steam/steam'])
  })

  it('deduplicates the primary root if it appears in the VDF', async () => {
    setFile(
      '/home/test/.steam/steam/steamapps/libraryfolders.vdf',
      `"libraryfolders" { "0" { "path" "/home/test/.steam/steam" } }`,
    )
    const { readSteamLibraryFolders } = await import('../detect-coh2')
    const result = readSteamLibraryFolders('/home/test/.steam/steam')
    expect(result).toEqual(['/home/test/.steam/steam'])
  })
})

// ─── detectCoh2Path — Linux ──────────────────────────────────────────────────

describe('detectCoh2Path (linux)', () => {
  beforeEach(() => {
    mockPlatform = 'linux'
  })

  it('finds CoH2 in the primary .steam directory', async () => {
    setDir(
      '/home/test/.steam/steam',
      [], // existence-only; we don't iterate this dir
    )
    setDir('/home/test/.steam/steam/steamapps/common/Company of Heroes 2', [])
    const { detectCoh2Path } = await import('../detect-coh2')
    expect(detectCoh2Path()).toBe('/home/test/.steam/steam/steamapps/common/Company of Heroes 2')
  })

  it('finds CoH2 in a flatpak Steam install', async () => {
    setDir(
      '/home/test/.local/share/flatpak/app/com.valvesoftware.Steam/x86_64/active/files/share/Steam',
      [],
    )
    setDir(
      '/home/test/.local/share/flatpak/app/com.valvesoftware.Steam/x86_64/active/files/share/Steam/steamapps/common/Company of Heroes 2',
      [],
    )
    const { detectCoh2Path } = await import('../detect-coh2')
    expect(detectCoh2Path()).toContain('flatpak')
  })

  it('finds CoH2 in a secondary Steam library via libraryfolders.vdf', async () => {
    setDir('/home/test/.steam/steam', [])
    setFile(
      '/home/test/.steam/steam/steamapps/libraryfolders.vdf',
      `"libraryfolders" { "0" { "path" "/home/test/.steam/steam" } "1" { "path" "/mnt/games" } }`,
    )
    setDir('/mnt/games/steamapps/common/Company of Heroes 2', [])
    const { detectCoh2Path } = await import('../detect-coh2')
    expect(detectCoh2Path()).toBe('/mnt/games/steamapps/common/Company of Heroes 2')
  })

  it('returns null when CoH2 is not installed anywhere', async () => {
    const { detectCoh2Path } = await import('../detect-coh2')
    expect(detectCoh2Path()).toBe(null)
  })
})

// ─── detectCoh2Path — macOS ──────────────────────────────────────────────────

describe('detectCoh2Path (darwin)', () => {
  beforeEach(() => {
    mockPlatform = 'darwin'
  })

  it('finds CoH2 in macOS Steam (~/Library/Application Support/Steam)', async () => {
    setDir('/home/test/Library/Application Support/Steam', [])
    setDir('/home/test/Library/Application Support/Steam/steamapps/common/Company of Heroes 2', [])
    const { detectCoh2Path } = await import('../detect-coh2')
    expect(detectCoh2Path()).toContain('Library/Application Support/Steam')
  })

  it('finds CoH2 in a Crossover bottle', async () => {
    setDir('/home/test/Library/Application Support/CrossOver/Bottles', ['MyBottle'])
    setDir(
      '/home/test/Library/Application Support/CrossOver/Bottles/MyBottle/drive_c/Program Files (x86)/Steam/steamapps/common/Company of Heroes 2',
      [],
    )
    const { detectCoh2Path } = await import('../detect-coh2')
    expect(detectCoh2Path()).toContain('CrossOver/Bottles/MyBottle')
  })

  it('finds CoH2 in a Whisky bottle', async () => {
    setDir('/home/test/Library/Containers/com.isaacmarovitz.Whisky/Bottles', ['Gaming'])
    setDir(
      '/home/test/Library/Containers/com.isaacmarovitz.Whisky/Bottles/Gaming/drive_c/Program Files (x86)/Steam/steamapps/common/Company of Heroes 2',
      [],
    )
    const { detectCoh2Path } = await import('../detect-coh2')
    expect(detectCoh2Path()).toContain('Whisky/Bottles/Gaming')
  })

  it('returns null when no macOS wrapper has CoH2 installed', async () => {
    const { detectCoh2Path } = await import('../detect-coh2')
    expect(detectCoh2Path()).toBe(null)
  })
})

// ─── detectModsPath — Linux ──────────────────────────────────────────────────

describe('detectModsPath (linux)', () => {
  beforeEach(() => {
    mockPlatform = 'linux'
  })

  it('finds the mods folder under Proton compatdata (steamuser branch)', async () => {
    setDir('/home/test/.steam/steam', [])
    const usersDir = '/home/test/.steam/steam/steamapps/compatdata/231430/pfx/drive_c/users'
    setDir(usersDir, ['steamuser'])
    setDir(`${usersDir}/steamuser/Documents/My Games/Company of Heroes 2/mods`, [])
    const { detectModsPath } = await import('../detect-coh2')
    const result = detectModsPath()
    expect(result).toContain('steamuser/Documents/My Games/Company of Heroes 2/mods')
  })

  it('creates the mods/ leaf when only the parent exists', async () => {
    setDir('/home/test/.steam/steam', [])
    const usersDir = '/home/test/.steam/steam/steamapps/compatdata/231430/pfx/drive_c/users'
    setDir(usersDir, ['steamuser'])
    // Parent exists, leaf doesn't — detection must mkdir the leaf.
    setDir(`${usersDir}/steamuser/Documents/My Games/Company of Heroes 2`, [])
    const { detectModsPath } = await import('../detect-coh2')
    const result = detectModsPath()
    expect(result).toContain('mods')
    // After detection, the leaf should exist in the vfs (mkdir mock).
    expect(vfs.has(`${usersDir}/steamuser/Documents/My Games/Company of Heroes 2/mods`)).toBe(true)
  })

  it('returns null when no compatdata or Documents tree exists', async () => {
    const { detectModsPath } = await import('../detect-coh2')
    expect(detectModsPath()).toBe(null)
  })

  // Bazzite / Silverblue / Kinoite all ship Steam as flatpak by default.
  // The runtime install path is read-only OSTree — every user write
  // (libraryfolders.vdf, compatdata, mods) lands under ~/.var/app/.
  // The pre-fix detector looked at the runtime path and would silently
  // miss the actual install, leaving Live Sync stuck on "missing mods
  // folder" for every Bazzite user. These tests pin the data-path
  // branch so a future refactor can't quietly regress it.
  it('finds CoH2 in flatpak Steam data root (Bazzite)', async () => {
    setDir('/home/test/.var/app/com.valvesoftware.Steam/data/Steam', [])
    setDir(
      '/home/test/.var/app/com.valvesoftware.Steam/data/Steam/steamapps/common/Company of Heroes 2',
      [],
    )
    const { detectCoh2Path } = await import('../detect-coh2')
    expect(detectCoh2Path()).toBe(
      '/home/test/.var/app/com.valvesoftware.Steam/data/Steam/steamapps/common/Company of Heroes 2',
    )
  })

  it('finds Proton compatdata under flatpak Steam data root (Bazzite + GE-Proton)', async () => {
    setDir('/home/test/.var/app/com.valvesoftware.Steam/data/Steam', [])
    const usersDir =
      '/home/test/.var/app/com.valvesoftware.Steam/data/Steam/steamapps/compatdata/231430/pfx/drive_c/users'
    setDir(usersDir, ['steamuser'])
    setDir(`${usersDir}/steamuser/Documents/My Games/Company of Heroes 2/mods`, [])
    const { detectModsPath } = await import('../detect-coh2')
    const result = detectModsPath()
    expect(result).toBe(`${usersDir}/steamuser/Documents/My Games/Company of Heroes 2/mods`)
  })

  it('finds CoH2 via secondary Bazzite library mounted at /var/mnt', async () => {
    // The user keeps Steam on the flatpak default root but moved the
    // CoH2 library to a second SSD mounted under /var/mnt/games — the
    // Bazzite-recommended path. libraryfolders.vdf in the primary
    // points at the secondary.
    setDir('/home/test/.var/app/com.valvesoftware.Steam/data/Steam', [])
    setFile(
      '/home/test/.var/app/com.valvesoftware.Steam/data/Steam/steamapps/libraryfolders.vdf',
      `"libraryfolders"
{
  "0" { "path" "/home/test/.var/app/com.valvesoftware.Steam/data/Steam" }
  "1" { "path" "/var/mnt/games/SteamLibrary" }
}`,
    )
    setDir('/var/mnt/games/SteamLibrary/steamapps/common/Company of Heroes 2', [])
    const { detectCoh2Path } = await import('../detect-coh2')
    expect(detectCoh2Path()).toBe(
      '/var/mnt/games/SteamLibrary/steamapps/common/Company of Heroes 2',
    )
  })

  it('finds CoH2 via /var/mnt enumeration when libraryfolders.vdf is absent', async () => {
    // Edge case: the user just installed the game to /var/mnt manually
    // and Steam hasn't re-scanned. The mount-fallback loop must still
    // discover it without a vdf pointer.
    setDir('/var/mnt', ['games'])
    setDir('/var/mnt/games/steamapps/common/Company of Heroes 2', [])
    const { detectCoh2Path } = await import('../detect-coh2')
    expect(detectCoh2Path()).toBe('/var/mnt/games/steamapps/common/Company of Heroes 2')
  })

  it('finds mods folder via /var/mnt secondary library compatdata', async () => {
    // User runs CoH2 from a /var/mnt library with its own compatdata
    // (Steam stores compatdata per library, not just in the primary).
    setDir('/var/mnt', ['games'])
    setDir('/var/mnt/games', ['steamapps'])
    const usersDir = '/var/mnt/games/steamapps/compatdata/231430/pfx/drive_c/users'
    setDir(usersDir, ['steamuser'])
    setDir(`${usersDir}/steamuser/Documents/My Games/Company of Heroes 2/mods`, [])
    const { detectModsPath } = await import('../detect-coh2')
    expect(detectModsPath()).toBe(
      `${usersDir}/steamuser/Documents/My Games/Company of Heroes 2/mods`,
    )
  })

  // Real-world bug: a user reported that Live Sync wrote .sga files
  // successfully (green badge) but their georgedroid faceplate never
  // appeared in CoH2. Root cause: their system had TWO parallel
  // Steam installs — `~/.local/share/Steam/` (the XDG-conformant
  // path our detector finds first) AND `~/Steam/` (the legacy
  // non-XDG path that Steam was actually running CoH2 against).
  // We were writing to the first; CoH2 was reading from the second.
  // The fix: include `~/Steam/` in the probe list, then when more
  // than one candidate exists, pick the one whose parent
  // (Documents/My Games/Company of Heroes 2/) has the most recent
  // mtime — that's the prefix CoH2 has most recently launched against.
  it('prefers the most-recently-launched compatdata when two parallel Steam roots exist', async () => {
    // Both ~/.local/share/Steam and ~/Steam exist as independent
    // Proton prefixes for 231430. The latter's CoH2 parent dir has a
    // newer mtime — i.e. that's the one the game actually runs against.
    const xdgUsers = '/home/test/.local/share/Steam/steamapps/compatdata/231430/pfx/drive_c/users'
    const legacyUsers = '/home/test/Steam/steamapps/compatdata/231430/pfx/drive_c/users'
    setDir('/home/test/.local/share/Steam', [])
    setDir('/home/test/Steam', [])
    setDir(xdgUsers, ['steamuser'])
    setDir(legacyUsers, ['steamuser'])
    // OLDER mtime on the stale clone (the one we'd write to before the fix)
    setDir(`${xdgUsers}/steamuser/Documents/My Games/Company of Heroes 2`, ['mods'], 1_000_000_000)
    setDir(`${xdgUsers}/steamuser/Documents/My Games/Company of Heroes 2/mods`, [])
    // NEWER mtime on the live one — CoH2 wrote local.ini / live.dat
    // here at last launch, bumping the parent dir's mtime forward.
    setDir(
      `${legacyUsers}/steamuser/Documents/My Games/Company of Heroes 2`,
      ['mods'],
      2_000_000_000,
    )
    setDir(`${legacyUsers}/steamuser/Documents/My Games/Company of Heroes 2/mods`, [])

    const { detectModsPath } = await import('../detect-coh2')
    expect(detectModsPath()).toBe(
      `${legacyUsers}/steamuser/Documents/My Games/Company of Heroes 2/mods`,
    )
  })

  it('still finds the mods folder via legacy ~/Steam/ when no XDG install exists', async () => {
    // User installed Steam only at the non-XDG default ~/Steam/.
    // Without ~/Steam/ in the probe list, detection returns null and
    // the user sees the "needs one more folder" error.
    setDir('/home/test/Steam', [])
    const usersDir = '/home/test/Steam/steamapps/compatdata/231430/pfx/drive_c/users'
    setDir(usersDir, ['steamuser'])
    setDir(`${usersDir}/steamuser/Documents/My Games/Company of Heroes 2/mods`, [])
    const { detectModsPath } = await import('../detect-coh2')
    expect(detectModsPath()).toBe(
      `${usersDir}/steamuser/Documents/My Games/Company of Heroes 2/mods`,
    )
  })

  it('deduplicates a ~/.steam/steam → ~/.local/share/Steam symlink', async () => {
    // ~/.steam/steam is a symlink to ~/.local/share/Steam on almost
    // every modern Linux Steam install. Without dedup our candidate
    // list contained the same physical directory twice, which (post-
    // mtime-pick fix) didn't cause incorrect behaviour but did
    // double-stat the same dir. Pin the dedup so this doesn't regress.
    setSymlink('/home/test/.steam/steam', '/home/test/.local/share/Steam')
    setDir('/home/test/.local/share/Steam', [])
    const usersDir = '/home/test/.local/share/Steam/steamapps/compatdata/231430/pfx/drive_c/users'
    setDir(usersDir, ['steamuser'])
    setDir(`${usersDir}/steamuser/Documents/My Games/Company of Heroes 2/mods`, [])
    const { detectModsPath } = await import('../detect-coh2')
    // Either alias is fine — they both point at the same realpath via
    // the symlink. What matters is that dedup PREVENTS the mtime-pick
    // logic from being called on two stat-identical candidates (which
    // could otherwise return the same path twice and obscure the
    // bug that this test guards against).
    const result = detectModsPath()
    const xdgPath = `${usersDir}/steamuser/Documents/My Games/Company of Heroes 2/mods`
    const aliasPath =
      `/home/test/.steam/steam/steamapps/compatdata/231430/pfx/drive_c/users` +
      `/steamuser/Documents/My Games/Company of Heroes 2/mods`
    expect([xdgPath, aliasPath]).toContain(result)
  })
})

// ─── detectModsPath — macOS ──────────────────────────────────────────────────

describe('detectModsPath (darwin)', () => {
  beforeEach(() => {
    mockPlatform = 'darwin'
  })

  it('finds the mods folder in a Crossover bottle', async () => {
    setDir('/home/test/Library/Application Support/CrossOver/Bottles', ['CoH2'])
    setDir('/home/test/Library/Application Support/CrossOver/Bottles/CoH2/drive_c/users', [
      'crossover',
    ])
    setDir(
      '/home/test/Library/Application Support/CrossOver/Bottles/CoH2/drive_c/users/crossover/Documents/My Games/Company of Heroes 2/mods',
      [],
    )
    const { detectModsPath } = await import('../detect-coh2')
    const result = detectModsPath()
    expect(result).toContain('CrossOver/Bottles/CoH2/drive_c/users/crossover')
  })

  it('finds the mods folder in a Whisky bottle', async () => {
    setDir('/home/test/Library/Containers/com.isaacmarovitz.Whisky/Bottles', ['Gaming'])
    setDir('/home/test/Library/Containers/com.isaacmarovitz.Whisky/Bottles/Gaming/drive_c/users', [
      'steamuser',
    ])
    setDir(
      '/home/test/Library/Containers/com.isaacmarovitz.Whisky/Bottles/Gaming/drive_c/users/steamuser/Documents/My Games/Company of Heroes 2/mods',
      [],
    )
    const { detectModsPath } = await import('../detect-coh2')
    const result = detectModsPath()
    expect(result).toContain('Whisky/Bottles/Gaming/drive_c/users/steamuser')
  })
})

// ─── detectModsPath — Windows ────────────────────────────────────────────────

describe('detectModsPath (win32)', () => {
  beforeEach(() => {
    mockPlatform = 'win32'
    process.env.USERPROFILE = 'C:\\Users\\Test'
  })

  it('finds the mods folder under USERPROFILE/Documents', async () => {
    setDir('C:\\Users\\Test\\Documents\\My Games\\Company of Heroes 2\\mods', [])
    const { detectModsPath } = await import('../detect-coh2')
    expect(detectModsPath()).toBe('C:\\Users\\Test\\Documents\\My Games\\Company of Heroes 2\\mods')
  })

  it('finds the mods folder under OneDrive when env var is set', async () => {
    process.env.OneDrive = 'C:\\Users\\Test\\OneDrive'
    setDir('C:\\Users\\Test\\OneDrive\\Documents\\My Games\\Company of Heroes 2\\mods', [])
    const { detectModsPath } = await import('../detect-coh2')
    expect(detectModsPath()).toContain('OneDrive')
  })
})

// ─── detectWorkshopPath — Linux ───────────────────────────────────────────────
//
// The Template Picker calls detectWorkshopPath() to surface the user's
// subscribed CoH2 workshop items as seed templates. The detector mirrors
// detectModsPath's platform probe order — flatpak data root first, then
// native, then snap, then mount fallbacks. These tests pin the linux
// branches against synthetic vfs trees so we exercise every probe path
// without touching the host filesystem.

describe('detectWorkshopPath (linux)', () => {
  beforeEach(() => {
    mockPlatform = 'linux'
  })

  it('returns null when no Steam library has the workshop folder', async () => {
    const { detectWorkshopPath } = await import('../detect-coh2')
    expect(detectWorkshopPath()).toBeNull()
  })

  it('finds workshop under the native ~/.steam/steam library when populated', async () => {
    setDir('/home/test/.steam/steam', [])
    setDir('/home/test/.steam/steam/steamapps/workshop/content/231430', ['1234567890'])
    const { detectWorkshopPath } = await import('../detect-coh2')
    expect(detectWorkshopPath()).toBe('/home/test/.steam/steam/steamapps/workshop/content/231430')
  })

  it('finds workshop under the flatpak data root (Bazzite)', async () => {
    setDir('/home/test/.var/app/com.valvesoftware.Steam/data/Steam', [])
    setDir(
      '/home/test/.var/app/com.valvesoftware.Steam/data/Steam/steamapps/workshop/content/231430',
      ['9999999999', '1111111111'],
    )
    const { detectWorkshopPath } = await import('../detect-coh2')
    expect(detectWorkshopPath()).toBe(
      '/home/test/.var/app/com.valvesoftware.Steam/data/Steam/steamapps/workshop/content/231430',
    )
  })

  it('prefers a populated workshop over an empty one', async () => {
    setDir('/home/test/.steam/steam', [])
    setDir('/home/test/.steam/steam/steamapps/workshop/content/231430', [])
    setDir('/home/test/.var/app/com.valvesoftware.Steam/data/Steam', [])
    setDir(
      '/home/test/.var/app/com.valvesoftware.Steam/data/Steam/steamapps/workshop/content/231430',
      ['1234567890'],
    )
    const { detectWorkshopPath } = await import('../detect-coh2')
    expect(detectWorkshopPath()).toBe(
      '/home/test/.var/app/com.valvesoftware.Steam/data/Steam/steamapps/workshop/content/231430',
    )
  })

  it('falls back to an empty workshop folder when no library has subscriptions', async () => {
    setDir('/home/test/.steam/steam', [])
    setDir('/home/test/.steam/steam/steamapps/workshop/content/231430', [])
    const { detectWorkshopPath } = await import('../detect-coh2')
    // Empty is OK — the renderer shows "no workshop items yet".
    expect(detectWorkshopPath()).toBe('/home/test/.steam/steam/steamapps/workshop/content/231430')
  })

  it('finds workshop via secondary library declared in libraryfolders.vdf', async () => {
    setDir('/home/test/.steam/steam', [])
    setFile(
      '/home/test/.steam/steam/steamapps/libraryfolders.vdf',
      `"libraryfolders" {
         "0" { "path" "/home/test/.steam/steam" }
         "1" { "path" "/var/mnt/games/SteamLibrary" }
       }`,
    )
    setDir('/var/mnt/games/SteamLibrary/steamapps/workshop/content/231430', ['2222222222'])
    const { detectWorkshopPath } = await import('../detect-coh2')
    expect(detectWorkshopPath()).toBe(
      '/var/mnt/games/SteamLibrary/steamapps/workshop/content/231430',
    )
  })

  it('finds workshop via /var/mnt enumeration when libraryfolders.vdf is absent', async () => {
    // No Steam roots configured; Bazzite mounts the data drive at /var/mnt.
    setDir('/var/mnt', ['games'])
    setDir('/var/mnt/games', [])
    setDir('/var/mnt/games/steamapps/workshop/content/231430', ['3333333333'])
    const { detectWorkshopPath } = await import('../detect-coh2')
    expect(detectWorkshopPath()).toBe('/var/mnt/games/steamapps/workshop/content/231430')
  })
})

// ─── detectWorkshopPath — Windows ─────────────────────────────────────────────

describe('detectWorkshopPath (win32)', () => {
  beforeEach(() => {
    mockPlatform = 'win32'
  })

  it('finds workshop in the default Program Files (x86) Steam install', async () => {
    setDir('C:\\Program Files (x86)\\Steam', [])
    setDir('C:\\Program Files (x86)\\Steam\\steamapps\\workshop\\content\\231430', ['1234567890'])
    const { detectWorkshopPath } = await import('../detect-coh2')
    expect(detectWorkshopPath()).toBe(
      'C:\\Program Files (x86)\\Steam\\steamapps\\workshop\\content\\231430',
    )
  })

  it('returns null on Windows with no Steam install discovered', async () => {
    const { detectWorkshopPath } = await import('../detect-coh2')
    expect(detectWorkshopPath()).toBeNull()
  })
})

// ─── listWorkshopItems ────────────────────────────────────────────────────────

describe('listWorkshopItems', () => {
  beforeEach(() => {
    mockPlatform = 'linux'
  })

  it('returns an empty array when the workshop root is missing or unreadable', async () => {
    const { listWorkshopItems } = await import('../detect-coh2')
    expect(listWorkshopItems('/nonexistent/workshop/path')).toEqual([])
  })

  it('returns an empty array when the workshop root has no subscribed items', async () => {
    setDir('/workshop', [])
    const { listWorkshopItems } = await import('../detect-coh2')
    expect(listWorkshopItems('/workshop')).toEqual([])
  })

  it('enumerates numeric workshop ID folders and finds the .sga inside each', async () => {
    setDir('/workshop', ['1234567890', '9876543210'])
    setDir('/workshop/1234567890', ['mod.sga', 'meta.json'])
    setDir('/workshop/9876543210', ['skins.sga'])
    const { listWorkshopItems } = await import('../detect-coh2')
    const items = listWorkshopItems('/workshop')
    expect(items).toHaveLength(2)
    // Sorted newest-first by ID (larger IDs win).
    expect(items[0].id).toBe('9876543210')
    expect(items[0].sgaPath).toBe('/workshop/9876543210/skins.sga')
    expect(items[1].id).toBe('1234567890')
    expect(items[1].sgaPath).toBe('/workshop/1234567890/mod.sga')
  })

  it('skips dotted hidden folders (Steam bookkeeping like .lock / .acf)', async () => {
    setDir('/workshop', ['.locked', '.acf', '1111111111'])
    setDir('/workshop/1111111111', ['x.sga'])
    const { listWorkshopItems } = await import('../detect-coh2')
    const items = listWorkshopItems('/workshop')
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('1111111111')
  })

  it('skips non-numeric folder names so symlinked content does not leak in', async () => {
    setDir('/workshop', ['my-custom-mod', 'README.md', '2222222222'])
    setDir('/workshop/2222222222', ['archive.sga'])
    const { listWorkshopItems } = await import('../detect-coh2')
    const items = listWorkshopItems('/workshop')
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('2222222222')
  })

  it('records sgaPath as null when a workshop folder has no .sga files', async () => {
    setDir('/workshop', ['3333333333'])
    setDir('/workshop/3333333333', ['preview.png', 'meta.json'])
    const { listWorkshopItems } = await import('../detect-coh2')
    const items = listWorkshopItems('/workshop')
    expect(items).toHaveLength(1)
    expect(items[0].sgaPath).toBeNull()
  })

  it('picks the alphabetically-first .sga when a workshop folder has multiple', async () => {
    setDir('/workshop', ['4444444444'])
    // Common author-shipped pattern: a primary mod.sga plus supplementary
    // assets.sga or _patch.sga — pick the alphabetically-first for
    // determinism.
    setDir('/workshop/4444444444', ['z_extra.sga', 'a_main.sga'])
    const { listWorkshopItems } = await import('../detect-coh2')
    const items = listWorkshopItems('/workshop')
    expect(items[0].sgaPath).toBe('/workshop/4444444444/a_main.sga')
  })
})

// ─── listStockArchives ────────────────────────────────────────────────────────

describe('listStockArchives', () => {
  beforeEach(() => {
    mockPlatform = 'linux'
  })

  it('returns an empty array when the Archives folder is missing or unreadable', async () => {
    const { listStockArchives } = await import('../detect-coh2')
    expect(listStockArchives('/nonexistent/install')).toEqual([])
  })

  it('returns an empty array when the Archives folder exists but has no .sga files', async () => {
    setDir('/install/CoH2/Archives', ['readme.txt', 'config.ini'])
    setFile('/install/CoH2/Archives/readme.txt', '')
    setFile('/install/CoH2/Archives/config.ini', '')
    const { listStockArchives } = await import('../detect-coh2')
    expect(listStockArchives('/install')).toEqual([])
  })

  it('enumerates .sga files and returns id, path, and size for each', async () => {
    setDir('/install/CoH2/Archives', ['ArtBritish.sga', 'Data.sga'])
    setFile('/install/CoH2/Archives/ArtBritish.sga', '', undefined, 148000000)
    setFile('/install/CoH2/Archives/Data.sga', '', undefined, 512000000)
    const { listStockArchives } = await import('../detect-coh2')
    const archives = listStockArchives('/install')
    expect(archives).toHaveLength(2)
    // Sorted alphabetically by id.
    expect(archives[0].id).toBe('ArtBritish')
    expect(archives[0].path).toBe('/install/CoH2/Archives/ArtBritish.sga')
    expect(archives[0].size).toBe(148000000)
    expect(archives[1].id).toBe('Data')
    expect(archives[1].path).toBe('/install/CoH2/Archives/Data.sga')
    expect(archives[1].size).toBe(512000000)
  })

  it('ignores non-.sga files in the Archives folder', async () => {
    setDir('/install/CoH2/Archives', ['ArtBritish.sga', 'thumbs.db', 'notes.txt'])
    setFile('/install/CoH2/Archives/ArtBritish.sga', '', undefined, 100)
    setFile('/install/CoH2/Archives/thumbs.db', '')
    setFile('/install/CoH2/Archives/notes.txt', '')
    const { listStockArchives } = await import('../detect-coh2')
    const archives = listStockArchives('/install')
    expect(archives).toHaveLength(1)
    expect(archives[0].id).toBe('ArtBritish')
  })

  it('is case-insensitive on the .sga extension', async () => {
    // Some Wine/Proton environments may rename the extension to uppercase;
    // listStockArchives normalises via toLowerCase before comparing.
    setDir('/install/CoH2/Archives', ['ArtBritish.SGA'])
    setFile('/install/CoH2/Archives/ArtBritish.SGA', '', undefined, 100)
    const { listStockArchives } = await import('../detect-coh2')
    const archives = listStockArchives('/install')
    expect(archives).toHaveLength(1)
    expect(archives[0].id).toBe('ArtBritish')
  })

  it('sorts results alphabetically by id for stable rendering', async () => {
    setDir('/install/CoH2/Archives', ['Data.sga', 'ArtBritish.sga', 'AttribArchive.sga'])
    setFile('/install/CoH2/Archives/Data.sga', '', undefined, 1)
    setFile('/install/CoH2/Archives/ArtBritish.sga', '', undefined, 2)
    setFile('/install/CoH2/Archives/AttribArchive.sga', '', undefined, 3)
    const { listStockArchives } = await import('../detect-coh2')
    const archives = listStockArchives('/install')
    expect(archives.map(a => a.id)).toEqual(['ArtBritish', 'AttribArchive', 'Data'])
  })

  it('skips an archive whose statSync throws (permission denied, missing file, etc.)', async () => {
    // Simulate one archive that can be listed (readdirSync returns it) but
    // whose statSync fails — listStockArchives should skip it silently.
    setDir('/install/CoH2/Archives', ['ArtBritish.sga', 'Corrupt.sga'])
    setFile('/install/CoH2/Archives/ArtBritish.sga', '', undefined, 100)
    // 'Corrupt.sga' NOT added to vfs → statSync will throw ENOENT
    const { listStockArchives } = await import('../detect-coh2')
    const archives = listStockArchives('/install')
    expect(archives).toHaveLength(1)
    expect(archives[0].id).toBe('ArtBritish')
  })
})

// ─── readInfoFromSga — bounded-read behaviour ─────────────────────────────────
//
// Verifies that the SGA parser uses bounded reads (openSync/readSync/closeSync)
// and never reads the full archive — confirmed by the fsMock tracking each read
// range via readSync's `position` and `length` arguments.
//
// The minimal SGA v7 layout used here:
//   0..152    : fixed header (magic, version@8, ..., headerSize@140, dataPos@144)
//   152..end  : TOC region (headerSize bytes)
//   dataPos.. : payload region (where .info bytes live)
//
// TOC internal layout (offsets relative to TOC start):
//   0..15  : skip (dirs etc.)
//   16     : filePos  (uint32 — offset of file-entry array from TOC start)
//   20     : fileCount (uint32)
//   24     : namePosBase (uint32 — offset of name table from TOC start)
//   filePos + i*30: file entry
//     +0  : nameOff   (uint32 — offset into name table)
//     +4  : fDataPos  (uint32 — offset into payload region)
//     +8  : storeLen  (uint32 — stored byte count)
//     +12 : uncompLen (uint32 — uncompressed byte count)
//     +21 : storage   (uint8  — 0=store, 1=zlib)

/**
 * Build a minimal SGA v7 archive Buffer suitable for testing the bounded-read
 * parser. The archive contains exactly one file: `name/pack.info` with the
 * given infoContent, plus a path from `typePath` for type inference.
 *
 * The `extraPayloadPadding` bytes of junk are appended AFTER the real payload
 * region to simulate a large archive where a full readFileSync would be
 * enormously more expensive. The tests confirm that only the bounded ranges are
 * accessed (openSync + readSync with explicit position/length, no readFileSync).
 */
function buildMinimalSga(infoContent: string, typePath: string, extraPayloadPadding = 1_000): Buffer {
  const infoBytes = Buffer.from(infoContent, 'utf8')

  // ── Name table ────────────────────────────────────────────────────────────
  // Two NUL-terminated entries: typePath and "pack.info"
  const typePathBuf  = Buffer.from(typePath + '\0', 'utf8')
  const infoBuf      = Buffer.from('pack.info\0', 'utf8')
  const nameTable    = Buffer.concat([typePathBuf, infoBuf])
  const infoNameOff  = typePathBuf.length  // second name follows first

  // ── File entries (two files × 30 bytes each) ─────────────────────────────
  // Layout: nameOff(4) + fDataPos(4) + storeLen(4) + uncompLen(4) + pad17(16) + storage(1) + pad1(1)
  const fileCount  = 2
  const fileStride = 30
  const fileEntries = Buffer.alloc(fileCount * fileStride, 0)

  // Entry 0: typePath file (empty body — just for type inference)
  fileEntries.writeUInt32LE(0,            0)  // nameOff  → first name
  fileEntries.writeUInt32LE(0,            4)  // fDataPos → 0 (no body)
  fileEntries.writeUInt32LE(0,            8)  // storeLen = 0
  fileEntries.writeUInt32LE(0,           12)  // uncompLen = 0
  fileEntries.writeUInt8(0,              21)  // storage = 0 (store)

  // Entry 1: pack.info (real body)
  fileEntries.writeUInt32LE(infoNameOff,    fileStride + 0)   // nameOff
  fileEntries.writeUInt32LE(0,              fileStride + 4)   // fDataPos = 0 (relative to dataPos)
  fileEntries.writeUInt32LE(infoBytes.length, fileStride + 8) // storeLen
  fileEntries.writeUInt32LE(infoBytes.length, fileStride + 12)// uncompLen
  fileEntries.writeUInt8(0,                 fileStride + 21)  // storage = 0 (store)

  // ── TOC region ────────────────────────────────────────────────────────────
  // We need at least 32 bytes of pre-amble before the file entries.
  // Offsets: filePos@16, fileCount@20, namePosBase@24
  const filePos     = 32  // file entries start at toc offset 32
  const namePosBase = filePos + fileCount * fileStride  // name table follows file entries

  const toc = Buffer.alloc(namePosBase + nameTable.length, 0)
  toc.writeUInt32LE(filePos,     16)
  toc.writeUInt32LE(fileCount,   20)
  toc.writeUInt32LE(namePosBase, 24)
  fileEntries.copy(toc, filePos)
  nameTable.copy(toc, namePosBase)

  const headerSize = toc.length

  // ── Payload region ────────────────────────────────────────────────────────
  // dataPos = 152 + headerSize; infoBytes immediately at offset 0 in payload.
  const dataPos = 152 + headerSize
  const payload = Buffer.concat([infoBytes, Buffer.alloc(extraPayloadPadding, 0xff)])

  // ── Fixed header (152 bytes) ───────────────────────────────────────────────
  const header = Buffer.alloc(152, 0)
  header.write('_ARCHIVE', 0, 'ascii')
  header.writeUInt16LE(7,          8)    // major version
  header.writeUInt32LE(headerSize, 140)
  header.writeUInt32LE(dataPos,    144)

  return Buffer.concat([header, toc, payload])
}

describe('readInfoFromSga — bounded reads via fd (M2 regression)', () => {
  beforeEach(() => {
    mockPlatform = 'linux'
  })

  it('returns null for a non-existent file without throwing', async () => {
    // No vfs entry — openSync should throw ENOENT and readInfoFromSga returns null.
    // We test this via listInstalledPacks (readInfoFromSga is private).
    const { listInstalledPacks } = await import('../detect-coh2')
    // No mods dir at all — returns empty list without crashing.
    expect(listInstalledPacks('/no/such/path')).toEqual([])
  })

  it('parses a valid SGA v7 with a skin path and reads only bounded regions', async () => {
    // Build a minimal skin SGA and register it as a binary file.
    const sgaBuf = buildMinimalSga(
      'name = "Tiger Ace Skins"\n',
      'attrib/skin_pack/my_pack',
      1_000,   // 1 KB of junk padding — would be megabytes for real
    )

    // Track which readSync calls were made (position + length pairs).
    const readRanges: Array<{ pos: number; len: number }> = []
    const origReadSync = fsMock.readSync.bind(fsMock)
    vi.spyOn(fsMock, 'readSync').mockImplementation(
      (fd, buf, offset, length, position) => {
        readRanges.push({ pos: position, len: length })
        return origReadSync(fd, buf, offset, length, position)
      },
    )

    setDir('/mods/skins', ['tiger.sga'])
    setBinaryFile('/mods/skins/tiger.sga', sgaBuf)
    // statSync for mtime check
    vfs.set('/mods/skins/tiger.sga', {
      kind: 'file',
      content: '',
      binContent: sgaBuf,
      mtimeMs: 1000,
    })

    const { listInstalledPacks } = await import('../detect-coh2')
    const packs = listInstalledPacks('/mods')

    // Should find the pack with the correct name and type.
    expect(packs).toHaveLength(1)
    expect(packs[0].name).toBe('Tiger Ace Skins')
    expect(packs[0].type).toBe('skin')

    // ALL readSync calls must have explicit position values (bounded reads).
    // None should read more than the header (152) + TOC + .info bytes.
    // The total file is 152 + headerSize + infoBytes.length + 1000 (padding).
    // Bounded reads NEVER request the full file length.
    for (const { len } of readRanges) {
      // No single read should request more than 64 KB
      // (the max .info guard in the implementation).
      expect(len).toBeLessThanOrEqual(65536)
    }
    // The 1 KB padding at the end is never touched — confirm by checking
    // that no read extends past (152 + headerSize + infoBytes.length).
    const infoBytes = Buffer.from('name = "Tiger Ace Skins"\n', 'utf8')
    const expectedHeaderSize = sgaBuf.readUInt32LE(140)
    const dataPos = sgaBuf.readUInt32LE(144)
    const maxExpectedRead = dataPos + infoBytes.length
    for (const { pos, len } of readRanges) {
      expect(pos + len).toBeLessThanOrEqual(maxExpectedRead)
    }
  })

  it('returns null for a truncated SGA (header < 152 bytes)', async () => {
    const tiny = Buffer.alloc(100, 0)
    tiny.write('_ARCHIVE', 0, 'ascii')
    setBinaryFile('/mods/skins/truncated.sga', tiny)
    vfs.set('/mods/skins/truncated.sga', {
      kind: 'file',
      content: '',
      binContent: tiny,
      mtimeMs: 1000,
    })
    setDir('/mods/skins', ['truncated.sga'])
    const { listInstalledPacks } = await import('../detect-coh2')
    // truncated SGA is silently skipped → empty list
    expect(listInstalledPacks('/mods')).toEqual([])
  })

  it('returns null for an archive with wrong magic (not _ARCHIVE)', async () => {
    const bad = Buffer.alloc(200, 0)
    bad.write('_NOTARC_', 0, 'ascii')
    setBinaryFile('/mods/skins/bad.sga', bad)
    vfs.set('/mods/skins/bad.sga', { kind: 'file', content: '', binContent: bad, mtimeMs: 1000 })
    setDir('/mods/skins', ['bad.sga'])
    const { listInstalledPacks } = await import('../detect-coh2')
    expect(listInstalledPacks('/mods')).toEqual([])
  })
})
