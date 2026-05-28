import { useEffect, useRef } from 'react'
import { addImageFromFile, type Coh2SkinProject } from '@/lib/project'

interface Props {
  project: Coh2SkinProject
  setProject: (p: Coh2SkinProject) => void
  /** When the user drops/picks an image, we add it to the library AND
   *  switch placement mode to image, ready for the next click on the tank. */
  onImageReady: (imageId: string) => void
  toast: (msg: string, kind?: 'info' | 'error' | 'success') => void
}

/** Manages the user's custom decal images. Drag-drop, paste from clipboard,
 *  or file-picker — all three accepted. The thumbnail grid below lets the
 *  user re-pick an existing image to drop again. */
export default function ImageLibrary({ project, setProject, onImageReady, toast }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<HTMLDivElement>(null)

  const importFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast('Not an image file', 'error')
      return
    }
    const copy = structuredClone(project)
    try {
      const id = await addImageFromFile(copy, file)
      setProject(copy)
      onImageReady(id)
      toast(`Imported ${file.name}`, 'success')
    } catch (err: unknown) {
      toast((err as { message?: string })?.message ?? 'Import failed', 'error')
    }
  }

  // Document-level paste handler — adds clipboard images to the library
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file && file.type.startsWith('image/')) {
            e.preventDefault()
            await importFile(file)
            return
          }
        }
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project])

  const onDragOver = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.items).some(i => i.kind === 'file')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    dragRef.current?.classList.add('ring-2', 'ring-[var(--color-accent)]', 'bg-orange-500/10')
  }
  const onDragLeave = () => dragRef.current?.classList.remove('ring-2', 'ring-[var(--color-accent)]', 'bg-orange-500/10')
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    onDragLeave()
    const file = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('image/'))
    if (file) await importFile(file)
  }

  const images = Object.values(project.images ?? {})

  return (
    <div>
      <div
        ref={dragRef}
        role="button"
        aria-label="Drop image or click to browse"
        tabIndex={0}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            fileInputRef.current?.click()
          }
        }}
        className="rounded-xl border border-dashed border-white/15 px-3 py-5 text-center cursor-pointer
                   bg-black/20 hover:bg-black/30 hover:border-white/25 transition"
      >
        <div className="text-[11px] text-[var(--color-text-2)]">
          <div className="font-medium text-white mb-0.5">Drop an image here</div>
          <div>or click to browse · or paste from clipboard</div>
        </div>
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
        onChange={async e => {
          const f = e.target.files?.[0]; if (!f) return
          await importFile(f); e.target.value = ''
        }}
      />

      {images.length > 0 && (
        <div className="mt-3">
          <div className="text-[9px] uppercase tracking-[2px] text-[var(--color-text-3)] font-semibold mb-2">
            Library ({images.length})
          </div>
          <div className="grid grid-cols-4 gap-1.5 max-h-32 overflow-y-auto">
            {images.map(img => (
              <div key={img.id} className="relative group">
                <button
                  onClick={() => onImageReady(img.id)}
                  title={img.name}
                  className="relative aspect-square w-full rounded-lg overflow-hidden bg-black/40
                             border border-white/10 hover:border-[var(--color-accent)] transition">
                  <img src={img.dataUrl} alt={img.name} className="w-full h-full object-contain" />
                </button>
                <button
                  onClick={e => {
                    e.stopPropagation()
                    const copy = structuredClone(project)
                    delete copy.images[img.id]
                    for (const v of Object.values(copy.vehicles)) {
                      v.decals = v.decals.filter(d => d.imageId !== img.id)
                    }
                    setProject(copy)
                  }}
                  className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/70 text-white/70
                             opacity-0 group-hover:opacity-100 hover:bg-red-500 hover:text-white text-[10px] leading-none"
                  title={`Delete ${img.name}`}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
