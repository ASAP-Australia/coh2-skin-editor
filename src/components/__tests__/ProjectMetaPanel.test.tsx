/**
 * Unit tests for ProjectMetaPanel — collapsible 3-input meta editor
 * (Author / Name / Description).
 *
 * Uses React 19's createRoot + jsdom + act. No @testing-library/react.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import ProjectMetaPanel from '../editor-primitives/ProjectMetaPanel'

let container: HTMLDivElement | null = null
let root: Root | null = null

function render(ui: React.ReactElement) {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
  }
  if (!root) root = createRoot(container)
  act(() => {
    root!.render(ui)
  })
  return container
}

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

describe('ProjectMetaPanel', () => {
  it('collapsed pill renders with name and author text', () => {
    const el = render(
      createElement(ProjectMetaPanel, {
        author: 'TestAuthor',
        name: 'My Pack',
        description: 'A description',
        onChange: vi.fn(),
      }),
    )
    const pill = el.querySelector('[data-testid="project-meta-panel-pill"]')
    expect(pill).not.toBeNull()
    expect(pill!.textContent).toContain('My Pack')
    expect(pill!.textContent).toContain('TestAuthor')
  })

  it('click the pill expands the panel (panel appears, pill disappears)', () => {
    const el = render(
      createElement(ProjectMetaPanel, {
        author: 'Author',
        name: 'Pack',
        description: 'Desc',
        onChange: vi.fn(),
      }),
    )
    const pill = el.querySelector('[data-testid="project-meta-panel-pill"]') as HTMLElement
    expect(pill).not.toBeNull()
    act(() => {
      pill.click()
    })
    expect(el.querySelector('[data-testid="project-meta-panel"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="project-meta-panel-pill"]')).toBeNull()
  })

  it('expanded panel renders all three inputs with current values', () => {
    const el = render(
      createElement(ProjectMetaPanel, {
        author: 'AuthorVal',
        name: 'NameVal',
        description: 'DescVal',
        onChange: vi.fn(),
        initialOpen: true,
      }),
    )
    const authorInput = el.querySelector(
      '[data-testid="project-meta-author-input"]',
    ) as HTMLInputElement
    const nameInput = el.querySelector(
      '[data-testid="project-meta-name-input"]',
    ) as HTMLInputElement
    const descInput = el.querySelector(
      '[data-testid="project-meta-description-input"]',
    ) as HTMLTextAreaElement
    expect(authorInput).not.toBeNull()
    expect(nameInput).not.toBeNull()
    expect(descInput).not.toBeNull()
    expect(authorInput.value).toBe('AuthorVal')
    expect(nameInput.value).toBe('NameVal')
    expect(descInput.value).toBe('DescVal')
  })

  it('typing in Author input fires onChange with { author: newValue, name, description }', () => {
    const onChange = vi.fn()
    const el = render(
      createElement(ProjectMetaPanel, {
        author: 'OldAuthor',
        name: 'PackName',
        description: 'PackDesc',
        onChange,
        initialOpen: true,
      }),
    )
    const input = el.querySelector('[data-testid="project-meta-author-input"]') as HTMLInputElement
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'NewAuthor')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith({
      author: 'NewAuthor',
      name: 'PackName',
      description: 'PackDesc',
    })
  })

  it('typing in Name input fires onChange with { author, name: newValue, description }', () => {
    const onChange = vi.fn()
    const el = render(
      createElement(ProjectMetaPanel, {
        author: 'AuthorA',
        name: 'OldName',
        description: 'DescA',
        onChange,
        initialOpen: true,
      }),
    )
    const input = el.querySelector('[data-testid="project-meta-name-input"]') as HTMLInputElement
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'NewName')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith({
      author: 'AuthorA',
      name: 'NewName',
      description: 'DescA',
    })
  })

  it('typing in Description textarea fires onChange with { author, name, description: newValue }', () => {
    const onChange = vi.fn()
    const el = render(
      createElement(ProjectMetaPanel, {
        author: 'AuthorB',
        name: 'NameB',
        description: 'OldDesc',
        onChange,
        initialOpen: true,
      }),
    )
    const textarea = el.querySelector(
      '[data-testid="project-meta-description-input"]',
    ) as HTMLTextAreaElement
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(textarea, 'NewDesc')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith({
      author: 'AuthorB',
      name: 'NameB',
      description: 'NewDesc',
    })
  })

  it('pressing Escape collapses the expanded panel', () => {
    const el = render(
      createElement(ProjectMetaPanel, {
        author: 'A',
        name: 'N',
        description: 'D',
        onChange: vi.fn(),
        initialOpen: true,
      }),
    )
    expect(el.querySelector('[data-testid="project-meta-panel"]')).not.toBeNull()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(el.querySelector('[data-testid="project-meta-panel"]')).toBeNull()
    expect(el.querySelector('[data-testid="project-meta-panel-pill"]')).not.toBeNull()
  })

  it('empty name falls back to "Untitled" in the collapsed pill', () => {
    const el = render(
      createElement(ProjectMetaPanel, {
        author: 'Someone',
        name: '',
        description: '',
        onChange: vi.fn(),
      }),
    )
    const pill = el.querySelector('[data-testid="project-meta-panel-pill"]')
    expect(pill!.textContent).toContain('Untitled')
  })

  it('empty author falls back to "Anonymous" in the collapsed pill', () => {
    const el = render(
      createElement(ProjectMetaPanel, {
        author: '',
        name: 'My Pack',
        description: '',
        onChange: vi.fn(),
      }),
    )
    const pill = el.querySelector('[data-testid="project-meta-panel-pill"]')
    expect(pill!.textContent).toContain('Anonymous')
  })

  it('initialOpen={true} starts expanded', () => {
    const el = render(
      createElement(ProjectMetaPanel, {
        author: 'A',
        name: 'N',
        description: 'D',
        onChange: vi.fn(),
        initialOpen: true,
      }),
    )
    expect(el.querySelector('[data-testid="project-meta-panel"]')).not.toBeNull()
    expect(el.querySelector('[data-testid="project-meta-panel-pill"]')).toBeNull()
  })
})
