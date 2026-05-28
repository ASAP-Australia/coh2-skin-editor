/**
 * parseColor — pure color string parser shared by HexColorInput.
 *
 * Accepts: #rgb  #rrggbb  #rrggbbaa  rgb(r,g,b)  rgba(r,g,b,a)
 *          hsl(h,s%,l%)  hsla(h,s%,l%,a)
 *
 * Returns a normalised lowercase hex string or null for invalid input.
 */

/** Normalise any accepted color string into '#rrggbb' or '#rrggbbaa'.
 *  Returns `null` for unrecognised / out-of-range input. */
export function parseColor(s: string): string | null {
  const raw = s.trim()

  // ── HEX ──────────────────────────────────────────────────────────────────
  const hex = raw.startsWith('#') ? raw.slice(1) : null
  if (hex !== null) {
    if (/^[0-9a-fA-F]{3}$/.test(hex)) {
      // #rgb → #rrggbb
      const [r, g, b] = hex.split('')
      return `#${r}${r}${g}${g}${b}${b}`
    }
    if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toLowerCase()}`
    if (/^[0-9a-fA-F]{8}$/.test(hex)) return `#${hex.toLowerCase()}`
    return null
  }

  // ── RGB / RGBA ────────────────────────────────────────────────────────────
  const rgbMatch = raw.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i)
  if (rgbMatch) {
    const [, rs, gs, bs, as_] = rgbMatch
    const r = parseInt(rs, 10)
    const g = parseInt(gs, 10)
    const b = parseInt(bs, 10)
    if (r > 255 || g > 255 || b > 255) return null
    const hex6 = [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('')
    if (as_ !== undefined) {
      const a = parseFloat(as_)
      if (a < 0 || a > 1) return null
      const ah = Math.round(a * 255)
        .toString(16)
        .padStart(2, '0')
      return `#${hex6}${ah}`
    }
    return `#${hex6}`
  }

  // ── HSL / HSLA ───────────────────────────────────────────────────────────
  const hslMatch = raw.match(
    /^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%(?:\s*,\s*([\d.]+))?\s*\)$/i,
  )
  if (hslMatch) {
    const [, hs, ss, ls, as_] = hslMatch
    const h = parseFloat(hs)
    const s = parseFloat(ss) / 100
    const l = parseFloat(ls) / 100
    if (h < 0 || h > 360 || s < 0 || s > 1 || l < 0 || l > 1) return null

    // HSL → RGB conversion
    const c = (1 - Math.abs(2 * l - 1)) * s
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
    const m = l - c / 2
    let r = 0,
      g = 0,
      b = 0
    if (h < 60) {
      r = c
      g = x
    } else if (h < 120) {
      r = x
      g = c
    } else if (h < 180) {
      g = c
      b = x
    } else if (h < 240) {
      g = x
      b = c
    } else if (h < 300) {
      r = x
      b = c
    } else {
      r = c
      b = x
    }
    const toHex = (n: number) =>
      Math.round((n + m) * 255)
        .toString(16)
        .padStart(2, '0')
    const hex6 = `${toHex(r)}${toHex(g)}${toHex(b)}`
    if (as_ !== undefined) {
      const a = parseFloat(as_)
      if (a < 0 || a > 1) return null
      const ah = Math.round(a * 255)
        .toString(16)
        .padStart(2, '0')
      return `#${hex6}${ah}`
    }
    return `#${hex6}`
  }

  return null
}
