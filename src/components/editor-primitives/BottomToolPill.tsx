/**
 * BottomToolPill — Apple-style segmented control that holds editor tools.
 *
 * Surface is the shared `glass-hud` utility (index.css) — the same recipe
 * VehicleMenu / ScenePanel / FactionPanel use, so every floating dock & rail
 * stays visually coherent from one source of truth. The active segment uses
 * the "selected pill" ring + tinted fill so the active tool reads as picked
 * without anchoring colour to the brand orange.
 *
 * Each tool is rendered as a 56×56 rounded-xl segment with an icon and a
 * 10px caption underneath — the same height as VehicleMenu pills minus
 * the 8px caption strip (we keep the caption inside the segment instead
 * of overflowing it). Segments are siblings inside a horizontally
 * scrollable rail so the pill stays unchanged as the tool list grows.
 *
 * The pill is meant to dock bottom-center; positioning is the parent's
 * responsibility (typically `position: fixed; bottom: 24px; left: 50%;
 * transform: translateX(-50%)`).
 *
 * Empty tool lists short-circuit to `null` — callers don't need to guard.
 */

import type { CSSProperties, ReactNode } from 'react'

export interface ToolDef<TId extends string = string> {
  id: TId
  /** Lucide icon node (or any 18-22px ReactNode that paints in currentColor). */
  icon: ReactNode
  /** Short label (≤8 chars reads cleanest at 10px). */
  label: string
  /** Optional accessible title — defaults to `label`. */
  title?: string
}

/**
 * Toggle-style segment that sits inside the same pill as the tool buttons
 * but does NOT participate in the `activeId` group. Use this for binary
 * preview toggles (eye / show-checker / etc) that are visually part of the
 * tool rail but semantically independent — clicking flips `pressed`
 * instead of selecting a tool.
 *
 * Renders to the right of the tools, separated by a hairline divider so
 * the user reads it as "different category, same pill family".
 */
export interface ToolExtra {
  id: string
  icon: ReactNode
  label: string
  title?: string
  pressed: boolean
  onClick: () => void
  /** Optional dataset attribute for tests (mirrors the standalone button). */
  testId?: string
}

interface Props<TId extends string> {
  tools: readonly ToolDef<TId>[]
  activeId: TId | null
  onSelect: (id: TId) => void
  /** Toggle-style buttons rendered after the tools, sharing the pill. */
  extras?: readonly ToolExtra[]
  /** Inline style override — primarily for positioning. */
  style?: CSSProperties
  /** Optional extra className for the outer rail. */
  className?: string
}

export default function BottomToolPill<TId extends string>({
  tools,
  activeId,
  onSelect,
  extras,
  style,
  className,
}: Props<TId>) {
  if (tools.length === 0 && (!extras || extras.length === 0)) return null

  // Surface recipe lives in the `glass-hud` utility (index.css) so every
  // floating dock/rail shares one source of truth. `style` stays free for
  // the caller's positioning overrides.
  return (
    <div
      role="toolbar"
      aria-label="Editor tools"
      className={
        'glass-hud rounded-2xl px-2 py-1.5 flex items-center gap-0 max-w-[min(85vw,640px)] overflow-x-auto [&::-webkit-scrollbar]:h-0' +
        (className ? ' ' + className : '')
      }
      style={style}
    >
      {tools.map(tool => {
        const isActive = activeId === tool.id
        return (
          <button
            key={tool.id}
            type="button"
            data-id={tool.id}
            onClick={() => onSelect(tool.id)}
            title={tool.title ?? tool.label}
            aria-label={tool.title ?? tool.label}
            aria-pressed={isActive}
            className={
              'relative shrink-0 mx-0.5 rounded-xl transition-all duration-150 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-white/70 ' +
              (isActive
                ? 'l01-ring bg-[rgba(186,150,90,0.22)] shadow-[inset_0_0_0_1.5px_rgba(186,150,90,0.85),0_4px_12px_rgba(0,0,0,0.4)] text-white'
                : 'hover:bg-white/10 text-[var(--color-text-2)] hover:text-white')
            }
            style={{ width: 56, height: 56, padding: 4 }}
          >
            <div className="w-full h-full flex flex-col items-center justify-center gap-0.5">
              <span aria-hidden className="flex items-center justify-center">
                {tool.icon}
              </span>
              <span className="font-mono text-[10px] leading-none font-medium tracking-tight select-none">
                {tool.label}
              </span>
            </div>
          </button>
        )
      })}

      {/* Extras — toggle-style buttons (eye preview, etc.) separated from
          the tool group by a hairline so the user reads them as a distinct
          category that happens to share the pill. */}
      {extras && extras.length > 0 && tools.length > 0 && (
        <span aria-hidden className="shrink-0 mx-1 self-stretch w-px my-2 bg-white/10" />
      )}
      {extras?.map(extra => (
        <button
          key={extra.id}
          type="button"
          data-id={extra.id}
          data-testid={extra.testId}
          onClick={extra.onClick}
          title={extra.title ?? extra.label}
          aria-label={extra.title ?? extra.label}
          aria-pressed={extra.pressed}
          className={
            'relative shrink-0 mx-0.5 rounded-xl transition-all duration-150 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-white/70 ' +
            (extra.pressed
              ? 'l01-ring bg-[rgba(186,150,90,0.22)] shadow-[inset_0_0_0_1.5px_rgba(186,150,90,0.85),0_4px_12px_rgba(0,0,0,0.4)] text-white'
              : 'hover:bg-white/10 text-[var(--color-text-2)] hover:text-white')
          }
          style={{ width: 56, height: 56, padding: 4 }}
        >
          <div className="w-full h-full flex flex-col items-center justify-center gap-0.5">
            <span aria-hidden className="flex items-center justify-center">
              {extra.icon}
            </span>
            <span className="text-[10px] leading-none font-medium tracking-tight select-none">
              {extra.label}
            </span>
          </div>
        </button>
      ))}
    </div>
  )
}
