import { describe, it, expect } from 'vitest'
import { createEmptyProjectState } from './project/projectState'
import { ProjectStore } from '../store/projectStore'
import {
  AddMediaAssetCommand,
  AddTimelineItemCommand,
  SetPlayheadCommand,
  SelectItemCommand,
  AddKeyframeCommand,
  SetKeyframeValueCommand,
  ToggleKeyframeAtPlayheadCommand,
} from './commands/editorCommand'
import {
  evaluateItemProperty,
  evaluateItemTransform,
  evaluateItemCrop,
  hasKeyframeAtPlayhead,
} from './timeline/keyframeEvaluation'
import { serializeProject, deserializeProject } from './persistence/projectSerializer'
import { getPlaybackFrameInfo } from './playback/timelinePlayback'
import type { TimelineItem } from './timeline/types'
import { DEFAULT_TRANSFORM, DEFAULT_CROP } from './timeline/types'

describe('Phase 4 — End-to-End Keyframe & Animation Acceptance Workflow (Steps 1–23)', () => {
  it('executes the full 23-step acceptance test workflow', () => {
    // ──── Step 1: Create / open a project ────
    const initialProject = createEmptyProjectState({
      name: 'Phase 4 Animation Project',
      settings: { width: 1920, height: 1080, fps: 30 },
    })
    const store = new ProjectStore(initialProject)

    // Setup tracks and a video clip (10 seconds long from 0 to 10)
    store.dispatch(new AddMediaAssetCommand({
      id: 'asset-video-1',
      name: 'sample.mp4',
      type: 'video',
      path: '/media/sample.mp4',
      duration: 30,
    }))
    store.dispatch(new AddTimelineItemCommand({
      id: 'clip-base',
      trackId: 'track-v1',
      assetId: 'asset-video-1',
      startTime: 0,
      duration: 10,
      sourceIn: 0,
      sourceOut: 10,
      transform: { ...DEFAULT_TRANSFORM },
      crop: { ...DEFAULT_CROP },
    }))

    let state = store.getState()
    expect(state.items['clip-base']).toBeDefined()

    // ──── Step 2: Select a video clip ────
    store.dispatch(new SelectItemCommand('clip-base'))
    state = store.getState()
    expect(state.selectedItemId).toBe('clip-base')

    // ──── Step 3: Put playhead at 0 seconds ────
    store.dispatch(new SetPlayheadCommand(0))
    state = store.getState()
    expect(state.playheadTime).toBe(0)

    // ──── Step 4: Add Position X keyframe ────
    // Clicking the diamond adds keyframe at 0s with current evaluated value
    store.dispatch(new ToggleKeyframeAtPlayheadCommand('clip-base', 'x', 0))
    state = store.getState()
    expect(hasKeyframeAtPlayhead(state.items['clip-base'], 'x', 0)).toBe(true)

    // ──── Step 5: Set Position X = 0 ────
    store.dispatch(new SetKeyframeValueCommand('clip-base', 'x', 0, 0, 'kf-drag-step5'))
    state = store.getState()
    expect(evaluateItemProperty(state.items['clip-base'], 'x', 0)).toBe(0)

    // ──── Step 6: Move playhead to 5 seconds ────
    store.dispatch(new SetPlayheadCommand(5))
    state = store.getState()
    expect(state.playheadTime).toBe(5)

    // ──── Step 7: Change Position X = 500 ────
    store.dispatch(new SetKeyframeValueCommand('clip-base', 'x', 5, 500, 'kf-drag-step7'))
    state = store.getState()

    // ──── Step 8: Verify a second keyframe is created ────
    const xKfs = state.items['clip-base'].keyframes?.['x']
    expect(xKfs).toHaveLength(2)
    expect(xKfs?.[0].time).toBe(0)
    expect(xKfs?.[0].value).toBe(0)
    expect(xKfs?.[1].time).toBe(5)
    expect(xKfs?.[1].value).toBe(500)

    // ──── Step 9: Scrub between 0 and 5 seconds ────
    // At t=1s: 0 + (1/5)*500 = 100
    expect(evaluateItemProperty(state.items['clip-base'], 'x', 1)).toBeCloseTo(100)
    // At t=2s: 0 + (2/5)*500 = 200
    expect(evaluateItemProperty(state.items['clip-base'], 'x', 2)).toBeCloseTo(200)
    // At t=3s: 0 + (3/5)*500 = 300
    expect(evaluateItemProperty(state.items['clip-base'], 'x', 3)).toBeCloseTo(300)
    // At t=4s: 0 + (4/5)*500 = 400
    expect(evaluateItemProperty(state.items['clip-base'], 'x', 4)).toBeCloseTo(400)

    // ──── Step 10: Verify the clip moves smoothly (continuous monotonic interpolation) ────
    let lastX = -1
    for (let t = 0; t <= 5; t += 0.5) {
      const currentX = evaluateItemProperty(state.items['clip-base'], 'x', t)
      expect(currentX).toBeGreaterThanOrEqual(lastX)
      lastX = currentX
    }

    // ──── Step 11: Play the timeline ────
    // Simulating frame-by-frame forward playback
    const fps = 30
    const frameDuration = 1 / fps
    for (let frame = 0; frame <= 150; frame++) {
      const t = frame * frameDuration
      const frameInfo = getPlaybackFrameInfo(state, t)
      expect(frameInfo.activeVideos).toHaveLength(1)
      const animatedX = evaluateItemProperty(state.items['clip-base'], 'x', t)
      expect(animatedX).toBeCloseTo(t * 100, 1)
    }

    // ──── Step 12: Verify animation plays correctly (reverse playback test as well) ────
    for (let t = 5; t >= 0; t -= 0.5) {
      const revX = evaluateItemProperty(state.items['clip-base'], 'x', t)
      expect(revX).toBeCloseTo(t * 100, 1)
    }

    // ──── Step 13: Stop at 2.5 seconds ────
    store.dispatch(new SetPlayheadCommand(2.5))
    state = store.getState()
    expect(state.playheadTime).toBe(2.5)

    // ──── Step 14: Verify Inspector shows the interpolated Position X ────
    const evaluatedTf = evaluateItemTransform(state.items['clip-base'], state.playheadTime)
    expect(evaluatedTf.x).toBeCloseTo(250) // Exactly halfway between 0 and 500

    // ──── Step 15: Add Scale keyframes independently ────
    // 0s -> 1.0, 5s -> 2.0
    store.dispatch(new AddKeyframeCommand('clip-base', 'scale', 0, 1.0))
    store.dispatch(new AddKeyframeCommand('clip-base', 'scale', 5, 2.0))
    state = store.getState()
    expect(state.items['clip-base'].keyframes?.['scale']).toHaveLength(2)

    // ──── Step 16: Add Rotation keyframes independently ────
    // 2s -> 0, 5s -> 20
    store.dispatch(new AddKeyframeCommand('clip-base', 'rotation', 2, 0))
    store.dispatch(new AddKeyframeCommand('clip-base', 'rotation', 5, 20))
    state = store.getState()
    expect(state.items['clip-base'].keyframes?.['rotation']).toHaveLength(2)

    // ──── Step 17: Add Crop keyframes ────
    // 0s -> Crop Left = 0, 5s -> Crop Left = 40
    store.dispatch(new AddKeyframeCommand('clip-base', 'cropLeft', 0, 0))
    store.dispatch(new AddKeyframeCommand('clip-base', 'cropLeft', 5, 40))
    state = store.getState()
    expect(state.items['clip-base'].keyframes?.['cropLeft']).toHaveLength(2)

    // ──── Step 18: Verify all properties animate simultaneously ────
    // At t=2.5s:
    // Position X: 250
    // Scale: 1.0 + (2.5/5)*1.0 = 1.5
    // Rotation: at 2.5s, (2.5 - 2)/(5 - 2)*20 = (0.5/3)*20 = 3.333
    // Crop Left: 0 + (2.5/5)*40 = 20
    const allTf = evaluateItemTransform(state.items['clip-base'], 2.5)
    expect(allTf.x).toBeCloseTo(250)
    expect(allTf.scale).toBeCloseTo(1.5)
    expect(allTf.rotation).toBeCloseTo(3.333, 2)

    const allCrop = evaluateItemCrop(state.items['clip-base'], 2.5)
    expect(allCrop.left).toBeCloseTo(20)

    // ──── Step 19: Undo the latest logical edit in one step ────
    // The latest command was AddKeyframeCommand for cropLeft
    store.undo()
    state = store.getState()
    expect(state.items['clip-base'].keyframes?.['cropLeft']).toHaveLength(1) // 5s keyframe undone in ONE step
    // Position X, Scale, Rotation remain completely intact
    expect(state.items['clip-base'].keyframes?.['x']).toHaveLength(2)
    expect(state.items['clip-base'].keyframes?.['scale']).toHaveLength(2)
    expect(state.items['clip-base'].keyframes?.['rotation']).toHaveLength(2)

    // Redo to restore it
    store.redo()
    state = store.getState()
    expect(state.items['clip-base'].keyframes?.['cropLeft']).toHaveLength(2)

    // ──── Step 20: Save .aiditor ────
    const savedPath = 'C:\\test\\phase4_project.aiditor'
    const serializedJson = serializeProject(state, savedPath)
    expect(serializedJson).toContain('"schemaVersion": 2')
    expect(serializedJson).toContain('"keyframes"')
    expect(serializedJson).toContain('"cropLeft"')

    // ──── Step 21 & 22: Close & Reopen ────
    const reopenedProject = deserializeProject(serializedJson).state

    // ──── Step 23: Verify all keyframes and animation remain intact ────
    const reopenedClip = reopenedProject.items['clip-base']
    expect(reopenedClip).toBeDefined()
    expect(reopenedClip.keyframes).toBeDefined()
    expect(reopenedClip.keyframes?.['x']).toHaveLength(2)
    expect(reopenedClip.keyframes?.['scale']).toHaveLength(2)
    expect(reopenedClip.keyframes?.['rotation']).toHaveLength(2)
    expect(reopenedClip.keyframes?.['cropLeft']).toHaveLength(2)

    // Verify evaluation works identically after reload
    const reloadedTf = evaluateItemTransform(reopenedClip, 2.5)
    expect(reloadedTf.x).toBeCloseTo(250)
    expect(reloadedTf.scale).toBeCloseTo(1.5)
    expect(reloadedTf.rotation).toBeCloseTo(3.333, 2)

    const reloadedCrop = evaluateItemCrop(reopenedClip, 2.5)
    expect(reloadedCrop.left).toBeCloseTo(20)
  })

  it('preserves existing projects without keyframes (backwards compatibility)', () => {
    // Project with no keyframes property
    const legacyItem: TimelineItem = {
      id: 'legacy-clip',
      trackId: 'track-v1',
      assetId: 'asset-1',
      startTime: 0,
      duration: 10,
      sourceIn: 0,
      sourceOut: 10,
      transform: { ...DEFAULT_TRANSFORM, x: 77, y: 88, scale: 2 },
      crop: { ...DEFAULT_CROP, top: 15 },
    }

    const legacyProject = {
      ...createEmptyProjectState(),
      items: { 'legacy-clip': legacyItem },
    }

    // Evaluates to static values
    const tf = evaluateItemTransform(legacyProject.items['legacy-clip'], 4)
    expect(tf.x).toBe(77)
    expect(tf.y).toBe(88)
    expect(tf.scale).toBe(2)

    const crop = evaluateItemCrop(legacyProject.items['legacy-clip'], 4)
    expect(crop.top).toBe(15)

    // Serialize and deserialize roundtrip
    const json = serializeProject(legacyProject, 'C:\\test\\legacy.aiditor')
    const reloaded = deserializeProject(json).state
    expect(reloaded.items['legacy-clip'].transform.x).toBe(77)
    expect(reloaded.items['legacy-clip'].crop?.top).toBe(15)
  })

  it('verifies V1/V2 multi-track compositing works with keyframes', () => {
    const itemV1: TimelineItem = {
      id: 'clip-v1',
      trackId: 'track-v1',
      assetId: 'asset-bg',
      startTime: 0,
      duration: 10,
      sourceIn: 0,
      sourceOut: 10,
      transform: { ...DEFAULT_TRANSFORM },
    }

    const itemV2: TimelineItem = {
      id: 'clip-v2',
      trackId: 'track-v2',
      assetId: 'asset-overlay',
      startTime: 0,
      duration: 10,
      sourceIn: 0,
      sourceOut: 10,
      transform: { ...DEFAULT_TRANSFORM, opacity: 0.5 },
      keyframes: {
        opacity: [
          { id: 'k1', time: 0, value: 0, interpolation: 'linear' },
          { id: 'k2', time: 4, value: 1, interpolation: 'linear' },
        ],
      },
    }

    const state = {
      ...createEmptyProjectState(),
      assets: {
        'asset-bg': { id: 'asset-bg', name: 'bg.mp4', type: 'video' as const, path: '/bg.mp4', duration: 20 },
        'asset-overlay': { id: 'asset-overlay', name: 'overlay.mp4', type: 'video' as const, path: '/overlay.mp4', duration: 20 },
      },
      tracks: [
        { id: 'track-v1', name: 'Video 1', type: 'video' as const, visible: true, locked: false },
        { id: 'track-v2', name: 'Video 2', type: 'video' as const, visible: true, locked: false },
      ],
      items: { 'clip-v1': itemV1, 'clip-v2': itemV2 },
    }

    // Both active at t=2
    const frameInfo = getPlaybackFrameInfo(state, 2)
    expect(frameInfo.activeVideos).toHaveLength(2)

    // V2 evaluates to 0.5 opacity at t=2
    const v2Tf = evaluateItemTransform(state.items['clip-v2'], 2)
    expect(v2Tf.opacity).toBeCloseTo(0.5)
  })
})
