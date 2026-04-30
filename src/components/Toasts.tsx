import { useEffect, useState } from 'react'

export type ToastKind = 'info' | 'success' | 'error'
export interface ToastItem { id: number; msg: string; kind: ToastKind }

export interface ToastApi {
  push: (msg: string, kind?: ToastKind) => void
}

let nextId = 1

/** Lightweight toast system. Renders a stack at the top-centre of the
 *  viewport. Auto-dismisses after 3.5s. */
export function useToasts(): { api: ToastApi; node: React.ReactNode } {
  const [items, setItems] = useState<ToastItem[]>([])
  const push: ToastApi['push'] = (msg, kind = 'info') => {
    setItems(xs => [...xs, { id: nextId++, msg, kind }])
  }
  // Tick: drop items older than 3.5s
  useEffect(() => {
    if (!items.length) return
    const t = setTimeout(() => setItems(xs => xs.slice(1)), 3500)
    return () => clearTimeout(t)
  }, [items])

  const node = (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 pointer-events-none">
      {items.map(t => (
        <div key={t.id}
          className={`px-4 py-2 rounded-xl text-[12px] font-medium pointer-events-auto
                      shadow-lg backdrop-blur-md animate-[in_180ms_cubic-bezier(.2,.8,.2,1)]
                      ${t.kind === 'success' ? 'bg-emerald-600/30 border border-emerald-400/50 text-emerald-100' :
                         t.kind === 'error'   ? 'bg-red-700/40 border border-red-400/50 text-red-100' :
                                                'bg-black/60 border border-white/10 text-white'}`}>
          {t.msg}
        </div>
      ))}
    </div>
  )
  return { api: { push }, node }
}
