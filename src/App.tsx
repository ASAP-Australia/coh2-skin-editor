import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

/**
 * Glassmorphism scaffold — establishes the visual baseline. Real surfaces
 * (vehicle picker, 3D viewport, decal tray, export panel) get progressively
 * swapped in as separate routes.
 */
export default function App() {
  return (
    <div className="min-h-dvh w-full p-6 lg:p-10 flex flex-col gap-6">
      <Header />
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[280px_1fr_320px] gap-6 min-h-0">
        <SidebarPlaceholder />
        <ViewportPlaceholder />
        <InspectorPlaceholder />
      </main>
    </div>
  )
}

function Header() {
  return (
    <header className="glass-2 rounded-[var(--radius-panel)] px-6 py-4 flex items-center justify-between shadow-[var(--shadow-glass)]">
      <div className="flex items-center gap-3">
        <div className="size-9 rounded-xl bg-[var(--color-accent)] grid place-items-center text-[15px] font-bold text-black">
          C
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[2px] text-[var(--color-text-3)]">
            Company of Heroes 2
          </div>
          <div className="text-[15px] font-semibold tracking-tight">
            Skin Editor <span className="text-[var(--color-text-3)] font-normal">— community</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Pill>Local-first</Pill>
        <Pill>No uploads</Pill>
        <Button size="sm" className="rounded-full px-4">Open vehicle</Button>
      </div>
    </header>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] uppercase tracking-[1.5px] px-2.5 py-1 rounded-full glass-1 text-[var(--color-text-2)]">
      {children}
    </span>
  )
}

function SidebarPlaceholder() {
  return (
    <aside className="glass-2 rounded-[var(--radius-panel)] p-4 shadow-[var(--shadow-glass)] flex flex-col gap-3 overflow-y-auto">
      <SectionHeading>Vehicles</SectionHeading>
      {[
        ['Tiger I', '211'],
        ['King Tiger', '311'],
        ['Panther', '221'],
        ['Brummbär', '131'],
        ['StuG III', '141'],
        ['Sd.Kfz. 251', '151'],
      ].map(([name, tac], i) => (
        <button
          key={name}
          className={`text-left rounded-xl px-3 py-2.5 transition flex items-center justify-between
            ${i === 0 ? 'glass-3 ring-1 ring-[var(--color-accent)]' : 'hover:glass-2'}`}
        >
          <span className="text-[13px] font-medium">{name}</span>
          <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded-md bg-black/30 text-[var(--color-text-2)]">
            {tac}
          </span>
        </button>
      ))}
      <div className="text-[10px] text-[var(--color-text-3)] mt-auto pt-3 leading-relaxed">
        Models load from your local Company of Heroes 2 Tools install.
        Nothing is uploaded.
      </div>
    </aside>
  )
}

function ViewportPlaceholder() {
  return (
    <Card className="glass-2 border-0 rounded-[var(--radius-panel)] shadow-[var(--shadow-glass)] overflow-hidden p-0">
      <CardContent className="p-0 h-full grid place-items-center min-h-[400px] relative">
        <div
          className="absolute inset-6 rounded-[var(--radius-card)] grid place-items-center"
          style={{
            background:
              'radial-gradient(ellipse at 50% 50%, rgba(255,255,255,0.04), transparent 60%)',
          }}
        >
          <div className="text-center max-w-md px-6">
            <div className="text-[11px] uppercase tracking-[2px] text-[var(--color-text-3)] mb-2">
              3D Viewport
            </div>
            <h2 className="text-2xl font-semibold tracking-tight mb-3">
              Drop a vehicle into the workspace
            </h2>
            <p className="text-[13px] leading-relaxed text-[var(--color-text-2)]">
              Open a vehicle from the sidebar to load its FBX mesh and PBR
              maps from your local CoH2 Tools install. Click anywhere on the
              tank to place a decal — shield, bortnummer, name, or kill rings.
            </p>
            <div className="mt-5 flex gap-2 justify-center">
              <Button size="sm" variant="secondary" className="rounded-full">Tutorial</Button>
              <Button size="sm" className="rounded-full">Open vehicle</Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function InspectorPlaceholder() {
  return (
    <aside className="glass-2 rounded-[var(--radius-panel)] p-4 shadow-[var(--shadow-glass)] flex flex-col gap-4 overflow-y-auto">
      <SectionHeading>Place decals</SectionHeading>
      <div className="grid grid-cols-2 gap-2">
        {['Shield', 'Number', 'Name', 'Kills'].map((t, i) => (
          <button
            key={t}
            className={`rounded-xl px-3 py-3 text-[12px] font-medium transition
              ${i === 0 ? 'bg-[var(--color-accent)] text-black' : 'glass-1 hover:glass-2'}`}
          >
            + {t}
          </button>
        ))}
      </div>

      <SectionHeading>Active decal</SectionHeading>
      <RangeRow label="Rotation" suffix="°" />
      <RangeRow label="Size" suffix="px" />

      <div className="mt-auto flex flex-col gap-2 pt-3">
        <Button className="rounded-xl bg-[var(--color-accent)] text-black hover:bg-[var(--color-accent-strong)]">
          Save & export
        </Button>
        <Button variant="ghost" className="rounded-xl text-[var(--color-text-2)]">
          Reset placements
        </Button>
      </div>
    </aside>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-[2px] text-[var(--color-accent)] font-semibold">
      {children}
    </div>
  )
}

function RangeRow({ label, suffix }: { label: string; suffix: string }) {
  return (
    <label className="block">
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-[var(--color-text-2)]">{label}</span>
        <span className="text-[var(--color-text-1)] tabular-nums">0{suffix}</span>
      </div>
      <input
        type="range"
        defaultValue={0}
        className="w-full appearance-none h-1.5 rounded-full bg-white/10 accent-[var(--color-accent)]
                   [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-4
                   [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
                   [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:cursor-pointer"
      />
    </label>
  )
}
