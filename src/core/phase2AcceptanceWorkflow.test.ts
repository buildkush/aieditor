import { describe, it, expect } from 'vitest'
import { createEmptyProjectState } from './project/projectState'
import { ProjectStore } from '../store/projectStore'
import {
  AddMediaAssetCommand,
  AddTimelineItemCommand,
  SetPlayheadCommand,
  TrimTimelineItemCommand,
  SplitTimelineItemCommand,
  MoveTimelineItemCommand,
} from './commands/editorCommand'
import { getPlaybackFrameInfo } from './playback/timelinePlayback'
import { serializeProject, deserializeProject } from './persistence/projectSerializer'
import { DEFAULT_TRANSFORM } from './timeline/types'
import { createMediaAssetFromSource } from './media/mediaExtractor'

describe('Phase 2 — End-to-End Acceptance Workflow (Steps 1–20)', () => {
  it('successfully executes the full 20-step Phase 2 acceptance workflow', async () => {
    // ──── Step 1: Create a Vertical project ────
    const initialProject = createEmptyProjectState({
      name: 'Vertical Reel Project',
      projectFolder: 'C:\\Users\\Kushagra Singh\\Videos\\Aiditor Projects',
      settings: {
        width: 1080,
        height: 1920,
        fps: 30,
        sampleRate: 48000,
      },
    })
    expect(initialProject.settings.width).toBe(1080)
    expect(initialProject.settings.height).toBe(1920)
    expect(initialProject.settings.fps).toBe(30)

    const store = new ProjectStore(initialProject)
    expect(store.getIsDirty()).toBe(false)

    // ──── Step 2 & 3: Import real video from disk & see in Media Library ────
    const realVideo1 = await createMediaAssetFromSource(
      'c:\\kushagra\\test_media\\sample_clip1.mp4',
      'asset-real-1'
    )
    store.dispatch(new AddMediaAssetCommand(realVideo1))

    let state = store.getState()
    expect(state.assets['asset-real-1']).toBeDefined()
    expect(state.assets['asset-real-1'].name).toBe('sample_clip1.mp4')
    expect(state.assets['asset-real-1'].type).toBe('video')
    expect(store.getIsDirty()).toBe(true)

    // ──── Step 4: Drag it to the timeline ────
    const clip1Duration = realVideo1.duration || 10
    store.dispatch(
      new AddTimelineItemCommand({
        id: 'clip-1',
        trackId: 'track-v1',
        assetId: 'asset-real-1',
        startTime: 0,
        duration: clip1Duration,
        sourceIn: 0,
        sourceOut: clip1Duration,
        transform: { ...DEFAULT_TRANSFORM },
      })
    )

    state = store.getState()
    expect(state.items['clip-1']).toBeDefined()
    expect(state.items['clip-1'].startTime).toBe(0)
    expect(state.items['clip-1'].duration).toBe(clip1Duration)

    // ──── Step 5: Play it (advance playhead) ────
    store.dispatch(new SetPlayheadCommand(2.5))
    state = store.getState()
    let frameInfo = getPlaybackFrameInfo(state, state.playheadTime)
    expect(frameInfo.activeVideo).toBeDefined()
    expect(frameInfo.activeVideo?.item.id).toBe('clip-1')
    expect(frameInfo.activeVideo?.sourceTime).toBeCloseTo(2.5)

    // ──── Step 6: Pause / stop it ────
    store.dispatch(new SetPlayheadCommand(3.0))
    state = store.getState()
    expect(state.playheadTime).toBe(3.0)

    // ──── Step 7: Scrub it ────
    store.dispatch(new SetPlayheadCommand(5.2))
    state = store.getState()
    frameInfo = getPlaybackFrameInfo(state, 5.2)
    expect(frameInfo.activeVideo?.sourceTime).toBeCloseTo(5.2)

    // ──── Step 8: Step frame-by-frame ────
    const delta = 1 / state.settings.fps
    store.dispatch(new SetPlayheadCommand(state.playheadTime + delta))
    state = store.getState()
    expect(state.playheadTime).toBeCloseTo(5.2 + delta)
    frameInfo = getPlaybackFrameInfo(state, state.playheadTime)
    expect(frameInfo.activeVideo?.sourceTime).toBeCloseTo(5.2 + delta)

    // ──── Step 9: Trim the beginning (left edge) ────
    // Trim left edge to 2.0s: clip now runs from 2.0 to 10.0, sourceIn = 2.0
    store.dispatch(
      new TrimTimelineItemCommand('clip-1', {
        edge: 'left',
        newTime: 2.0,
      })
    )
    state = store.getState()
    expect(state.items['clip-1'].startTime).toBe(2.0)
    expect(state.items['clip-1'].sourceIn).toBeCloseTo(2.0)
    // Playback before 2.0s is now empty!
    expect(getPlaybackFrameInfo(state, 1.0).activeVideo).toBeNull()
    // Playback at 3.0s has sourceTime = 2.0 + (3.0 - 2.0) = 3.0s
    expect(getPlaybackFrameInfo(state, 3.0).activeVideo?.sourceTime).toBeCloseTo(3.0)

    // ──── Step 10: Trim the end (right edge) ────
    // Trim right edge to 8.0s (duration = 6.0s, sourceOut = 8.0s)
    store.dispatch(
      new TrimTimelineItemCommand('clip-1', {
        edge: 'right',
        newTime: 8.0,
      })
    )
    state = store.getState()
    expect(state.items['clip-1'].startTime + state.items['clip-1'].duration).toBeCloseTo(8.0)
    expect(state.items['clip-1'].sourceOut).toBeCloseTo(8.0)

    // ──── Step 11: Split it at playhead 5.0s ────
    store.dispatch(
      new SplitTimelineItemCommand('clip-1', 5.0, 'clip-1a', 'clip-1b')
    )
    state = store.getState()
    expect(state.items['clip-1']).toBeUndefined() // Original replaced by split pair
    expect(state.items['clip-1a']).toBeDefined()
    expect(state.items['clip-1b']).toBeDefined()
    expect(state.items['clip-1a'].startTime).toBe(2.0)
    expect(state.items['clip-1a'].duration).toBeCloseTo(3.0) // 2.0 to 5.0
    expect(state.items['clip-1b'].startTime).toBe(5.0)
    expect(state.items['clip-1b'].duration).toBeCloseTo(3.0) // 5.0 to 8.0

    // ──── Step 12: Move resulting clip (move clip-1b to 12.0s) ────
    store.dispatch(new MoveTimelineItemCommand('clip-1b', 12.0, 'track-v1'))
    state = store.getState()
    expect(state.items['clip-1b'].startTime).toBe(12.0)
    // Between 5.0 and 12.0 is now a gap
    expect(getPlaybackFrameInfo(state, 8.0).activeVideo).toBeNull()

    // ──── Step 13: Import another video ────
    const realVideo2 = await createMediaAssetFromSource(
      'c:\\kushagra\\test_media\\sample_clip2.mp4',
      'asset-real-2'
    )
    store.dispatch(new AddMediaAssetCommand(realVideo2))
    state = store.getState()
    expect(state.assets['asset-real-2']).toBeDefined()

    // ──── Step 14 & 15: Place it between/over clips & verify overwrite behavior ────
    // Place clip-2 at timeline 4.0 with duration 4.0 (timeline 4.0 -> 8.0)
    // This overlaps the tail of clip-1a (which was 2.0 -> 5.0)
    store.dispatch(
      new AddTimelineItemCommand({
        id: 'clip-2',
        trackId: 'track-v1',
        assetId: 'asset-real-2',
        startTime: 4.0,
        duration: 4.0,
        sourceIn: 0,
        sourceOut: 4.0,
        transform: { ...DEFAULT_TRANSFORM },
      })
    )
    state = store.getState()
    expect(state.items['clip-2']).toBeDefined()
    // Overwrite behavior: clip-1a is trimmed so it ends at 4.0!
    expect(state.items['clip-1a'].startTime + state.items['clip-1a'].duration).toBeCloseTo(4.0)

    // ──── Step 16: Save project as .aiditor ────
    const savedFilePath = 'C:\\Users\\Kushagra Singh\\Videos\\Aiditor Projects\\My Vertical Video.aiditor'
    const serializedAiditor = serializeProject(state, savedFilePath)
    expect(serializedAiditor).toContain('"schemaVersion": 2')
    expect(serializedAiditor).toContain('sample_clip1.mp4')
    expect(serializedAiditor).toContain('sample_clip2.mp4')

    store.markClean(savedFilePath)
    expect(store.getIsDirty()).toBe(false)
    expect(store.getProjectFilePath()).toBe(savedFilePath)

    // ──── Step 17: Close the editor ────
    const blankState = createEmptyProjectState()
    store.reset(blankState)
    expect(Object.keys(store.getState().assets)).toHaveLength(0)
    expect(Object.keys(store.getState().items)).toHaveLength(0)

    // ──── Step 18: Reopen the .aiditor project ────
    const { state: reopenedState, missingAssets, projectFilePath } = deserializeProject(
      serializedAiditor,
      {
        checkFileExists: () => true, // Real files exist
        currentFilePath: savedFilePath,
      }
    )

    expect(missingAssets).toHaveLength(0)
    expect(projectFilePath).toBe(savedFilePath)
    store.reset(reopenedState, savedFilePath)

    // ──── Step 19: Verify complete timeline and media references are restored ────
    const finalState = store.getState()
    expect(finalState.name).toBe('Vertical Reel Project')
    expect(finalState.settings.width).toBe(1080)
    expect(finalState.settings.height).toBe(1920)
    expect(finalState.assets['asset-real-1']).toBeDefined()
    expect(finalState.assets['asset-real-2']).toBeDefined()
    expect(finalState.items['clip-1a']).toBeDefined()
    expect(finalState.items['clip-2']).toBeDefined()
    expect(finalState.items['clip-1b']).toBeDefined()

    // Verify playback on restored project
    // At 4.5s -> playing clip-2
    const restoredFrame = getPlaybackFrameInfo(finalState, 4.5)
    expect(restoredFrame.activeVideo?.item.id).toBe('clip-2')
    expect(restoredFrame.activeVideo?.asset.name).toBe('sample_clip2.mp4')

    // ──── Step 20: Continue editing successfully ────
    // Move playhead to 12.5s and split clip-1b
    store.dispatch(new SetPlayheadCommand(12.5))
    store.dispatch(
      new SplitTimelineItemCommand('clip-1b', 12.5, 'clip-1b-sub1', 'clip-1b-sub2')
    )
    expect(store.getState().items['clip-1b-sub1']).toBeDefined()
    expect(store.getState().items['clip-1b-sub2']).toBeDefined()
    expect(store.getIsDirty()).toBe(true)

    // Undo works seamlessly on restored project
    store.undo()
    expect(store.getState().items['clip-1b']).toBeDefined()
    expect(store.getState().items['clip-1b-sub1']).toBeUndefined()
  })
})
