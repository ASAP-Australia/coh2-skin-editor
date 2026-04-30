/**
 * Lightweight UX helpers — OS detection, mods-folder hints, format helpers.
 * Browser-only (no Node imports). Used by the connect screen + export panel
 * to give the user concrete, copy-paste-able paths instead of generic
 * "find your install folder" hand-waving.
 */

export type OS = 'win' | 'mac' | 'linux' | 'other'

export function detectOS(): OS {
  const p = navigator.userAgent.toLowerCase()
  if (p.includes('windows')) return 'win'
  if (p.includes('mac os')   || p.includes('macintosh')) return 'mac'
  if (p.includes('linux')    || p.includes('cros')) return 'linux'
  return 'other'
}

/** Where the user's CoH2 *install* (game files) most likely lives. */
export function defaultInstallPath(os: OS): string {
  switch (os) {
    case 'win':   return 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Company of Heroes 2'
    case 'mac':   return '~/Library/Application Support/Steam/steamapps/common/Company of Heroes 2'
    case 'linux': return '~/.local/share/Steam/steamapps/common/Company of Heroes 2'
    default:      return '~/Steam/steamapps/common/Company of Heroes 2'
  }
}

/** Where the *mods* folder (where the user drops the exported .sga) lives. */
export function defaultModsPath(os: OS): string {
  switch (os) {
    case 'win':   return '%USERPROFILE%\\Documents\\My Games\\Company of Heroes 2\\mods\\skins'
    case 'mac':   return '~/Library/Application Support/Steam/steamapps/compatdata/231430/pfx/.../mods/skins'
    case 'linux': return '~/.local/share/Steam/steamapps/compatdata/231430/pfx/drive_c/users/steamuser/Documents/My Games/Company of Heroes 2/mods/skins'
    default:      return '<user>/Documents/My Games/Company of Heroes 2/mods/skins'
  }
}

export function osLabel(os: OS): string {
  return { win: 'Windows', mac: 'macOS', linux: 'Linux / Steam Deck', other: 'your OS' }[os]
}

/** Friendly relative time, e.g. "saved 3s ago". */
export function relTime(iso: string | undefined): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'just now'
  if (ms < 5_000)   return 'just now'
  if (ms < 60_000)  return `${Math.round(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  return `${Math.round(ms / 3_600_000)}h ago`
}
