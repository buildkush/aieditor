import { describe, it, expect, vi } from 'vitest'
// @ts-ignore
import { renderToStaticMarkup } from 'react-dom/server'
import { TitleBar } from '../titlebar/TitleBar'
import { MenuBar } from './MenuBar'
import { Toolbar } from './Toolbar'

describe('Application Shell Header & Menu Bar', () => {
  const menuProps = {
    projectName: 'Demo Project',
    isDirty: true,
    canUndo: true,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onNew: vi.fn(),
    onSave: vi.fn(),
    onSaveAs: vi.fn(),
    onOpen: vi.fn(),
    onClose: vi.fn(),
  }

  it('renders custom TitleBar with aiditor logo, name, and window controls', () => {
    const html = renderToStaticMarkup(
      <TitleBar projectName="Demo Project" isDirty={true} />
    )
    expect(html).toContain('aiditor')
    expect(html).toContain('titlebar-app-icon')
    expect(html).toContain('titlebar-app-name')
    expect(html).toContain('btn-minimize')
    expect(html).toContain('btn-maximize')
    expect(html).toContain('btn-close')
    expect(html).toContain('Demo Project')
  })

  it('verifies that no back button exists in TitleBar or MenuBar', () => {
    const titleBarHtml = renderToStaticMarkup(<TitleBar projectName="Demo Project" />)
    const menuBarHtml = renderToStaticMarkup(<MenuBar {...menuProps} />)
    expect(titleBarHtml).not.toContain('toolbar-back-btn')
    expect(menuBarHtml).not.toContain('toolbar-back-btn')
  })

  it('renders File, Edit, View, and Help menu buttons in MenuBar', () => {
    const html = renderToStaticMarkup(<MenuBar {...menuProps} />)
    expect(html).toContain('File')
    expect(html).toContain('Edit')
    expect(html).toContain('View')
    expect(html).toContain('Help')
    expect(html).toContain('toolbar-file-menu-btn')
  })

  it('renders dirty indicator dot when project is dirty', () => {
    const html = renderToStaticMarkup(<MenuBar {...menuProps} isDirty={true} />)
    expect(html).toContain('menubar-dirty-dot')
  })

  it('Toolbar component renders MenuBar for backwards compatibility', () => {
    const html = renderToStaticMarkup(<Toolbar {...menuProps} />)
    expect(html).toContain('toolbar-file-menu-btn')
    expect(html).toContain('File')
    expect(html).toContain('Edit')
  })
})
