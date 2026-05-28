/**
 * Faction metadata: colors, icons, labels.
 *
 * The icon PNGs at `public/factions/<faction>.png` are 256×256 RGBA renders
 * of public-domain heraldic SVGs from Wikimedia Commons that match each
 * faction's iconic vehicle marking:
 *   – german      → Balkenkreuz (Wehrmacht Greek cross)
 *   – west_german → Eisernes Kreuz / Iron Cross (heraldic Wehrmacht)
 *   – soviet      → Hammer & sickle
 *   – aef         → US Army roundel (1942-43 invasion star)
 *   – british     → RAF roundel (red/white/blue concentric)
 *
 * The actual in-game CoH2 lobby emblems live inside the Scaleform binary
 * `ui/bin/coh2ui.gfx` and aren't reachable by filename in any SGA archive
 * (confirmed by `tools/list-data-ui-textures.mts` +
 * `tools/probe-faction-default-badges.mts`). The earlier extraction from
 * `gcs_<faction>_dif.rgt` produced vehicle-decal sprite atlases (rank
 * pips, "MK 22380" stencils), which is why we now use the heraldic
 * sources. Re-render via `tools/process-faction-emblems.mts` if needed.
 *
 * Rendered with an `<img>` tag so consumers can wrap it in any sized
 * circular button without knowing about the asset format.
 */

import type { Faction } from './vehicles'

/** Faction display colors (oklch color space) */
export const FACTION_COLORS: Record<Faction, string> = {
  german: 'oklch(0.45 0.25 15)', // dark gray-brown (Wehrmacht)
  west_german: 'oklch(0.50 0.22 45)', // tan (OKW Western Front)
  soviet: 'oklch(0.40 0.28 0)', // red (Soviet forces)
  aef: 'oklch(0.58 0.18 265)', // steel blue (US forces)
  british: 'oklch(0.55 0.20 265)', // royal blue (British forces)
}

/**
 * URL of the heraldic emblem PNG for each faction.
 *
 * Relative paths (`./factions/...`) are intentional: absolute `/`-prefixed
 * paths break in the Electron production build because `file://` resolves
 * `/factions/german.png` to the filesystem root (`file:///factions/german.png`)
 * rather than the app bundle's asset directory. Relative paths work correctly
 * for both Electron (`file://…/dist/index.html` → `./factions/german.png`)
 * and the GitHub Pages web deploy (base-relative).
 */
export const FACTION_ICON_SRC: Record<Faction, string> = {
  german: './factions/german.png',
  west_german: './factions/west_german.png',
  soviet: './factions/soviet.png',
  aef: './factions/aef.png',
  british: './factions/british.png',
}

/**
 * Faction emblem image. Sized to fit its parent at 85% so it sits inside
 * a sized container without touching the edge. Drag/select disabled so
 * pointer events go to the parent button.
 */
// eslint-disable-next-line react-refresh/only-export-components -- internal component used only to build FACTION_ICONS constant; file is a data module
function FactionImg({ faction }: { faction: Faction }) {
  return (
    <img
      src={FACTION_ICON_SRC[faction]}
      alt=""
      draggable={false}
      style={{
        width: '85%',
        height: '85%',
        objectFit: 'contain',
        userSelect: 'none',
        pointerEvents: 'none',
        // Smooth scale on retina; the 256px source has plenty of headroom
        // for typical 32-96px display sizes.
        imageRendering: 'auto',
      }}
    />
  )
}

/** Faction icons (heraldic emblems) */
export const FACTION_ICONS: Record<Faction, React.ReactNode> = {
  german: <FactionImg faction="german" />,
  west_german: <FactionImg faction="west_german" />,
  soviet: <FactionImg faction="soviet" />,
  aef: <FactionImg faction="aef" />,
  british: <FactionImg faction="british" />,
}

/** Faction labels for display */
export const FACTION_LABELS: Record<Faction, string> = {
  german: 'OstHeer',
  west_german: 'OKW',
  soviet: 'Soviet',
  aef: 'USF',
  british: 'UKF',
}
