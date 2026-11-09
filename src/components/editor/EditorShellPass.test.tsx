import { describe, it, expect, vi } from 'vitest'
// @ts-ignore
import { renderToStaticMarkup } from 'react-dom/server'
import { TitleBar } from '../titlebar/TitleBar'
import { MenuBar } from './MenuBar'
import { ProjectSettingsDialog } from '../dialogs/ProjectSettingsDialog'
import { KeyboardShortcutsDialog } from '../dialogs/KeyboardShortcutsDialog'
import { AboutDialog } from '../dialogs/AboutDialog'
import { createEmptyProjectState } from '../../core/project/projectState'

describe('UI Pass Architecture & Hierarchy Verification', () => {
  const dummyState = createEmptyProjectState({
    name: 'My Masterpiece',
    settings: { width: 1920, height: 1080, fps: 30, sampleRate: 48000 },
  })

  it('renders custom TitleBar with draggable region, logo, name, and window controls', () => {
    const html = renderToStaticMarkup(
      <TitleBar projectName="My Masterpiece" isDirty={false} />
    )
    expect(html).toContain('aiditor')
    expect(html).toContain('My Masterpiece')
    expect(html).toContain('btn-minimize')
    expect(html).toContain('btn-maximize')
    expect(html).toContain('btn-close')
    expect(html).toContain('data-tauri-drag-region')
    expect(html).not.toContain('toolbar-back-btn')
  })

  it('renders TitleBar dirty dot indicator when project is dirty', () => {
    const html = renderToStaticMarkup(
      <TitleBar projectName="My Masterpiece" isDirty={true} />
    )
    expect(html).toContain('titlebar-dirty-dot')
  })

  it('renders clean Main Menu Bar with File, Edit, View, Help and no dead Add or Effects menus', () => {
    const html = renderToStaticMarkup(
      <MenuBar
        canUndo={true}
        canRedo={false}
        canDelete={true}
        canSplit={true}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
      />
    )
    expect(html).toContain('File')
    expect(html).toContain('Edit')
    expect(html).toContain('View')
    expect(html).toContain('Help')
    // No top-level Add or Effects menus
    expect(html).not.toContain('>Add<')
    expect(html).not.toContain('>Effects<')
  })

  it('renders ProjectSettingsDialog with resolution presets, inputs, fps, and sample rate', () => {
    const html = renderToStaticMarkup(
      <ProjectSettingsDialog
        isOpen={true}
        state={dummyState}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(html).toContain('Project Settings')
    expect(html).toContain('1080p Landscape')
    expect(html).toContain('Vertical Video')
    expect(html).toContain('4K UHD')
    expect(html).toContain('Square')
    expect(html).toContain('Canvas Width (px)')
    expect(html).toContain('Canvas Height (px)')
    expect(html).toContain('Frame Rate (FPS)')
    expect(html).toContain('Audio Sample Rate')
    expect(html).toContain('Save Settings')
  })

  it('renders KeyboardShortcutsDialog with categorized shortcuts', () => {
    const html = renderToStaticMarkup(
      <KeyboardShortcutsDialog isOpen={true} onClose={vi.fn()} />
    )
    expect(html).toContain('Keyboard Shortcuts')
    expect(html).toContain('General')
    expect(html).toContain('Editing &amp; Timeline')
    expect(html).toContain('Playback &amp; Navigation')
    expect(html).toContain('Ctrl + N')
    expect(html).toContain('Split clip at playhead')
  })

  it('renders AboutDialog with version and project identity', () => {
    const html = renderToStaticMarkup(
      <AboutDialog isOpen={true} onClose={vi.fn()} />
    )
    expect(html).toContain('About aiditor')
    expect(html).toContain('Version 0.1.0')
    expect(html).toContain('Local-first')
  })
})
