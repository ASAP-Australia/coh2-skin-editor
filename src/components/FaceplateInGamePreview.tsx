/**
 * FaceplateInGamePreview — recreates CoH2's actual in-game faceplate hover-over
 * card so the user can see, at a glance, exactly where their composition will
 * land in the live game UI.
 *
 * @public — kept for potential reuse in other editor surfaces; not imported by
 * FaceplateEditor as of v4 (Live Sync renders the preview in-game instead).
 *
 * Three stacked sections (top → bottom):
 *
 *   1. ICON_NATIVE — the 64×64 sub-rect at TRUE in-game pixel size. This is
 *      what the engine actually paints next to a player's name in chat,
 *      scoreboards, friend lists. No upscaling, no decoration — just the
 *      raw pixels the GPU samples.
 *
 *   2. PLAYER_BADGE — small icon + name lockup, the way the game renders it
 *      in a lobby roster line. Useful to see how the 64×64 reads when it's
 *      shown next to text at normal UI scale.
 *
 *   3. HOVER_CARD — the elaborate gold-framed banner that pops up when you
 *      hover the faceplate slot in the loadout screen. We overlay the
 *      extracted `Faceplates_faceplate_frame_aa_gold.png` (635×208) on top
 *      of the user's banner, then stack the pack name (white bold serif)
 *      and "Faceplate" subtitle below — matching the in-game card.
 *
 * The 64×64 icon is center-cropped from the 624×204 banner at the same
 * ICON_RECT (624, 0, 64, 64) that `composeFaceplateAtlas()` samples — see
 * faceplate-mod-build.ts. We CSS-crop the same source banner so the preview
 * matches the engine pixel-for-pixel without us having to render twice.
 *
 * Asset: /ui-chrome/faceplate-frame-gold.png — extracted from coh2ui.gfx
 * via tools/extract-chrome.ts. The frame is 635×208 with a transparent
 * inner rect, so we sandwich it over the 624×204 banner with a 1:1 mapping
 * (the small 11px/4px overhang represents the ornamental gold edge).
 */

import { FACEPLATE_BANNER_W, FACEPLATE_BANNER_H } from '@/lib/faceplate-project'
import { ICON_RECT } from '@/lib/faceplate-templates'

/** Public path to the extracted CoH2 ornamental gold frame. Served from
 *  `public/ui-chrome/` so Vite picks it up at any base URL. */
const FRAME_GOLD_URL = '/ui-chrome/faceplate-frame-gold.png'

/** White-bold-serif title font stack. CoH2 uses a custom bitmap face we
 *  can't ship; Georgia is the closest free serif present on every OS the
 *  app supports (Win, macOS, Linux-via-Liberation-Serif fallback). */
const COH2_TITLE_FONT = '"Georgia", "Times New Roman", "Liberation Serif", "DejaVu Serif", serif'

interface Props {
  /** Data URL of the composed 624×204 banner. */
  bannerPngUrl: string | null
  /** Display name to show next to the icon — usually the project pack
   *  name so the user can read it as "this is the version of me with
   *  THIS faceplate equipped". */
  playerName?: string
}

export default function FaceplateInGamePreview({ bannerPngUrl, playerName = 'PlayerName' }: Props) {
  // Per the v1.0 design brief: the outer "As seen in-game" wrapper widget
  // is gone (no parent border, no gradient fill, no caption header). The
  // three sub-previews are now standalone surfaces that the editor lays
  // out in a vertical stack at the top-right of the canvas surface.
  // Player-badge chrome (Lvl 42 · Victory!) is also stripped — it was
  // visual noise that pretended to be plausible in-game UI but really
  // wasn't, and it implied the editor surfaces metadata it doesn't have.
  return (
    <div
      role="img"
      aria-label="In-game preview of where your faceplate will appear"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* ─────────────────────────────────────────────────────────────────
          Section 1 — true 64×64 native-pixel icon
          ───────────────────────────────────────────────────────────────── */}
      <PreviewChip caption="In-game icon (64×64)">
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            padding: '4px 0',
          }}
        >
          <IconCrop bannerPngUrl={bannerPngUrl} displaySize={ICON_RECT.width} />
        </div>
      </PreviewChip>

      {/* ─────────────────────────────────────────────────────────────────
          Section 2 — player badge lockup (no level / victory chrome)
          ───────────────────────────────────────────────────────────────── */}
      <PreviewChip caption="Player badge">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '4px 4px',
          }}
        >
          <IconCrop bannerPngUrl={bannerPngUrl} displaySize={36} />
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: '#caa45a',
              letterSpacing: 0.3,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 180,
            }}
          >
            {playerName}
          </span>
        </div>
      </PreviewChip>

      {/* ─────────────────────────────────────────────────────────────────
          Section 3 — in-game hover card (the actual UI element)
          ───────────────────────────────────────────────────────────────── */}
      <PreviewChip caption="In-game hover">
        <HoverCard bannerPngUrl={bannerPngUrl} title={playerName} />
      </PreviewChip>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────────

/**
 * Center-cropped icon, rendered at `displaySize` CSS-pixels. We position a
 * full-size copy of the banner inside an overflow-hidden box and translate
 * it so the ICON_RECT region (top-right 64×64) is what's visible.
 *
 * Math: scale = displaySize / ICON_RECT.width. We render the banner at
 * (FACEPLATE_BANNER_W * scale)×(FACEPLATE_BANNER_H * scale), then offset by
 * −ICON_RECT.x*scale, −ICON_RECT.y*scale to bring that region to (0,0).
 */
function IconCrop({
  bannerPngUrl,
  displaySize,
}: {
  bannerPngUrl: string | null
  displaySize: number
}) {
  const scale = displaySize / ICON_RECT.width
  return (
    <div
      style={{
        width: displaySize,
        height: displaySize,
        borderRadius: 4,
        border: '1px solid rgba(202, 164, 90, 0.32)',
        overflow: 'hidden',
        flexShrink: 0,
        position: 'relative',
        background:
          'repeating-conic-gradient(rgba(255,255,255,0.04) 0% 25%, rgba(0,0,0,0) 0% 50%) 50% / 8px 8px',
        // Use nearest-neighbour so the user sees a faithful pixel-art
        // sample of what the engine actually shows. CoH2 paints icons at
        // 1:1 with no upscaling — so should we.
        imageRendering: 'pixelated',
      }}
    >
      {bannerPngUrl && (
        <img
          src={bannerPngUrl}
          alt=""
          width={FACEPLATE_BANNER_W * scale}
          height={FACEPLATE_BANNER_H * scale}
          style={{
            position: 'absolute',
            left: -ICON_RECT.x * scale,
            top: -ICON_RECT.y * scale,
            width: FACEPLATE_BANNER_W * scale,
            height: FACEPLATE_BANNER_H * scale,
            imageRendering: 'pixelated',
            display: 'block',
          }}
        />
      )}
    </div>
  )
}

/**
 * The elaborate hover-over card the engine pops up when you mouse over a
 * faceplate slot in the loadout screen. The gold ornamental frame is the
 * extracted Faceplates_faceplate_frame_aa_gold.png served from public/.
 *
 * Layout: title (white bold serif, pack name) → "Faceplate" subtitle →
 * framed banner (user composition behind, gold PNG on top).
 */
function HoverCard({ bannerPngUrl, title }: { bannerPngUrl: string | null; title: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        padding: '10px 4px 4px',
      }}
    >
      <h4
        style={{
          margin: 0,
          fontFamily: COH2_TITLE_FONT,
          fontWeight: 700,
          fontSize: 18,
          color: '#fff',
          letterSpacing: 0.3,
          textShadow: '0 1px 2px rgba(0,0,0,0.85)',
          textAlign: 'center',
          // Wrap rather than clip — pack names get long.
          maxWidth: 240,
          lineHeight: 1.15,
        }}
      >
        {title}
      </h4>
      <div
        style={{
          fontFamily: COH2_TITLE_FONT,
          fontSize: 11,
          fontWeight: 600,
          fontStyle: 'italic',
          color: 'rgba(202, 164, 90, 0.88)',
          letterSpacing: 1.2,
          textTransform: 'uppercase',
          marginBottom: 2,
        }}
      >
        Faceplate
      </div>
      {/* Frame + banner. Outer wrapper carries the aspect ratio of the
          FRAME asset (635:208 ≈ 3.053). The frame PNG is absolute-positioned
          OVER the banner so the gold ornament appears around the user's art.
          The banner itself is inset by the frame's edge thickness ratio:
          the inner content rect of the 635×208 frame maps to the full
          624×204 banner, so we just place the banner at 100% and overlay. */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 280,
          aspectRatio: '635 / 208',
        }}
      >
        {/* Banner — sized to the inner rect of the frame. The gold frame
            PNG has a ~5px gold edge on all sides; we inset the banner by
            that ratio (5/635 horizontally, 2/208 vertically) so the user's
            art sits cleanly inside the ornament. */}
        <div
          style={{
            position: 'absolute',
            left: `${(5 / 635) * 100}%`,
            top: `${(2 / 208) * 100}%`,
            right: `${(5 / 635) * 100}%`,
            bottom: `${(2 / 208) * 100}%`,
            borderRadius: 2,
            overflow: 'hidden',
            background:
              'repeating-conic-gradient(rgba(255,255,255,0.04) 0% 25%, rgba(0,0,0,0) 0% 50%) 50% / 14px 14px',
          }}
        >
          {bannerPngUrl ? (
            <img
              src={bannerPngUrl}
              alt=""
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />
          ) : (
            <Composing />
          )}
        </div>
        {/* Ornamental gold frame — sits on top, pointer-events:none so it
            never swallows hover/clicks. */}
        <img
          src={FRAME_GOLD_URL}
          alt=""
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            display: 'block',
          }}
        />
      </div>
    </div>
  )
}

/**
 * A standalone glass chip — one per preview section. The chip's outer
 * style matches the editor-primitives `glassMicroSurface` recipe so the
 * chip docks cleanly against the WindowControls pill at the top-right of
 * the editor surface.
 */
function PreviewChip({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'rgba(15, 17, 22, 0.75)',
        backgroundImage:
          'linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.02))',
        backdropFilter: 'blur(40px) saturate(150%)',
        WebkitBackdropFilter: 'blur(40px) saturate(150%)',
        border: '0.5px solid rgba(255, 255, 255, 0.08)',
        boxShadow: 'inset 0 0.5px 0 rgba(255, 255, 255, 0.05), 0 4px 12px -4px rgba(0, 0, 0, 0.25)',
        borderRadius: 10,
        padding: 8,
      }}
    >
      <div
        style={{
          fontSize: 9,
          letterSpacing: 1,
          textTransform: 'uppercase',
          color: 'rgba(247,247,250,0.45)',
          marginBottom: 4,
        }}
      >
        {caption}
      </div>
      {children}
    </div>
  )
}

function Composing() {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        color: 'rgba(247,247,250,0.45)',
        fontSize: 10,
      }}
    >
      Composing…
    </div>
  )
}
