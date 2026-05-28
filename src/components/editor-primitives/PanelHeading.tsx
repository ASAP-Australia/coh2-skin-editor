/**
 * PanelHeading — the canonical 10px uppercase section heading.
 *
 * Consolidates three duplicate inline-style components that used to live in
 * FaceplateEditor (ToolbarHeading), DecalPackEditor (SidePanelHeading), and
 * BrushPanel (the file-local `Label`). All three were structurally identical:
 * 10px / fw600 / letter-spacing 1.5 / uppercase / muted text. Owning one
 * primitive guarantees a consistent visual rhythm and a single point of
 * change if the design tightens later.
 *
 * Props:
 *   • `children` — the heading copy.
 *   • `style?` — additive overrides (margin-top for the second heading in a
 *      vertical stack is the most common use).
 *   • `as?` — element tag, defaults to `h3`. Pass `'label'` if the heading
 *      labels an input below it (improves screen-reader semantics).
 */

import type { CSSProperties, ReactNode } from 'react'
import { sectionHeadingStyle } from './tokens'

interface Props {
  children: ReactNode
  style?: CSSProperties
  /** Override the element tag. Default `'h3'`. Use `'label'` when the heading
   *  semantically labels an immediately-following input/control. */
  as?: 'h3' | 'h4' | 'label' | 'div'
  /** Optional `htmlFor` when `as="label"`. */
  htmlFor?: string
}

export default function PanelHeading({ children, style, as = 'h3', htmlFor }: Props) {
  const merged: CSSProperties = { ...sectionHeadingStyle, ...style }
  if (as === 'label') {
    return (
      <label style={merged} htmlFor={htmlFor}>
        {children}
      </label>
    )
  }
  if (as === 'h4') {
    return <h4 style={merged}>{children}</h4>
  }
  if (as === 'div') {
    return <div style={merged}>{children}</div>
  }
  return <h3 style={merged}>{children}</h3>
}
