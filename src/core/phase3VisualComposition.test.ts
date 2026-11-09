import { describe, it, expect, beforeEach } from 'vitest'
import {
  createEmptyProjectState,
  CommandHistory,
  AddTrackCommand,
  AddMediaAssetCommand,
  AddTimelineItemCommand,
  SelectItemCommand,
  UpdateTransformCommand,
  ResetTransformCommand,
  FitToCanvasCommand,
  FillCanvasCommand,
  UpdateCropCommand,
  ResetCropCommand,
  DEFAULT_TRANSFORM,
  DEFAULT_CROP,
  type ProjectState,
  type MediaAsset,
  type TimelineItem,
  type Track,
} from './index'
import { getPlaybackFrameInfo } from './playback/timelinePlayback'
import { serializeProject, deserializeProject } from './persistence/projectSerializer'

describe('Phase 3 — Visual Composition, Transforms & Canvas Editing', () => {
  let state: ProjectState
  let history: CommandHistory

  const assetV1: MediaAsset = {
    id: 'asset-main-video',
    name: 'main_interview.mp4',
    type: 'video',
    path: '/media/interview.mp4',
    duration: 30,
    metadata: { width: 1920, height: 1080, fps: 30 },
  }

  const assetV2: MediaAsset = {
    id: 'asset-b-roll',
    name: 'broll_cutaway.mp4',
    type: 'video',
    path: '/media/broll.mp4',
    duration: 20,
    metadata: { width: 1920, height: 1080, fps: 30 },
  }

  const assetVertical: MediaAsset = {
    id: 'asset-vertical',
    name: 'vertical_short.mp4',
    type: 'video',
    path: '/media/short.mp4',
    duration: 15,
    metadata: { width: 1080, height: 1920, fps: 30 },
  }

  const asset4K: MediaAsset = {
    id: 'asset-4k',
    name: 'drone_4k.mp4',
    type: 'video',
    path: '/media/drone.mp4',
    duration: 25,
    metadata: { width: 3840, height: 2160, fps: 30 },
  }

  const trackV1: Track = {
    id: 'track-v1',
    name: 'Video 1',
    type: 'video',
    visible: true,
  }

  const trackV2: Track = {
    id: 'track-v2',
    name: 'Video 2',
    type: 'video',
    visible: true,
  }

  const itemV1: TimelineItem = {
    id: 'item-v1',
    trackId: 'track-v1',
    assetId: 'asset-main-video',
    startTime: 0,
    duration: 20,
    sourceIn: 0,
    sourceOut: 20,
    transform: { ...DEFAULT_TRANSFORM },
  }

  const itemV2: TimelineItem = {
    id: 'item-v2',
    trackId: 'track-v2',
    assetId: 'asset-b-roll',
    startTime: 5,
    duration: 10,
    sourceIn: 0,
    sourceOut: 10,
    transform: { ...DEFAULT_TRANSFORM },
  }

  beforeEach(() => {
    state = createEmptyProjectState({
      id: 'proj-comp-test',
      name: 'Composition Test Project',
      settings: { width: 1920, height: 1080, fps: 30, sampleRate: 48000 },
      initialTracks: [trackV2, trackV1],
    })

    state = new AddMediaAssetCommand(assetV1).execute(state)
    state = new AddMediaAssetCommand(assetV2).execute(state)
    state = new AddMediaAssetCommand(assetVertical).execute(state)
    state = new AddMediaAssetCommand(asset4K).execute(state)
    state = new AddTimelineItemCommand(itemV1).execute(state)
    state = new AddTimelineItemCommand(itemV2).execute(state)

    history = new CommandHistory(state)
  })

  // ──── 1. Multi-Track Compositing Order ────

  describe('Multi-Track Compositing Order (V1 + V2)', () => {
    it('composites V2 above V1 when both are active at current playhead', () => {
      // Playhead at 7s: both itemV1 (0-20s) and itemV2 (5-15s) are active
      const frameInfo = getPlaybackFrameInfo(state, 7)

      expect(frameInfo.isEmpty).toBe(false)
      expect(frameInfo.activeVideos).toHaveLength(2)

      // Natural track ordering: V1 is bottom layer, V2 is above V1
      expect(frameInfo.activeVideos[0].item.id).toBe('item-v1')
      expect(frameInfo.activeVideos[0].track.id).toBe('track-v1')

      expect(frameInfo.activeVideos[1].item.id).toBe('item-v2')
      expect(frameInfo.activeVideos[1].track.id).toBe('track-v2')

      // Topmost video is V2
      expect(frameInfo.activeVideo?.item.id).toBe('item-v2')
    })

    it('respects gaps: only V1 is present before V2 starts', () => {
      // Playhead at 2s: only itemV1 is active
      const frameInfo = getPlaybackFrameInfo(state, 2)
      expect(frameInfo.activeVideos).toHaveLength(1)
      expect(frameInfo.activeVideos[0].item.id).toBe('item-v1')
      expect(frameInfo.activeVideo?.item.id).toBe('item-v1')
    })

    it('respects gaps: only V1 is present after V2 ends', () => {
      // Playhead at 17s: itemV2 ended at 15s, itemV1 still active until 20s
      const frameInfo = getPlaybackFrameInfo(state, 17)
      expect(frameInfo.activeVideos).toHaveLength(1)
      expect(frameInfo.activeVideos[0].item.id).toBe('item-v1')
    })

    it('returns empty when playhead is in empty timeline region', () => {
      const frameInfo = getPlaybackFrameInfo(state, 25)
      expect(frameInfo.isEmpty).toBe(true)
      expect(frameInfo.activeVideos).toHaveLength(0)
      expect(frameInfo.activeVideo).toBeNull()
    })

    it('supports 3 tracks: V3 above V2 above V1', () => {
      const trackV3: Track = { id: 'track-v3', name: 'Video 3', type: 'video', visible: true }
      const itemV3: TimelineItem = {
        id: 'item-v3',
        trackId: 'track-v3',
        assetId: 'asset-b-roll',
        startTime: 6,
        duration: 4,
        sourceIn: 0,
        sourceOut: 4,
        transform: { ...DEFAULT_TRANSFORM },
      }

      let threeTrackState = new AddTrackCommand(trackV3).execute(state)
      threeTrackState = new AddTimelineItemCommand(itemV3).execute(threeTrackState)

      const frameInfo = getPlaybackFrameInfo(threeTrackState, 7)
      expect(frameInfo.activeVideos).toHaveLength(3)
      expect(frameInfo.activeVideos[0].track.name).toBe('Video 1')
      expect(frameInfo.activeVideos[1].track.name).toBe('Video 2')
      expect(frameInfo.activeVideos[2].track.name).toBe('Video 3')
      expect(frameInfo.activeVideo?.track.name).toBe('Video 3')
    })
  })

  // ──── 2. Transform Updates & Undo/Redo ────

  describe('Transform Updates & Undo/Redo', () => {
    it('updates position X and position Y with 1 committed command', () => {
      const moveCommand = new UpdateTransformCommand('item-v2', { x: 240, y: -100 })
      const nextState = history.execute(moveCommand)

      expect(nextState.items['item-v2'].transform.x).toBe(240)
      expect(nextState.items['item-v2'].transform.y).toBe(-100)
      expect(nextState.items['item-v2'].transform.scale).toBe(1)
      expect(nextState.items['item-v2'].transform.rotation).toBe(0)
      expect(nextState.items['item-v2'].transform.opacity).toBe(1)

      // 1 Undo restores exact previous position (0, 0) in ONE step
      const undoneState = history.undo()
      expect(undoneState?.items['item-v2'].transform.x).toBe(0)
      expect(undoneState?.items['item-v2'].transform.y).toBe(0)

      // Redo restores (240, -100)
      const redoneState = history.redo()
      expect(redoneState?.items['item-v2'].transform.x).toBe(240)
      expect(redoneState?.items['item-v2'].transform.y).toBe(-100)
    })

    it('updates scale with 1 committed command and supports undo', () => {
      const scaleCommand = new UpdateTransformCommand('item-v2', { scale: 0.65 })
      const nextState = history.execute(scaleCommand)

      expect(nextState.items['item-v2'].transform.scale).toBe(0.65)

      // Undo restores scale 1
      const undone = history.undo()
      expect(undone?.items['item-v2'].transform.scale).toBe(1)
    })

    it('updates rotation with 1 committed command and supports undo', () => {
      const rotateCommand = new UpdateTransformCommand('item-v2', { rotation: 45 })
      const nextState = history.execute(rotateCommand)

      expect(nextState.items['item-v2'].transform.rotation).toBe(45)

      // Undo restores rotation 0
      const undone = history.undo()
      expect(undone?.items['item-v2'].transform.rotation).toBe(0)
    })

    it('updates opacity and verifies V1 remains visible through V2', () => {
      const opacityCommand = new UpdateTransformCommand('item-v2', { opacity: 0.5 })
      const nextState = history.execute(opacityCommand)

      expect(nextState.items['item-v2'].transform.opacity).toBe(0.5)

      // Check playback frame info: both V1 and V2 are present
      const frameInfo = getPlaybackFrameInfo(nextState, 7)
      expect(frameInfo.activeVideos).toHaveLength(2)
      expect(frameInfo.activeVideos[0].item.id).toBe('item-v1')
      expect(frameInfo.activeVideos[1].item.transform.opacity).toBe(0.5)

      // Undo restores opacity 1
      const undone = history.undo()
      expect(undone?.items['item-v2'].transform.opacity).toBe(1)
    })
  })

  // ──── 3. Scale & Opacity Validation ────

  describe('Scale & Opacity Validation', () => {
    it('clamps scale to sensible minimum (0.05) and rejects zero or negative scale', () => {
      const zeroScaleState = new UpdateTransformCommand('item-v2', { scale: 0 }).execute(state)
      expect(zeroScaleState.items['item-v2'].transform.scale).toBe(0.05)

      const negScaleState = new UpdateTransformCommand('item-v2', { scale: -2 }).execute(state)
      expect(negScaleState.items['item-v2'].transform.scale).toBe(0.05)
    })

    it('clamps scale to sensible maximum (20)', () => {
      const maxScaleState = new UpdateTransformCommand('item-v2', { scale: 100 }).execute(state)
      expect(maxScaleState.items['item-v2'].transform.scale).toBe(20)
    })

    it('clamps opacity to [0, 1]', () => {
      const underState = new UpdateTransformCommand('item-v2', { opacity: -0.5 }).execute(state)
      expect(underState.items['item-v2'].transform.opacity).toBe(0)

      const overState = new UpdateTransformCommand('item-v2', { opacity: 1.5 }).execute(state)
      expect(overState.items['item-v2'].transform.opacity).toBe(1)
    })
  })

  // ──── 4. Fit, Fill & Reset Transform ────

  describe('Fit, Fill & Reset Transform Actions', () => {
    it('ResetTransformCommand restores default transform', () => {
      let modified = new UpdateTransformCommand('item-v2', {
        x: 300,
        y: -150,
        scale: 0.45,
        rotation: 30,
        opacity: 0.7,
      }).execute(state)

      const resetState = new ResetTransformCommand('item-v2').execute(modified)
      expect(resetState.items['item-v2'].transform).toEqual(DEFAULT_TRANSFORM)
    })

    it('FitToCanvasCommand scales 1080x1920 vertical asset to fit 1920x1080 canvas', () => {
      const vertItem: TimelineItem = {
        id: 'item-vert',
        trackId: 'track-v2',
        assetId: 'asset-vertical',
        startTime: 0,
        duration: 10,
        sourceIn: 0,
        sourceOut: 10,
        transform: { ...DEFAULT_TRANSFORM },
      }
      let vertState = new AddTimelineItemCommand(vertItem).execute(state)

      const fitState = new FitToCanvasCommand('item-vert').execute(vertState)
      const t = fitState.items['item-vert'].transform

      // Canvas: 1920x1080. Asset: 1080x1920.
      // Fit scale = min(1920/1080, 1080/1920) = min(1.7778, 0.5625) = 0.5625
      expect(t.x).toBe(0)
      expect(t.y).toBe(0)
      expect(t.rotation).toBe(0)
      expect(t.scale).toBe(0.563) // rounded to 3 decimals
    })

    it('FillCanvasCommand scales 1080x1920 vertical asset to fill 1920x1080 canvas', () => {
      const vertItem: TimelineItem = {
        id: 'item-vert',
        trackId: 'track-v2',
        assetId: 'asset-vertical',
        startTime: 0,
        duration: 10,
        sourceIn: 0,
        sourceOut: 10,
        transform: { ...DEFAULT_TRANSFORM },
      }
      let vertState = new AddTimelineItemCommand(vertItem).execute(state)

      const fillState = new FillCanvasCommand('item-vert').execute(vertState)
      const t = fillState.items['item-vert'].transform

      // Fill scale = max(1920/1080, 1080/1920) = max(1.7778, 0.5625) = 1.778
      expect(t.x).toBe(0)
      expect(t.y).toBe(0)
      expect(t.rotation).toBe(0)
      expect(t.scale).toBe(1.778)
    })

    it('FitToCanvasCommand on 3840x2160 (4K) media in 1920x1080 canvas scales to 0.5', () => {
      const item4K: TimelineItem = {
        id: 'item-4k',
        trackId: 'track-v1',
        assetId: 'asset-4k',
        startTime: 0,
        duration: 10,
        sourceIn: 0,
        sourceOut: 10,
        transform: { ...DEFAULT_TRANSFORM },
      }
      let state4K = new AddTimelineItemCommand(item4K).execute(state)

      const fitState = new FitToCanvasCommand('item-4k').execute(state4K)
      expect(fitState.items['item-4k'].transform.scale).toBe(0.5)
    })

    it('Fit, Fill, and Reset are undoable', () => {
      const hist = new CommandHistory(state)
      hist.execute(new UpdateTransformCommand('item-v2', { x: 50, scale: 0.8 }))

      hist.execute(new ResetTransformCommand('item-v2'))
      expect(hist.getCurrentState().items['item-v2'].transform).toEqual(DEFAULT_TRANSFORM)

      // 1 Undo restores previous custom transform
      const undone = hist.undo()
      expect(undone?.items['item-v2'].transform.x).toBe(50)
      expect(undone?.items['item-v2'].transform.scale).toBe(0.8)
    })
  })

  // ──── 5. Crop Functionality ────

  describe('Rectangular Crop Support', () => {
    it('updates crop values and preserves them in ProjectState', () => {
      const cropCommand = new UpdateCropCommand('item-v2', { left: 15, right: 10, top: 5, bottom: 5 })
      const nextState = history.execute(cropCommand)

      const itemCrop = nextState.items['item-v2'].crop
      expect(itemCrop?.left).toBe(15)
      expect(itemCrop?.right).toBe(10)
      expect(itemCrop?.top).toBe(5)
      expect(itemCrop?.bottom).toBe(5)

      // 1 Undo restores previous crop (undefined or default)
      const undone = history.undo()
      expect(undone?.items['item-v2'].crop).toBeUndefined()
    })

    it('clamps crop values to 0-100 and prevents crossing opposite edges', () => {
      const overCrop = new UpdateCropCommand('item-v2', { left: 80, right: 30 }).execute(state)
      const crop = overCrop.items['item-v2'].crop
      expect(crop?.left).toBeDefined()
      expect(crop?.right).toBeDefined()
      expect((crop?.left ?? 0) + (crop?.right ?? 0)).toBeLessThanOrEqual(100)
    })

    it('ResetCropCommand restores crop to 0', () => {
      let cropped = new UpdateCropCommand('item-v2', { left: 25, top: 25 }).execute(state)
      const reset = new ResetCropCommand('item-v2').execute(cropped)
      expect(reset.items['item-v2'].crop).toEqual(DEFAULT_CROP)
    })
  })

  // ──── 6. Selection Synchronization ────

  describe('Selection Synchronization', () => {
    it('SelectItemCommand synchronizes selectedItemId', () => {
      const selState = new SelectItemCommand('item-v2').execute(state)
      expect(selState.selectedItemId).toBe('item-v2')

      const deselState = new SelectItemCommand(null).execute(selState)
      expect(deselState.selectedItemId).toBeNull()
    })
  })

  // ──── 7. Persistence Round-Trip ────

  describe('Persistence Round-Trip with Transforms and Crops', () => {
    it('serializes and deserializes transforms and crops without loss', () => {
      let modified = new UpdateTransformCommand('item-v2', {
        x: 180,
        y: -90,
        scale: 0.75,
        rotation: 12,
        opacity: 0.85,
      }).execute(state)

      modified = new UpdateCropCommand('item-v2', {
        left: 10,
        right: 10,
        top: 5,
        bottom: 5,
      }).execute(modified)

      const json = serializeProject(modified)
      const result = deserializeProject(json)

      const restoredItem = result.state.items['item-v2']
      expect(restoredItem.transform.x).toBe(180)
      expect(restoredItem.transform.y).toBe(-90)
      expect(restoredItem.transform.scale).toBe(0.75)
      expect(restoredItem.transform.rotation).toBe(12)
      expect(restoredItem.transform.opacity).toBe(0.85)

      expect(restoredItem.crop?.left).toBe(10)
      expect(restoredItem.crop?.right).toBe(10)
      expect(restoredItem.crop?.top).toBe(5)
      expect(restoredItem.crop?.bottom).toBe(5)
    })
  })
})
