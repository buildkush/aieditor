import { describe, it, expect } from 'vitest'
import {
  FORMAT_OPTIONS,
  type NewProjectConfig,
} from './WelcomeScreen'
import { createEmptyProjectState } from '../../core/project/projectState'

describe('New Project Screen Format & Settings', () => {
  it('contains exactly two formats: Horizontal and Vertical', () => {
    expect(FORMAT_OPTIONS.length).toBe(2)
    const ids = FORMAT_OPTIONS.map((f) => f.id)
    expect(ids).toEqual(['horizontal', 'vertical'])
  })

  it('Horizontal format has exact 1920 × 1080 resolution', () => {
    const horizontal = FORMAT_OPTIONS.find((f) => f.id === 'horizontal')
    expect(horizontal).toBeDefined()
    expect(horizontal?.name).toBe('Horizontal')
    expect(horizontal?.width).toBe(1920)
    expect(horizontal?.height).toBe(1080)
  })

  it('Vertical format has exact 1080 × 1920 resolution', () => {
    const vertical = FORMAT_OPTIONS.find((f) => f.id === 'vertical')
    expect(vertical).toBeDefined()
    expect(vertical?.name).toBe('Vertical')
    expect(vertical?.width).toBe(1080)
    expect(vertical?.height).toBe(1920)
  })

  it('completely removes Square (1:1) from available format options', () => {
    const square = FORMAT_OPTIONS.find((f) => f.width === f.height || (f as any).id === 'square')
    expect(square).toBeUndefined()
  })

  it('creates project with correct horizontal settings, default fps 30, sampleRate 48000, and projectFolder', () => {
    const horizontalConfig: NewProjectConfig = {
      name: 'Test Horizontal',
      projectFolder: 'C:\\Users\\Kushagra Singh\\Videos\\Aiditor Projects',
      settings: {
        width: 1920,
        height: 1080,
        fps: 30,
        sampleRate: 48000,
      },
    }

    const state = createEmptyProjectState(horizontalConfig)
    expect(state.name).toBe('Test Horizontal')
    expect(state.projectFolder).toBe('C:\\Users\\Kushagra Singh\\Videos\\Aiditor Projects')
    expect(state.settings.width).toBe(1920)
    expect(state.settings.height).toBe(1080)
    expect(state.settings.fps).toBe(30)
    expect(state.settings.sampleRate).toBe(48000)
  })

  it('creates project with custom user-selected projectFolder', () => {
    const verticalConfig: NewProjectConfig = {
      name: 'Custom Folder Project',
      projectFolder: 'D:\\MyCustomVideos\\Edits',
      settings: {
        width: 1080,
        height: 1920,
        fps: 30,
        sampleRate: 48000,
      },
    }

    const state = createEmptyProjectState(verticalConfig)
    expect(state.name).toBe('Custom Folder Project')
    expect(state.projectFolder).toBe('D:\\MyCustomVideos\\Edits')
    expect(state.settings.width).toBe(1080)
    expect(state.settings.height).toBe(1920)
    expect(state.settings.fps).toBe(30)
    expect(state.settings.sampleRate).toBe(48000)
  })
})
