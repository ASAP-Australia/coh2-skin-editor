/**
 * Tests for ImageLibrary — the custom-decal-image upload + grid panel.
 *
 * Pinned contract:
 *   1. Dropzone is a real keyboard target: role="button", aria-label,
 *      tabIndex=0. Clicking it opens the hidden file picker.
 *   2. Enter and Space on the dropzone also open the file picker
 *      (a11y — keyboard parity with the click handler).
 *   3. A hidden `<input type="file" accept="image/*">` is rendered so
 *      the browser file picker filters to images.
 *   4. Empty `project.images` → NO "Library" header rendered. Filled
 *      project → header shows the count `Library (N)` and one
 *      thumbnail per image with the image's `name` as the title.
 *   5. Clicking a thumbnail fires `onImageReady(imageId)`.
 *   6. Clicking the delete-X chip removes the image from
 *      `project.images` AND strips any decals across every vehicle
 *      that reference that imageId. Both side-effects matter — a
 *      lingering decal referencing a deleted image would render as a
 *      broken thumbnail in the next save.
 *   7. Non-image file dropped → toast("Not an image file", "error")
 *      and NO project mutation.
 *   8. Valid image file dropped → addImageFromFile is invoked, the new
 *      image lands in `project.images`, and `onImageReady(newId)`
 *      fires so the next click on the tank stamps it.
 *   9. Dragging an image file over the zone adds the orange-accent
 *      ring class (visual cue); dragging off removes it. Dragging a
 *      non-file (e.g. text) does NOT add the ring (no preventDefault).
 *
 * Test infra: React 19 createRoot + act. `addImageFromFile` is mocked
 * at the module level so we don't have to wrangle FileReader / Image
 * loading inside jsdom.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

import ImageLibrary from '../ImageLibrary'
import { newProject, type Coh2SkinProject, type CustomImage } from '@/lib/project'

// ── Mock addImageFromFile so we don't depend on FileReader in jsdom ───────────
vi.mock('@/lib/project', async orig => {
  const actual = await orig<typeof import('@/lib/project')>()
  return {
    ...actual,
    addImageFromFile: vi.fn(async (p: Coh2SkinProject, file: File) => {
      const id = 'img_test_' + Math.random().toString(36).slice(2, 8)
      p.images[id] = {
        id,
        name: file.name || 'pasted-image',
        dataUrl: 'data:image/png;base64,AAAA',
        width: 100,
        height: 100,
      }
      return id
    }),
  }
})

// ── Render harness ────────────────────────────────────────────────────────────

let container: HTMLDivElement | null = null
let root: Root | null = null

interface RenderProps {
  project?: Coh2SkinProject
  setProject?: (p: Coh2SkinProject) => void
  onImageReady?: (id: string) => void
  toast?: (msg: string, kind?: 'info' | 'error' | 'success') => void
}

function render(props: RenderProps = {}) {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
  act(() => {
    root!.render(
      createElement(ImageLibrary, {
        project: props.project ?? newProject('Test Pack'),
        setProject: props.setProject ?? (() => {}),
        onImageReady: props.onImageReady ?? (() => {}),
        toast: props.toast ?? (() => {}),
      }),
    )
  })
  return container!
}

function dropzone(): HTMLElement {
  return container!.querySelector('[role="button"][aria-label]') as HTMLElement
}

function fileInput(): HTMLInputElement {
  return container!.querySelector('input[type="file"]') as HTMLInputElement
}

function libraryButtons(): HTMLButtonElement[] {
  // Thumbnail buttons sit under the "Library (N)" header. Pick the ones
  // that contain an <img> child (delete X buttons hold only a "×" char).
  return Array.from(container!.querySelectorAll('button')).filter(
    b => b.querySelector('img') != null,
  ) as HTMLButtonElement[]
}

function deleteButtons(): HTMLButtonElement[] {
  return Array.from(container!.querySelectorAll('button')).filter(
    b => b.textContent?.trim() === '×',
  ) as HTMLButtonElement[]
}

function makeImageFile(name = 'sample.png') {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })
}

function makeTextFile(name = 'notes.txt') {
  return new File(['hello'], name, { type: 'text/plain' })
}

function projectWithImages(images: CustomImage[]): Coh2SkinProject {
  const p = newProject('Has Images')
  for (const img of images) p.images[img.id] = img
  return p
}

function img(id: string, overrides: Partial<CustomImage> = {}): CustomImage {
  return {
    id,
    name: `${id}.png`,
    dataUrl: 'data:image/png;base64,AAAA',
    width: 64,
    height: 64,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  if (root) {
    act(() => root!.unmount())
    root = null
  }
  if (container) {
    container.remove()
    container = null
  }
  vi.restoreAllMocks()
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ImageLibrary — dropzone shell', () => {
  it('renders the dropzone with role="button", aria-label, and tabIndex=0', () => {
    render()
    const dz = dropzone()
    expect(dz).not.toBeNull()
    expect(dz.getAttribute('role')).toBe('button')
    expect(dz.getAttribute('aria-label')).toBe('Drop image or click to browse')
    expect(dz.getAttribute('tabindex')).toBe('0')
  })

  it('renders a hidden image-only file input', () => {
    render()
    const input = fileInput()
    expect(input).not.toBeNull()
    expect(input.type).toBe('file')
    expect(input.accept).toBe('image/*')
    expect(input.className).toContain('hidden')
  })

  it('clicking the dropzone forwards to the file input click()', () => {
    render()
    const input = fileInput()
    const click = vi.spyOn(input, 'click')
    act(() => {
      dropzone().click()
    })
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('Enter on the dropzone opens the file picker', () => {
    render()
    const input = fileInput()
    const click = vi.spyOn(input, 'click')
    act(() => {
      dropzone().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('Space on the dropzone opens the file picker (a11y parity)', () => {
    render()
    const input = fileInput()
    const click = vi.spyOn(input, 'click')
    act(() => {
      dropzone().dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    })
    expect(click).toHaveBeenCalledTimes(1)
  })
})

describe('ImageLibrary — library grid', () => {
  it('omits the "Library" header when project.images is empty', () => {
    render()
    expect(container!.textContent).not.toContain('Library')
  })

  it('shows "Library (N)" header + thumbnails when project.images is populated', () => {
    const p = projectWithImages([img('img_a'), img('img_b'), img('img_c')])
    render({ project: p })
    expect(container!.textContent).toContain('Library (3)')
    expect(libraryButtons()).toHaveLength(3)
  })

  it('each thumbnail carries the image name as its title and renders its dataUrl', () => {
    const p = projectWithImages([img('img_a', { name: 'tank-stripe.png' })])
    render({ project: p })
    const btn = libraryButtons()[0]
    expect(btn.getAttribute('title')).toBe('tank-stripe.png')
    const inner = btn.querySelector('img')!
    expect(inner.getAttribute('src')).toBe('data:image/png;base64,AAAA')
    expect(inner.getAttribute('alt')).toBe('tank-stripe.png')
  })

  it('clicking a thumbnail fires onImageReady(imageId)', () => {
    const onImageReady = vi.fn()
    const p = projectWithImages([img('img_zz')])
    render({ project: p, onImageReady })
    act(() => {
      libraryButtons()[0].click()
    })
    expect(onImageReady).toHaveBeenCalledWith('img_zz')
  })
})

describe('ImageLibrary — delete', () => {
  it('clicking × removes the image from project.images', () => {
    const setProject = vi.fn()
    const p = projectWithImages([img('img_keep'), img('img_drop')])
    render({ project: p, setProject })
    // Order of buttons mirrors Object.values insertion → "img_keep", "img_drop".
    act(() => {
      deleteButtons()[1].click()
    })
    expect(setProject).toHaveBeenCalledTimes(1)
    const next = setProject.mock.calls[0][0] as Coh2SkinProject
    expect(Object.keys(next.images)).toEqual(['img_keep'])
  })

  it('deleting an image also strips any decals across every vehicle that reference it', () => {
    const setProject = vi.fn()
    const p = projectWithImages([img('img_doomed')])
    // Stick a decal referencing img_doomed onto two vehicles + a decal that
    // references a different image (must survive).
    p.vehicles['t34'] = {
      id: 't34',
      tac: null,
      name: null,
      decals: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture, partial Decal
        { id: 'd1', type: 'image', imageId: 'img_doomed' } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: 'd2', type: 'image', imageId: 'img_other' } as any,
      ],
    }
    p.vehicles['kv1'] = {
      id: 'kv1',
      tac: null,
      name: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      decals: [{ id: 'd3', type: 'image', imageId: 'img_doomed' } as any],
    }
    render({ project: p, setProject })
    act(() => {
      deleteButtons()[0].click()
    })
    const next = setProject.mock.calls[0][0] as Coh2SkinProject
    expect(next.vehicles['t34'].decals.map(d => d.id)).toEqual(['d2'])
    expect(next.vehicles['kv1'].decals).toEqual([])
  })

  it("clicking × does NOT fire the parent thumbnail's onImageReady (stopPropagation)", () => {
    const onImageReady = vi.fn()
    const p = projectWithImages([img('img_zz')])
    render({ project: p, onImageReady })
    act(() => {
      deleteButtons()[0].click()
    })
    expect(onImageReady).not.toHaveBeenCalled()
  })
})

describe('ImageLibrary — file picker import', () => {
  it('valid file picked → image lands in project + onImageReady fires + success toast', async () => {
    const setProject = vi.fn()
    const onImageReady = vi.fn()
    const toast = vi.fn()
    render({ setProject, onImageReady, toast })
    const file = makeImageFile('horse.png')
    // jsdom's file input doesn't accept programmatic .files assignment via
    // setter, so define the property directly.
    Object.defineProperty(fileInput(), 'files', { value: [file], configurable: true })
    await act(async () => {
      fileInput().dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(setProject).toHaveBeenCalledTimes(1)
    const next = setProject.mock.calls[0][0] as Coh2SkinProject
    const ids = Object.keys(next.images)
    expect(ids).toHaveLength(1)
    expect(onImageReady).toHaveBeenCalledWith(ids[0])
    expect(toast).toHaveBeenCalledWith('Imported horse.png', 'success')
  })

  it('non-image picked → toast(error) and no project mutation', async () => {
    const setProject = vi.fn()
    const onImageReady = vi.fn()
    const toast = vi.fn()
    render({ setProject, onImageReady, toast })
    Object.defineProperty(fileInput(), 'files', { value: [makeTextFile()], configurable: true })
    await act(async () => {
      fileInput().dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(setProject).not.toHaveBeenCalled()
    expect(onImageReady).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith('Not an image file', 'error')
  })
})

describe('ImageLibrary — drag-and-drop', () => {
  function dt(items: { kind: string; type: string }[], files: File[]) {
    // Minimal DataTransfer shim sufficient for the component's reads.
    return {
      items,
      files,
      dropEffect: '',
    }
  }

  it('dragover with a file adds the orange-accent ring class', () => {
    render()
    const dz = dropzone()
    act(() => {
      dz.dispatchEvent(
        Object.assign(new Event('dragover', { bubbles: true, cancelable: true }), {
          dataTransfer: dt([{ kind: 'file', type: 'image/png' }], []),
        }),
      )
    })
    expect(dz.className).toContain('ring-2')
    expect(dz.className).toContain('ring-[var(--color-accent)]')
  })

  it('dragleave removes the accent ring class', () => {
    render()
    const dz = dropzone()
    act(() => {
      dz.dispatchEvent(
        Object.assign(new Event('dragover', { bubbles: true, cancelable: true }), {
          dataTransfer: dt([{ kind: 'file', type: 'image/png' }], []),
        }),
      )
    })
    expect(dz.className).toContain('ring-2')
    act(() => {
      dz.dispatchEvent(new Event('dragleave', { bubbles: true }))
    })
    expect(dz.className).not.toContain('ring-2')
  })

  it('dragover with no file kind does NOT add the ring (no preventDefault)', () => {
    render()
    const dz = dropzone()
    act(() => {
      dz.dispatchEvent(
        Object.assign(new Event('dragover', { bubbles: true, cancelable: true }), {
          dataTransfer: dt([{ kind: 'string', type: 'text/plain' }], []),
        }),
      )
    })
    expect(dz.className).not.toContain('ring-2')
  })

  it('drop with a valid image file imports and toasts success', async () => {
    const setProject = vi.fn()
    const onImageReady = vi.fn()
    const toast = vi.fn()
    render({ setProject, onImageReady, toast })
    const file = makeImageFile('dropped.png')
    await act(async () => {
      dropzone().dispatchEvent(
        Object.assign(new Event('drop', { bubbles: true, cancelable: true }), {
          dataTransfer: dt([{ kind: 'file', type: 'image/png' }], [file]),
        }),
      )
    })
    expect(setProject).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith('Imported dropped.png', 'success')
    expect(onImageReady).toHaveBeenCalledTimes(1)
  })
})
