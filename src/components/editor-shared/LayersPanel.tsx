/**
 * LayersPanel — persistent Photoshop-style layers panel docked to the left
 * side of the FaceplateEditor.
 *
 * Upgrades the existing 44px layer-thumbnail strip into a full 180px panel
 * with:
 *   • Layer name label (editable inline; Enter/blur commits, Esc cancels).
 *   • Visibility eye toggle.
 *   • Per-layer opacity compact slider.
 *   • Blend mode compact dropdown.
 *   • Flip H / Flip V toggles (image layers only).
 *   • Drag-to-reorder (HTML5 drag — same handlers as the old strip).
 *   • Click-to-select (drives the Konva Transformer).
 *   • Active-layer highlight.
 *   • Scrollable with the existing custom-scrollbar class.
 *
 * All mutations go through the shared `mutate` callback which feeds the
 * history engine (editor-history.ts) — single undo frame per gesture.
 *
 * Factored into editor-shared/ so DecalPackEditor can adopt the same panel
 * later without duplication (note the opportunity in FACEPLATE-PANELS.md).
 */

import { useRef, useState, type CSSProperties } from 'react'
import {
  CornerDownLeft,
  Eye,
  EyeOff,
  GripVertical,
  Lock,
  LockOpen,
} from 'lucide-react'
import {
  BLEND_MODES,
  type BlendMode,
} from '@/lib/layer-compositor/layer-model'
import type { GenericLayerProject } from '@/lib/layer-compositor/layer-model'
import {
  EDITOR_ACCENT,
  EDITOR_TEXT_2,
  EDITOR_TEXT_3,
  EDITOR_TEXT_4,
} from '@/components/editor-primitives/tokens'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert kebab-case blend mode to Title Case label. */
function blendLabel(mode: BlendMode): string {
  return mode
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LayersPanelProps<L extends { id: string; visible: boolean }> {
  project: GenericLayerProject<L>
  selectedId: string | null
  multiSelectedIds: Set<string>
  renamingLayerId: string | null
  dragLayerId: string | null
  dragOverLayerId: string | null
  mutate: (
    fn: (p: GenericLayerProject<L>) => GenericLayerProject<L>,
    opts?: { undoable?: boolean },
  ) => void
  onSelectLayer: (id: string | null, multi?: boolean, shift?: boolean) => void
  onStartRename: (id: string) => void
  onEndRename: (id: string, newName: string | null) => void
  onDragStart: (id: string) => void
  onDragOver: (id: string) => void
  onDrop: (id: string) => void
  onDragEnd: () => void
  /** Helper to derive display label from a layer (mirrors the existing logic). */
  getLayerLabel: (layer: L) => string
  /** Thumbnail content for a layer (same icons the strip used). */
  getLayerThumbnail: (layer: L) => React.ReactNode
  /** Open context menu on right-click. */
  onContextMenu: (id: string, x: number, y: number) => void
  onClickOutside?: () => void
}

// ── Inline styles ─────────────────────────────────────────────────────────────

const panelSurface: CSSProperties = {
  position: 'fixed',
  left: 12,
  // Float as a glass card: clear gap below title pill (~60px) and above bottom
  // tool pill (~100px) so there's visible breathing room all around the edges.
  top: 'calc(var(--app-top-inset, 0px) + 60px)',
  bottom: 100,
  zIndex: 38,
  display: 'flex',
  flexDirection: 'column',
  width: 210,
  // Match the glass-hud recipe exactly (same as BottomToolPill / AtlasViewPanel)
  // so all three floating surfaces read as one family.
  background: 'rgba(20,20,20,0.68)',
  backdropFilter: 'blur(36px) saturate(125%)',
  WebkitBackdropFilter: 'blur(36px) saturate(125%)',
  border: '0.5px solid rgba(255,255,255,0.10)',
  borderRadius: 16,
  boxShadow:
    '0 1px 1px rgba(0,0,0,0.30), 0 12px 30px rgba(0,0,0,0.46), inset 0 0.5px 0 rgba(255,255,255,0.10)',
  overflow: 'hidden',
}

const panelHeader: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 10px 7px',
  borderBottom: '0.5px solid rgba(255,255,255,0.07)',
  flexShrink: 0,
}

const headingStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 1.4,
  textTransform: 'uppercase',
  color: EDITOR_TEXT_3,
  margin: 0,
}

const countChipStyle: CSSProperties = {
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: '0.04em',
  color: EDITOR_TEXT_4,
  background: 'rgba(255,255,255,0.06)',
  border: '0.5px solid rgba(255,255,255,0.10)',
  borderRadius: 4,
  padding: '1px 5px',
  lineHeight: '14px',
}

const scrollBody: CSSProperties = {
  overflowY: 'auto',
  flex: 1,
  padding: '4px 6px 6px',
}

function iconBtn(active: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 18,
    height: 18,
    borderRadius: 4,
    border: 'none',
    background: 'transparent',
    color: active ? EDITOR_ACCENT : EDITOR_TEXT_4,
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
    transition: 'color 0.1s',
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function LayersPanel<L extends { id: string; visible: boolean }>({
  project,
  selectedId,
  multiSelectedIds,
  renamingLayerId,
  dragLayerId,
  dragOverLayerId,
  mutate,
  onSelectLayer,
  onStartRename,
  onEndRename,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  getLayerLabel,
  getLayerThumbnail,
  onContextMenu,
  onClickOutside,
}: LayersPanelProps<L>) {
  const mapLayer = (
    p: GenericLayerProject<L>,
    id: string,
    fn: (l: L) => L,
  ): GenericLayerProject<L> => ({ ...p, layers: p.layers.map(l => (l.id === id ? fn(l) : l)) })

  return (
    <div
      role="toolbar"
      aria-label="Layers"
      data-testid="layers-panel"
      className="l01-ring l01-bloom l01-grain"
      style={panelSurface}
      onClick={onClickOutside}
      onKeyDown={ev => {
        if (ev.key === 'Escape') onClickOutside?.()
      }}
    >
      {/* ── Header ── */}
      <div style={panelHeader}>
        <h3 style={headingStyle}>Layers</h3>
        {project.layers.length > 0 && (
          <span style={countChipStyle}>
            {project.layers.length}
          </span>
        )}
      </div>

      {/* ── Layer rows — reversed so top-of-stack renders first ── */}
      <div className="custom-scrollbar" style={scrollBody}>
        {project.layers.length === 0 ? (
          <p
            style={{
              margin: '20px 8px',
              fontSize: 10,
              lineHeight: 1.6,
              color: EDITOR_TEXT_4,
              textAlign: 'center',
            }}
          >
            No layers yet.
            <br />
            Drop an image or use a tool.
          </p>
        ) : (
        <>
        {[...project.layers].reverse().map(layer => {
          const isSelected = layer.id === selectedId
          const isMulti = multiSelectedIds.has(layer.id)
          const label = getLayerLabel(layer)
          const thumbnail = getLayerThumbnail(layer)
          const isDragOver = dragOverLayerId === layer.id && dragLayerId !== layer.id
          const isRenaming = renamingLayerId === layer.id

          return (
            <LayerRow<L>
              key={layer.id}
              layer={layer}
              isSelected={isSelected}
              isMulti={isMulti}
              isDragOver={isDragOver}
              isDragging={dragLayerId === layer.id}
              isRenaming={isRenaming}
              label={label}
              thumbnail={thumbnail}
              mutate={mutate}
              mapLayer={mapLayer}
              onSelect={ev => {
                ev.stopPropagation()
                if (isRenaming) return
                onSelectLayer(layer.id, ev.metaKey || ev.ctrlKey, ev.shiftKey)
              }}
              onDoubleClick={ev => {
                ev.stopPropagation()
                onStartRename(layer.id)
              }}
              onStartRename={() => onStartRename(layer.id)}
              onEndRename={(newName) => onEndRename(layer.id, newName)}
              onContextMenu={ev => {
                ev.preventDefault()
                ev.stopPropagation()
                onContextMenu(layer.id, ev.clientX, ev.clientY)
              }}
              onDragStart={() => onDragStart(layer.id)}
              onDragOver={ev => { ev.preventDefault(); onDragOver(layer.id) }}
              onDrop={() => onDrop(layer.id)}
              onDragEnd={onDragEnd}
            />
          )
        })}
        {/* Hint shown when only 1 layer — graceful empty space treatment */}
        {project.layers.length === 1 && (
          <p
            style={{
              margin: '8px 4px 4px',
              fontSize: 9,
              lineHeight: 1.6,
              color: EDITOR_TEXT_4,
              textAlign: 'center',
            }}
          >
            Drag to reorder · double-click to rename
          </p>
        )}
        </>
        )}
      </div>
    </div>
  )
}

// ── LayerRow sub-component ────────────────────────────────────────────────────
//
// Redesigned row layout:
//   Primary row (always visible):
//     [28px thumbnail] [name — flex, truncates] [eye 18px] [lock 16px]
//   Secondary row (only when selected/hovered — shows compact controls):
//     [indent 34px] [opacity 34px] [blend — flex] [clip 16px]
//
// Flip H/V is REMOVED from the row — they live in the Properties panel.
// No horizontal scroll. Clean 8px grid.

interface LayerRowInternalProps<L extends { id: string; visible: boolean }> {
  layer: L
  isSelected: boolean
  isMulti: boolean
  isDragOver: boolean
  isDragging: boolean
  isRenaming: boolean
  label: string
  thumbnail: React.ReactNode
  mutate: LayersPanelProps<L>['mutate']
  mapLayer: (
    p: GenericLayerProject<L>,
    id: string,
    fn: (l: L) => L,
  ) => GenericLayerProject<L>
  onSelect: (ev: React.MouseEvent) => void
  onDoubleClick: (ev: React.MouseEvent) => void
  onStartRename: () => void
  onEndRename: (newName: string | null) => void
  onContextMenu: (ev: React.MouseEvent) => void
  onDragStart: () => void
  onDragOver: (ev: React.DragEvent) => void
  onDrop: () => void
  onDragEnd: () => void
}

function LayerRow<L extends { id: string; visible: boolean }>({
  layer,
  isSelected,
  isMulti,
  isDragOver,
  isDragging,
  isRenaming,
  label,
  thumbnail,
  mutate,
  mapLayer,
  onSelect,
  onDoubleClick,
  onEndRename,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: LayerRowInternalProps<L>) {
  const renameRef = useRef<HTMLInputElement>(null)
  const [hovered, setHovered] = useState(false)

  const rowBg = isSelected
    ? `${EDITOR_ACCENT}1a`
    : isMulti
      ? `${EDITOR_ACCENT}12`
      : hovered
        ? 'rgba(255,255,255,0.04)'
        : 'transparent'

  // Secondary row is always rendered (for accessibility + tests), but fades
  // in prominently only when the row is selected, multi-selected, or hovered.
  const secondaryActive = isSelected || isMulti || hovered
  const showSecondary = (layer as { kind?: string }).kind !== 'group'

  const toggleMutate = (fn: (l: L) => L) => {
    mutate(p => mapLayer(p, layer.id, fn))
  }

  return (
    <div
      role="button"
      tabIndex={0}
      draggable={!isRenaming}
      aria-label={label}
      aria-pressed={isSelected || isMulti}
      data-testid={`layer-row-${layer.id}`}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      onKeyDown={ev => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault()
          onSelect(ev as unknown as React.MouseEvent)
        }
      }}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        // Hairline bottom separator between rows; top-of-stack is first (reversed).
        borderBottom: '0.5px solid rgba(255,255,255,0.05)',
        // Left accent bar: 2px solid accent when selected, 2px transparent otherwise
        // so the content doesn't shift on selection. Use borderLeft + paddingLeft trick.
        borderLeft: isDragOver
          ? `2px dashed ${EDITOR_ACCENT}`
          : isSelected
            ? `2px solid ${EDITOR_ACCENT}`
            : isMulti
              ? `2px solid ${EDITOR_ACCENT}66`
              : '2px solid transparent',
        borderRight: 'none',
        borderTop: 'none',
        borderRadius: isSelected || isMulti ? '0 6px 6px 0' : 6,
        background: rowBg,
        padding: '5px 6px 5px 4px',
        opacity: layer.visible ? (isDragging ? 0.45 : 1) : 0.35,
        cursor: 'pointer',
        outline: 'none',
        marginBottom: 1,
        transition: 'background 0.08s, border-left-color 0.08s',
      }}
    >
      {/* ── Primary row: drag handle + thumbnail + name + eye + lock ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          minWidth: 0,
        }}
      >
        {/* Drag handle */}
        <span
          aria-hidden
          style={{
            color: 'rgba(255,255,255,0.20)',
            flexShrink: 0,
            cursor: 'grab',
            display: 'flex',
            alignItems: 'center',
            lineHeight: 1,
          }}
        >
          <GripVertical size={12} />
        </span>

        {/* Thumbnail */}
        <div
          style={{
            width: 28,
            height: 28,
            flexShrink: 0,
            borderRadius: 4,
            background: 'rgba(0,0,0,0.40)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {thumbnail}
        </div>

        {/* Name / inline rename */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {isRenaming ? (
            <input
              ref={renameRef}
              autoFocus
              type="text"
              defaultValue={label}
              data-testid={`rename-input-${layer.id}`}
              onClick={e => e.stopPropagation()}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === 'Escape') {
                  e.preventDefault()
                  const newName =
                    e.key === 'Enter'
                      ? (e.currentTarget as HTMLInputElement).value.trim() || null
                      : null
                  ;(e.currentTarget as HTMLInputElement).dataset.committed = '1'
                  onEndRename(newName)
                }
              }}
              onBlur={e => {
                if (e.currentTarget.dataset.committed) return
                const newName = e.currentTarget.value.trim() || null
                onEndRename(newName)
              }}
              style={{
                width: '100%',
                fontSize: 11,
                background: 'rgba(0,0,0,0.5)',
                border: `1px solid ${EDITOR_ACCENT}66`,
                borderRadius: 3,
                color: '#fff',
                padding: '1px 4px',
                outline: 'none',
              }}
            />
          ) : (
            <span
              title={`${label} — double-click to rename`}
              style={{
                fontSize: 11,
                color: isSelected ? EDITOR_TEXT_2 : EDITOR_TEXT_3,
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                lineHeight: '1.3',
              }}
            >
              {label}
            </span>
          )}
        </div>

        {/* Visibility eye */}
        <button
          type="button"
          title={layer.visible ? 'Hide layer' : 'Show layer'}
          aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
          aria-pressed={!layer.visible}
          data-testid={`visibility-toggle-${layer.id}`}
          onClick={ev => {
            ev.stopPropagation()
            toggleMutate(l => ({ ...l, visible: !l.visible }))
          }}
          style={iconBtn(!layer.visible)}
        >
          {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>

        {/* Lock — always visible in primary row */}
        <button
          type="button"
          title={
            (layer as { lockFlags?: { position?: boolean } }).lockFlags?.position
              ? 'Locked (click to unlock)'
              : 'Click to lock position'
          }
          onClick={ev => {
            ev.stopPropagation()
            toggleMutate(l => ({
              ...l,
              lockFlags: {
                ...((l as { lockFlags?: object }).lockFlags ?? {}),
                position: !((l as { lockFlags?: { position?: boolean } }).lockFlags?.position ?? false),
              },
            }))
          }}
          style={{
            ...iconBtn(!!(layer as { lockFlags?: { position?: boolean } }).lockFlags?.position),
            width: 16,
            height: 16,
          }}
        >
          {(layer as { lockFlags?: { position?: boolean } }).lockFlags?.position ? (
            <Lock size={9} />
          ) : (
            <LockOpen size={9} />
          )}
        </button>
      </div>

      {/* ── Secondary row: opacity + blend + clip ──────────────────────────────
          Always in DOM (accessibility + tests). Fades in when selected/hovered;
          collapsed-height when inactive so rows don't take up permanent height
          for unselected layers. */}
      {showSecondary && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            paddingLeft: 34, // align with name column (28px thumb + 6px gap)
            opacity: secondaryActive ? 1 : 0,
            maxHeight: secondaryActive ? 24 : 0,
            overflow: 'hidden',
            transition: 'opacity 0.1s, max-height 0.1s',
            pointerEvents: secondaryActive ? 'auto' : 'none',
          }}
          onClick={ev => ev.stopPropagation()}
        >
          {/* Compact opacity input */}
          <label
            title="Opacity"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: EDITOR_TEXT_4,
                flexShrink: 0,
              }}
            >
              %
            </span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              aria-label="Layer opacity"
              data-testid={`opacity-input-${layer.id}`}
              value={Math.round(((layer as { opacity?: number }).opacity ?? 1) * 100)}
              onChange={ev => {
                const v = Math.max(0, Math.min(100, parseInt(ev.target.value) || 0)) / 100
                toggleMutate(l => ({ ...l, opacity: v }))
              }}
              onClick={ev => ev.stopPropagation()}
              style={{
                width: 44,
                height: 20,
                background: 'rgba(255,255,255,0.05)',
                border: '0.5px solid rgba(255,255,255,0.12)',
                borderRadius: 4,
                color: EDITOR_TEXT_2,
                fontSize: 10,
                padding: '0 3px',
                outline: 'none',
                appearance: 'textfield',
                MozAppearance: 'textfield',
              }}
            />
          </label>

          {/* Compact blend mode select */}
          <select
            aria-label="Blend mode"
            data-testid={`blend-select-${layer.id}`}
            value={(layer as { blendMode?: BlendMode }).blendMode ?? 'normal'}
            onChange={ev => {
              ev.stopPropagation()
              const next = ev.target.value as BlendMode
              toggleMutate(l => ({ ...l, blendMode: next === 'normal' ? undefined : next }))
            }}
            onClick={ev => ev.stopPropagation()}
            style={{
              flex: 1,
              minWidth: 0,
              height: 20,
              background: 'rgba(20,20,20,0.72)',
              border: '0.5px solid rgba(255,255,255,0.12)',
              borderRadius: 4,
              color: EDITOR_TEXT_2,
              fontSize: 9,
              padding: '0 2px',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            {BLEND_MODES.map(mode => (
              <option key={mode} value={mode} style={{ background: '#1a1c22' }}>
                {blendLabel(mode)}
              </option>
            ))}
          </select>

          {/* Clip-to-below */}
          <button
            type="button"
            title={
              (layer as { clippedToLayerBelow?: boolean }).clippedToLayerBelow
                ? 'Clipped to layer below'
                : 'Click to clip to layer below'
            }
            data-testid={`clip-toggle-${layer.id}`}
            onClick={ev => {
              ev.stopPropagation()
              toggleMutate(l =>
                (l as { kind?: string }).kind === 'group'
                  ? l
                  : {
                      ...l,
                      clippedToLayerBelow:
                        !(l as { clippedToLayerBelow?: boolean }).clippedToLayerBelow || undefined,
                    },
              )
            }}
            style={{
              ...iconBtn(!!(layer as { clippedToLayerBelow?: boolean }).clippedToLayerBelow),
              width: 16,
              height: 16,
            }}
          >
            <CornerDownLeft size={9} />
          </button>
        </div>
      )}
    </div>
  )
}
