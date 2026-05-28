/**
 * TokensPreview — in-app design token gallery.
 *
 * Visit localhost:5173/#tokens (or app://tokens in Electron) to see every
 * design token at a glance. Intended for screenshot-driven design reviews;
 * do NOT use Claude Preview / Chrome MCP tools (they grab the cursor).
 *
 * Usage: hash-based route wired in App.tsx.
 */

import { useState } from 'react'

// ── Colour tokens (mirrored from @theme in index.css) ────────────────────────
const COLOR_TOKENS: { name: string; value: string }[] = [
  { name: '--color-app-bg', value: 'oklch(0.155 0.015 260)' },
  { name: '--color-app-bg-deep', value: 'oklch(0.115 0.013 260)' },
  { name: '--color-glass-1', value: 'rgb(255 255 255 / 0.04)' },
  { name: '--color-glass-2', value: 'rgb(255 255 255 / 0.07)' },
  { name: '--color-glass-3', value: 'rgb(255 255 255 / 0.10)' },
  { name: '--color-glass-4', value: 'rgb(255 255 255 / 0.14)' },
  { name: '--color-stroke-1', value: 'rgb(255 255 255 / 0.06)' },
  { name: '--color-stroke-2', value: 'rgb(255 255 255 / 0.10)' },
  { name: '--color-stroke-3', value: 'rgb(255 255 255 / 0.18)' },
  { name: '--color-text-1', value: 'oklch(0.97 0.005 260)' },
  { name: '--color-text-2', value: 'oklch(0.78 0.010 260)' },
  { name: '--color-text-3', value: 'oklch(0.60 0.015 260)' },
  { name: '--color-accent', value: 'oklch(0.66 0.180 45)' },
  { name: '--color-accent-soft', value: 'oklch(0.66 0.180 45 / 0.20)' },
  { name: '--color-accent-strong', value: 'oklch(0.72 0.220 45)' },
  { name: '--color-blue', value: 'oklch(0.70 0.180 245)' },
  { name: '--color-green', value: 'oklch(0.74 0.180 145)' },
  { name: '--color-red', value: 'oklch(0.66 0.220 25)' },
]

const RADIUS_TOKENS: { name: string; label: string; value: string }[] = [
  { name: '--radius-card', label: 'card (18px)', value: '18px' },
  { name: '--radius-panel', label: 'panel (22px)', value: '22px' },
  { name: '--radius-pill', label: 'pill (9999px)', value: '9999px' },
  { name: '--radius-input', label: 'input (10px)', value: '10px' },
]

const SPACING_TOKENS: { name: string; px: number }[] = [
  { name: '--space-1', px: 4 },
  { name: '--space-2', px: 8 },
  { name: '--space-3', px: 12 },
  { name: '--space-4', px: 16 },
  { name: '--space-5', px: 24 },
  { name: '--space-6', px: 32 },
  { name: '--space-7', px: 48 },
  { name: '--space-8', px: 64 },
]

const DURATION_TOKENS: { name: string; ms: number }[] = [
  { name: '--dur-instant', ms: 120 },
  { name: '--dur-fast', ms: 180 },
  { name: '--dur-med', ms: 320 },
  { name: '--dur-slow', ms: 500 },
  { name: '--dur-slower', ms: 800 },
]

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      <h2
        style={{
          color: 'var(--color-text-3)',
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          marginBottom: '16px',
          paddingBottom: '8px',
          borderBottom: '0.5px solid var(--color-stroke-1)',
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  )
}

function ColorSwatch({ name, value }: { name: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '120px' }}>
      <div
        style={{
          width: '100%',
          height: '56px',
          background: `var(${name})`,
          borderRadius: '8px',
          border: '0.5px solid var(--color-stroke-2)',
        }}
      />
      <span style={{ color: 'var(--color-text-2)', fontSize: '11px', fontWeight: 500 }}>
        {name}
      </span>
      <span style={{ color: 'var(--color-text-3)', fontSize: '10px', wordBreak: 'break-all' }}>
        {value}
      </span>
    </div>
  )
}

// The chaotic backdrop used to reveal glass blur/saturate effects
const CHAOS_BACKDROP = `
  linear-gradient(135deg,
    oklch(0.55 0.30 30) 0%,
    oklch(0.50 0.28 200) 20%,
    oklch(0.60 0.25 120) 40%,
    oklch(0.45 0.32 280) 60%,
    oklch(0.62 0.28 45) 80%,
    oklch(0.50 0.30 340) 100%
  )
`.trim()

function GlassSwatch({ label, utilityClass }: { label: string; utilityClass: string }) {
  return (
    <div
      style={{
        position: 'relative',
        width: '200px',
        height: '120px',
        borderRadius: '12px',
        overflow: 'hidden',
      }}
    >
      {/* Chaotic backdrop */}
      <div style={{ position: 'absolute', inset: 0, background: CHAOS_BACKDROP }} />
      {/* Glass layer */}
      <div
        className={utilityClass}
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ color: 'var(--color-text-1)', fontSize: '13px', fontWeight: 500 }}>
          {label}
        </span>
      </div>
    </div>
  )
}

function ShadowSwatch({ label, shadow }: { label: string; shadow: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
      <div
        style={{
          width: '120px',
          height: '80px',
          background: 'var(--color-app-bg)',
          borderRadius: '12px',
          boxShadow: shadow,
          border: '0.5px solid var(--color-stroke-2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ color: 'var(--color-text-3)', fontSize: '11px' }}>{label}</span>
      </div>
    </div>
  )
}

function MotionButton({ name, ms }: { name: string; ms: number }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={
        {
          padding: '8px 16px',
          borderRadius: '8px',
          border: '0.5px solid var(--color-stroke-2)',
          color: 'var(--color-text-1)',
          fontSize: '12px',
          cursor: 'pointer',
          transition: `transform ${ms}ms var(--ease-snap), background ${ms}ms var(--ease-snap)`,
          transform: hovered ? 'translateY(-6px)' : 'translateY(0)',
          background: hovered ? 'var(--color-glass-3)' : 'var(--color-glass-2)',
          minWidth: '140px',
        } as React.CSSProperties
      }
    >
      <div style={{ color: 'var(--color-accent)', fontWeight: 600, marginBottom: '2px' }}>
        {name}
      </div>
      <div style={{ color: 'var(--color-text-3)', fontSize: '10px' }}>{ms}ms — hover me</div>
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TokensPreview() {
  return (
    <div
      style={{
        minHeight: '100dvh',
        background: 'var(--color-app-bg-deep)',
        color: 'var(--color-text-1)',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif',
        WebkitFontSmoothing: 'antialiased',
        position: 'relative',
        overflowX: 'hidden',
      }}
    >
      {/* Faction emblems floating in background for visual chaos */}
      {(['soviet', 'german', 'british', 'aef', 'west_german'] as const).map((f, i) => (
        <img
          key={f}
          src={`/factions/${f}.png`}
          alt=""
          aria-hidden="true"
          style={{
            position: 'fixed',
            width: '280px',
            height: '280px',
            objectFit: 'contain',
            opacity: 0.06,
            pointerEvents: 'none',
            top: `${[8, 40, 65, 20, 55][i]}%`,
            left: `${[5, 70, 30, 85, 50][i]}%`,
            transform: `rotate(${[-15, 12, -8, 20, -5][i]}deg)`,
          }}
        />
      ))}

      {/* Content */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          maxWidth: '960px',
          margin: '0 auto',
          padding: '48px 32px',
        }}
      >
        <h1
          style={{
            fontSize: '28px',
            fontWeight: 700,
            color: 'var(--color-text-1)',
            marginBottom: '6px',
          }}
        >
          Design Token Gallery
        </h1>
        <p style={{ color: 'var(--color-text-3)', fontSize: '14px', marginBottom: '48px' }}>
          CoH2 Community Modding Tool — dark iOS glassmorphism. Hash route: <code>#tokens</code>
        </p>

        {/* ── Colors ── */}
        <Section title="Color tokens">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
            {COLOR_TOKENS.map(t => (
              <ColorSwatch key={t.name} name={t.name} value={t.value} />
            ))}
          </div>
        </Section>

        {/* ── Glass layers ── */}
        <Section title="Glass layers (over busy backdrop)">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
            <GlassSwatch label="glass-1 (32px / 65%)" utilityClass="glass-1" />
            <GlassSwatch label="glass-2 (36px / 72%)" utilityClass="glass-2" />
            <GlassSwatch label="glass-3 (44px / 80%)" utilityClass="glass-3" />
            <GlassSwatch label="glass-4 (48px / 86%)" utilityClass="glass-4" />
          </div>
        </Section>

        {/* ── Text scale ── */}
        <Section title="Text scale">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ color: 'var(--color-text-1)', fontSize: '20px', fontWeight: 600 }}>
              text-1 · Primary — oklch(0.97 0.005 260)
            </div>
            <div style={{ color: 'var(--color-text-2)', fontSize: '16px' }}>
              text-2 · Secondary — oklch(0.78 0.010 260)
            </div>
            <div style={{ color: 'var(--color-text-3)', fontSize: '13px' }}>
              text-3 · Tertiary / disabled — oklch(0.60 0.015 260)
            </div>
          </div>
        </Section>

        {/* ── Radii ── */}
        <Section title="Border radius">
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            {RADIUS_TOKENS.map(r => (
              <div
                key={r.name}
                style={{
                  width: '120px',
                  height: '72px',
                  background: 'var(--color-glass-2)',
                  border: '0.5px solid var(--color-stroke-2)',
                  borderRadius: r.value,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'column',
                  gap: '4px',
                }}
              >
                <span style={{ color: 'var(--color-text-2)', fontSize: '11px', fontWeight: 500 }}>
                  {r.name}
                </span>
                <span style={{ color: 'var(--color-text-3)', fontSize: '10px' }}>{r.label}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Shadows ── */}
        <Section title="Shadows">
          <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap' }}>
            <ShadowSwatch
              label="shadow-glass"
              shadow="0 8px 32px rgb(0 0 0 / 0.40), 0 1px 0 rgb(255 255 255 / 0.04) inset"
            />
            <ShadowSwatch
              label="shadow-pop"
              shadow="0 24px 64px rgb(0 0 0 / 0.55), 0 1px 0 rgb(255 255 255 / 0.06) inset"
            />
          </div>
        </Section>

        {/* ── Motion ── */}
        <Section title="Motion — duration tokens (hover to animate)">
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {DURATION_TOKENS.map(d => (
              <MotionButton key={d.name} name={d.name} ms={d.ms} />
            ))}
          </div>
          <p style={{ color: 'var(--color-text-3)', fontSize: '11px', marginTop: '12px' }}>
            Note: --ease-* and --dur-* tokens are accessible via <code>var(--ease-snap)</code> in
            inline styles and arbitrary Tailwind values like{' '}
            <code>transition-[var(--dur-med)]</code>. Tailwind v4 does not auto-generate utilities
            for these prefixes.
          </p>
        </Section>

        {/* ── Spacing ── */}
        <Section title="Spacing — 8pt Apple grid">
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {SPACING_TOKENS.map(s => (
              <div
                key={s.name}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <div
                  style={{
                    width: `${s.px}px`,
                    height: `${s.px}px`,
                    background: 'var(--color-accent)',
                    borderRadius: '3px',
                    opacity: 0.8,
                  }}
                />
                <span style={{ color: 'var(--color-text-3)', fontSize: '10px' }}>{s.name}</span>
                <span style={{ color: 'var(--color-text-2)', fontSize: '10px', fontWeight: 600 }}>
                  {s.px}px
                </span>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Accent discipline ── */}
        <Section title="Accent — Brigade orange (use sparingly)">
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              style={{
                padding: '10px 20px',
                borderRadius: '10px',
                background: 'var(--color-accent)',
                color: '#fff',
                fontWeight: 600,
                fontSize: '13px',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Primary CTA (one per modal)
            </button>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '8px',
                background: 'var(--color-glass-2)',
                border: '0.5px solid var(--color-stroke-2)',
                fontSize: '13px',
                color: 'var(--color-text-1)',
              }}
            >
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: 'var(--color-accent)',
                  display: 'inline-block',
                }}
              />
              Dirty indicator
            </div>
            <div
              style={{
                background: 'var(--color-accent-soft)',
                border: '0.5px solid var(--color-accent)',
                borderRadius: '8px',
                padding: '6px 12px',
                color: 'var(--color-accent-strong)',
                fontSize: '13px',
              }}
            >
              accent-soft tint
            </div>
          </div>
        </Section>
      </div>
    </div>
  )
}
