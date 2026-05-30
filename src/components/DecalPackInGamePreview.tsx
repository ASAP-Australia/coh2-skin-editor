/**
 * DecalPackInGamePreview — "as seen in game" mock of the CoH2 decal
 * picker grid.
 *
 * In-game, CoH2 surfaces decals as a paginated 3-column tile grid in the
 * Skins → Customise screen. Each tile is the 128² decal texture rendered
 * on a dark slate, with the decal name beneath. We mirror that layout
 * here so the user can see exactly which decals (and in what order) the
 * game will offer them at equip time.
 *
 * Additionally, a King Tiger 3D preview pane above the grid shows the
 * selected decal composited onto the tank's canonical hull-side-right
 * decal zone, giving authors a real "as seen in game" preview rather
 * than just the source bitmap.
 *
 * Renders only `visible` decals — hidden decals are skipped at export
 * (see `decal-pack-export.ts`), so excluding them from the preview keeps
 * the surface honest.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type Coh2DecalPackProject, type Decal } from '@/lib/decal-pack-project'
import { rasteriseDecal } from '@/lib/decal-pack-export'
import { renderKingTigerWithDecal } from '@/lib/vehicle-3d-renderer'

interface Props {
  project: Coh2DecalPackProject
  installRoot?: FileSystemDirectoryHandle | null
}

export default function DecalPackInGamePreview({ project, installRoot }: Props) {
  const visibleDecals = useMemo(() => project.decals.filter(d => d.visible), [project.decals])
  // Stable hash of the visible decals' visual inputs so the rasterise
  // effect only re-runs when something on-screen actually changes.
  const visibleHash = useMemo(() => decalHash(visibleDecals), [visibleDecals])

  // Map of decal-id → data URL of the rasterised 128² thumbnail. We
  // rasterise off the main render loop so the grid paints instantly
  // while thumbs trickle in.
  const [thumbs, setThumbs] = useState<Record<string, string>>({})

  // Which decal is currently selected for the King Tiger 3D preview.
  // Defaults to the first visible decal.
  const [selectedDecalId, setSelectedDecalId] = useState<string | null>(null)

  // Map of decal-id → rendered King Tiger PNG data URL (cached to avoid
  // re-rendering on every hover).
  const [kingTigerRenders, setKingTigerRenders] = useState<Record<string, string>>({})
  // Whether a King Tiger render is in-flight.
  const [kingTigerLoading, setKingTigerLoading] = useState(false)
  // Track the last render request to cancel stale ones.
  const renderCancelRef = useRef<{ cancelled: boolean }>({ cancelled: false })

  // The currently-selected decal object (or first visible, as default).
  const selectedDecal = useMemo(() => {
    if (selectedDecalId) {
      const found = visibleDecals.find(d => d.id === selectedDecalId)
      if (found) return found
    }
    return visibleDecals[0] ?? null
  }, [selectedDecalId, visibleDecals])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      for (const decal of visibleDecals) {
        const src = project.sourceImages[decal.sourceImageId]
        if (!src) continue
        try {
          const dataUrl = await rasteriseDecalToDataUrl(decal, src.dataUrl)
          if (cancelled) return
          setThumbs(prev => ({ ...prev, [decal.id]: dataUrl }))
        } catch {
          // A single decal failing to rasterise mustn't poison the
          // whole grid — leave it as a placeholder.
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // Re-rasterise whenever the visible-decal identity, ordering, or
    // transform changes. `visibleHash` already encodes that, but we also
    // need `project.sourceImages` for when a source image is swapped.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- visibleHash is a stable hash of visibleDecals; including the array itself would cause unnecessary reruns
  }, [visibleHash, project.sourceImages])

  // Render King Tiger with the selected decal whenever the selection changes
  // and we have an install handle.
  const triggerKingTigerRender = useCallback(
    async (decal: Decal) => {
      if (!installRoot) return
      // Cache hit: skip re-render.
      if (kingTigerRenders[decal.id]) return

      // Cancel any previous in-flight render.
      renderCancelRef.current.cancelled = true
      const token = { cancelled: false }
      renderCancelRef.current = token

      const src = project.sourceImages[decal.sourceImageId]
      if (!src) return

      setKingTigerLoading(true)
      try {
        // Rasterise the decal to a canvas element.
        const bitmap = await loadImage(src.dataUrl)
        const decalCanvas = rasteriseDecalToCanvas(decal, bitmap)
        if (token.cancelled) return

        const dataUrl = await renderKingTigerWithDecal({
          install: installRoot,
          decalCanvas,
          size: 512,
        })
        if (token.cancelled) return

        if (dataUrl) {
          setKingTigerRenders(prev => ({ ...prev, [decal.id]: dataUrl }))
        }
      } catch (e) {
        console.warn('[DecalPackInGamePreview] King Tiger render failed:', (e as Error).message)
      } finally {
        if (!token.cancelled) setKingTigerLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- kingTigerRenders omitted intentionally: checking inside via closure to avoid stale renders
    [installRoot, project.sourceImages],
  )

  // Kick off the render whenever the selected decal changes.
  useEffect(() => {
    if (!selectedDecal) return
    const decal = selectedDecal
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setState is inside async callback, not synchronous
    void triggerKingTigerRender(decal)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- triggerKingTigerRender is stable; selectedDecal.id is the real dep
  }, [selectedDecal?.id, triggerKingTigerRender])

  const handleTileSelect = useCallback((decalId: string) => {
    setSelectedDecalId(decalId)
  }, [])

  // Per the v1.0 design brief: the outer "As seen in-game" wrapper widget
  // is gone (no gold border, no gradient fill, no caption header, no
  // explanatory paragraph). The grid surface itself remains because it's
  // what the user actually wants to see — the in-game decal-picker tile
  // grid, in their pack's slot order. The chip recipe matches the
  // WindowControls pill so the preview docks cleanly at the top-right of
  // the editor.
  //
  // v1.1 addition: King Tiger 3D preview pane above the grid.
  const currentKingTigerRender = selectedDecal ? kingTigerRenders[selectedDecal.id] : undefined

  return (
    <div
      role="img"
      aria-label="In-game preview of how your decal pack will appear in the customisation screen"
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
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {/* King Tiger 3D preview pane */}
      <KingTigerPreviewPane
        installRoot={installRoot}
        renderDataUrl={currentKingTigerRender}
        isLoading={kingTigerLoading}
      />

      <div
        style={{
          fontSize: 9,
          letterSpacing: 1,
          textTransform: 'uppercase',
          color: 'rgba(247,247,250,0.45)',
        }}
      >
        Customise → Decals
      </div>

      {visibleDecals.length === 0 ? (
        <div
          style={{
            padding: '18px 8px',
            textAlign: 'center',
            color: 'rgba(247,247,250,0.45)',
            fontSize: 11,
            background: 'rgba(0,0,0,0.35)',
            borderRadius: 6,
            border: '1px dashed rgba(255,255,255,0.08)',
          }}
        >
          No visible decals yet.
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 6,
            background: 'rgba(0,0,0,0.45)',
            borderRadius: 6,
            padding: 6,
          }}
        >
          {visibleDecals.map((decal, idx) => (
            <DecalTile
              key={decal.id}
              decal={decal}
              thumbUrl={thumbs[decal.id]}
              slotNumber={idx + 1}
              selected={decal.id === (selectedDecal?.id ?? visibleDecals[0]?.id)}
              onSelect={handleTileSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Tile
// ─────────────────────────────────────────────────────────────────────────

function DecalTile({
  decal,
  thumbUrl,
  slotNumber,
  selected,
  onSelect,
}: {
  decal: Decal
  thumbUrl: string | undefined
  slotNumber: number
  selected?: boolean
  onSelect?: (id: string) => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        cursor: onSelect ? 'pointer' : undefined,
      }}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={() => onSelect?.(decal.id)}
      onMouseEnter={() => onSelect?.(decal.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect?.(decal.id) }}
    >
      <div
        style={{
          aspectRatio: '1 / 1',
          background:
            'repeating-conic-gradient(rgba(255,255,255,0.04) 0% 25%, rgba(0,0,0,0) 0% 50%) 50% / 8px 8px, #0a0e16',
          border: selected
            ? '1px solid rgba(202, 164, 90, 0.7)'
            : '1px solid rgba(202, 164, 90, 0.22)',
          borderRadius: 4,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt=""
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              display: 'block',
              imageRendering: 'auto',
            }}
          />
        ) : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              fontSize: 9,
              color: 'rgba(247,247,250,0.4)',
            }}
          >
            …
          </div>
        )}
        {/* Slot number — top-left, mimics CoH2's "pick #N" badge */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 2,
            left: 4,
            fontSize: 9,
            color: 'rgba(202, 164, 90, 0.85)',
            fontWeight: 600,
            textShadow: '0 1px 2px rgba(0,0,0,0.7)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {slotNumber}
        </div>
      </div>
      <span
        style={{
          fontSize: 10,
          color: 'rgba(247,247,250,0.75)',
          textAlign: 'center',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          padding: '0 2px',
        }}
        title={decal.name}
      >
        {decal.name || `Decal ${slotNumber}`}
      </span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// King Tiger preview pane
// ─────────────────────────────────────────────────────────────────────────

function KingTigerPreviewPane({
  installRoot,
  renderDataUrl,
  isLoading,
}: {
  installRoot?: FileSystemDirectoryHandle | null
  renderDataUrl?: string
  isLoading: boolean
}) {
  const paneStyle: React.CSSProperties = {
    width: '100%',
    height: 180,
    background: 'rgba(10, 11, 15, 0.85)',
    border: '0.5px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 6,
    overflow: 'hidden',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  }

  // No install: show connect hint
  if (!installRoot) {
    return (
      <div style={paneStyle}>
        <div
          style={{
            fontSize: 10,
            color: 'rgba(247,247,250,0.4)',
            textAlign: 'center',
            padding: '0 16px',
            lineHeight: 1.5,
          }}
        >
          Connect your CoH2 install to preview decals on the King Tiger
        </div>
        <div
          style={{
            fontSize: 9,
            letterSpacing: 1,
            textTransform: 'uppercase',
            color: 'rgba(247,247,250,0.2)',
          }}
        >
          Königstiger · in-game preview
        </div>
      </div>
    )
  }

  return (
    <div style={paneStyle}>
      {renderDataUrl ? (
        <img
          src={renderDataUrl}
          alt="King Tiger with decal applied"
          style={{
            width: 240,
            height: 180,
            objectFit: 'contain',
            display: 'block',
          }}
        />
      ) : isLoading ? (
        // Spinner placeholder
        <div
          style={{
            width: 24,
            height: 24,
            border: '2px solid rgba(255,255,255,0.1)',
            borderTopColor: 'rgba(202, 164, 90, 0.7)',
            borderRadius: '50%',
            animation: 'kt-spin 0.8s linear infinite',
          }}
        />
      ) : (
        <div
          style={{
            fontSize: 10,
            color: 'rgba(247,247,250,0.35)',
          }}
        >
          …
        </div>
      )}
      {/* Caption row */}
      <div
        style={{
          position: 'absolute',
          bottom: 6,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontSize: 9,
          letterSpacing: 1,
          textTransform: 'uppercase',
          color: 'rgba(247,247,250,0.3)',
          pointerEvents: 'none',
        }}
      >
        Königstiger · in-game preview
      </div>
      {/* Inline keyframe for the spinner (avoids an external CSS dependency) */}
      <style>{`@keyframes kt-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Rasterisation helper — wrap the shared exporter so we can feed it a
// data URL and get a data URL back.
// ─────────────────────────────────────────────────────────────────────────

async function rasteriseDecalToDataUrl(decal: Decal, sourceDataUrl: string): Promise<string> {
  const bitmap = await loadImage(sourceDataUrl)
  const canvas = rasteriseDecal(decal, bitmap)
  // OffscreenCanvas.convertToBlob → data URL; HTMLCanvasElement.toDataURL.
  if ('convertToBlob' in canvas) {
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    return await new Promise<string>((res, rej) => {
      const r = new FileReader()
      r.onload = () => res(String(r.result))
      r.onerror = () => rej(r.error ?? new Error('FileReader failed'))
      r.readAsDataURL(blob)
    })
  }
  return canvas.toDataURL('image/png')
}

/** Return the rasterised decal as an HTMLCanvasElement (not a data URL),
 *  for feeding into the Three.js bake pipeline which needs a canvas. */
function rasteriseDecalToCanvas(decal: Decal, bitmap: HTMLImageElement): HTMLCanvasElement {
  const result = rasteriseDecal(decal, bitmap)
  // If rasteriseDecal returns an OffscreenCanvas, copy it to a regular canvas
  // so Three.js CanvasTexture accepts it.
  if ('convertToBlob' in result) {
    const el = document.createElement('canvas')
    el.width = result.width
    el.height = result.height
    el.getContext('2d')?.drawImage(result as unknown as CanvasImageSource, 0, 0)
    return el
  }
  return result as HTMLCanvasElement
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const el = new Image()
    el.onload = () => res(el)
    el.onerror = () => rej(new Error('Image decode failed'))
    el.src = src
  })
}

// ─────────────────────────────────────────────────────────────────────────
// Stable hash for memoising the rasteriser effect. Hashes only the bits
// that affect the visual output (id, sourceImageId, transform, opacity,
// flip, name) — not order-independent fields like canvas size which are
// the global DECAL_PACK_SIZE constant.
// ─────────────────────────────────────────────────────────────────────────

function decalHash(decals: Decal[]): string {
  const parts: string[] = []
  for (const d of decals) {
    parts.push(
      [
        d.id,
        d.sourceImageId,
        d.x.toFixed(1),
        d.y.toFixed(1),
        d.scale.toFixed(3),
        d.rotation.toFixed(1),
        d.opacity.toFixed(2),
        d.flipH ? 1 : 0,
        d.flipV ? 1 : 0,
      ].join(':'),
    )
  }
  return parts.join('|')
}
