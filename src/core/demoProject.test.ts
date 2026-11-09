import { describe, it, expect } from 'vitest'
import { createDemoProject } from './demoProject'
import { validateTimelineItem } from './commands/editorCommand'

describe('createDemoProject', () => {
  it('creates a valid ProjectState with required fields', () => {
    const project = createDemoProject()
    expect(project.id).toBe('demo-project')
    expect(project.name).toBe('Demo Project')
    expect(project.settings.width).toBe(1920)
    expect(project.settings.height).toBe(1080)
    expect(project.settings.fps).toBe(30)
    expect(project.settings.sampleRate).toBe(48000)
    expect(project.tracks.length).toBeGreaterThanOrEqual(2)
    expect(Object.keys(project.assets).length).toBe(4)
    expect(Object.keys(project.items).length).toBe(4)
  })

  it('ensures all timeline items pass validation against the project state', () => {
    const project = createDemoProject()
    for (const item of Object.values(project.items)) {
      expect(validateTimelineItem(item, project)).toEqual([])
    }
  })

  it('ensures all timeline items link to valid assets and tracks', () => {
    const project = createDemoProject()
    const trackIds = new Set(project.tracks.map((t) => t.id))

    for (const item of Object.values(project.items)) {
      expect(trackIds.has(item.trackId)).toBe(true)
      const asset = project.assets[item.assetId]
      expect(asset).toBeDefined()
      expect(item.sourceIn).toBeGreaterThanOrEqual(0)
      expect(item.sourceOut).toBeLessThanOrEqual(asset!.duration!)
      expect(item.sourceOut).toBeGreaterThan(item.sourceIn)
      expect(item.duration).toBeCloseTo(item.sourceOut - item.sourceIn, 5)
    }
  })
})
